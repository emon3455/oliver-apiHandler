// UtilityLogger.js — EFS-Optimized Logger (SQS/S3 removed, direct EFS writes)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Slack = require("./utils/slack");
const SafeUtils = require("./SafeUtils");
const DateTime = require("./DateTime");
const ConfigSchemaLoader = require("./ConfigSchemaLoader");
const EnvLoader = require("./EnvLoader");
const ErrorHandler = require("./ErrorHandler");

const FALLBACK_LOG_ROOT = path.join(process.cwd(), "logs_fallback");
const FALLBACK_MISSING_PATH_DIR = path.join(FALLBACK_LOG_ROOT, "missing_path");
const FALLBACK_SLACK_DIR = path.join(FALLBACK_LOG_ROOT, "slack");
const DATE_FORMAT_DAY = "yyyy-MM-dd";
const DATE_FORMAT_TIMESTAMP = "yyyy-MM-dd'T'HH:mm:ss.SSSZZ";
const LOG_TIMESTAMP_FORMAT = "yyyyMMddHHmmssSSS";
const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const SLACK_FAILURE_THRESHOLD = 3;
const SLACK_FAILURE_COOLDOWN_MS = 60_000;
const SLACK_FALLBACK_COOLDOWN_MS = 60_000;
const SLACK_TIMEOUT_DEFAULT = 3000;
const CACHE_SIZE_LIMIT = 1000;
const PATH_SEGMENT_MAX_LEN = 64;
const PLACEHOLDER_REGEX = /\{([^}]+)\}/g;
const PLACEHOLDER_TOKEN_PATTERN = /^([A-Za-z0-9_]+)(?::([A-Za-z0-9_.\-\/]+))?$/;
const SAFE_PLACEHOLDER_KEY_PATTERN = /^[A-Za-z0-9_]+$/;
const RESERVED_PLACEHOLDER_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ERROR_CODES = {
  WRITE_FAIL: "E_WRITE_FAIL",
  CRITICAL_WRITE_FAIL: "E_WRITE_FAIL_CRITICAL",
  BATCH_WRITE_FAIL: "E_BATCH_WRITE_FAIL",
  SLACK_FAIL: "E_SLACK_FAIL",
  ROTATE_FAIL: "E_ROTATE_FAIL",
};
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_IV_BYTES = 12;
const DEBUG_LEVEL_RANKS = Object.freeze({ trace: 10, debug: 20, info: 30 });
const DEFAULT_DEBUG_LEVEL = "debug";
const ISO_FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const ISO_FALLBACK_DATE = "1970-01-01";
const FALLBACK_FILE_TIMESTAMP = "19700101000000000";

// --- Log Storage Paths ---
// Use EFS in remote environments, local filesystem in local/dev
// --- Logger Class ---
class Logger {
  static ENV = Object.freeze(
    EnvLoader.load(ConfigSchemaLoader.loadConfig("configs/envConfig.json")),
  );
  static IS_LOCAL = Logger.ENV.ENVIRONMENT === "local";
  static IS_REMOTE = ["dev", "stage", "prod"].includes(Logger.ENV.ENVIRONMENT);
  static LOG_CONFIG = ConfigSchemaLoader.loadConfig("configs/logRoutes.json");
  static LOG_ROOT = Logger.IS_REMOTE
    ? Logger.ENV.LOG_EFS_ROOT
    : (
      Logger.ENV.LOG_LOCAL_ROOT ||
      Logger.LOG_CONFIG?.root ||
      path.join(process.cwd(), "logs")
    );
  static CRITICAL_ROOT = Logger.IS_REMOTE
    ? Logger.ENV.LOG_EFS_CRITICAL_ROOT
    : (
      Logger.LOG_CONFIG?.criticalRoot ||
      path.join(Logger.LOG_ROOT, "critical")
    );
  static _RESOLVE_CACHE = new Map();
  static _ROUTE_CACHE = new Map();
  static _PATH_CACHE = new Map();
  static _SLACK_FAILURE_COUNT = 0;
  static _SLACK_COOLDOWN_UNTIL = 0;
  static _SLACK_FALLBACK_COOLDOWN_UNTIL = 0;
  static _SLACK_RETRY_LIMIT = 2;
  static _ENCRYPTION_KEY_BUFFER = undefined;
  static _LOCAL_WARNING_SHOWN = false;
  static _LOCAL_WARNING_HANDLER = null;
  static debugLog(...args) {
    const { LOGGING_ENABLE_CONSOLE_LOGS, LOG_DEBUG_LEVEL } = Logger.ENV;
    if (!LOGGING_ENABLE_CONSOLE_LOGS) return null;
    let level = DEFAULT_DEBUG_LEVEL;
    let logArgs = args;
    if (args.length > 1 && typeof args[0] === "string") {
      const providedLevel = Logger._parseDebugLevel(args[0]);
      if (providedLevel) {
        level = providedLevel;
        logArgs = args.slice(1);
      }
    }
    const configuredLevel = Logger._normalizeDebugLevel(LOG_DEBUG_LEVEL);
    if (Logger._getDebugLevelRank(level) < Logger._getDebugLevelRank(configuredLevel)) {
      return null;
    }
    console.log(...logArgs);
    return true;
  }
  static async writeLog({
    flag,
    data = {},
    action,
    critical,
    message = "",
    level = "info",
    encryptFields = [],
  }) {
    const { LOGGING_ENABLED, ENVIRONMENT } = Logger.ENV;
    if (!LOGGING_ENABLED) return null;
    Logger._warnIfLocalMode();
    if (typeof flag !== "string" || !flag.trim()) {
      ErrorHandler.addError("Logger.writeLog: invalid flag", {
        origin: "Logger",
        flag,
      });
      throw new Error("Logger.writeLog: invalid flag");
    }
    if (typeof data !== "object" || data === null) {
      ErrorHandler.addError("Logger.writeLog: data must be object", {
        origin: "Logger",
        flag,
      });
      throw new Error("Logger.writeLog: data must be object");
    }

    const route = Logger.getRouteByFlag(flag);
    const isCritical = Logger._resolveCriticalFlag(critical, route.critical);
    const encryptionTargets = Logger._collectEncryptionTargets(route, {
      encryptFields,
      data,
    });
    if (route.path.includes("{action}") && (typeof action !== "string" || !action.trim())) {
      ErrorHandler.addError("Logger.writeLog: action is required for this log route", {
        origin: "Logger",
        flag,
        path: route.path,
      });
      throw new Error("Logger.writeLog: action is required for this log route");
    }

    const pathData = Logger._preparePathData(data, action);
    const { path: resolvedPath, missing = [] } = Logger.resolvePath(
      route.path,
      pathData,
    );
    const nowRaw = DateTime.now();
    const timestamp = Logger._safeFormatDate(
      nowRaw,
      DATE_FORMAT_TIMESTAMP,
      {
        placeholder: "timestamp",
        fallback: ISO_FALLBACK_TIMESTAMP,
      },
    );
    const fileTimestamp = Logger._safeFormatDate(
      nowRaw,
      LOG_TIMESTAMP_FORMAT,
      {
        placeholder: "fileTimestamp",
        fallback: FALLBACK_FILE_TIMESTAMP,
      },
    );

    const entry = {
      schemaVersion: "1.0",
      timestamp,
      level,
      flag,
      action: action || null,
      message,
      critical: isCritical,
      data,
      retention: route.retention,
      PciCompliance: route.PciCompliance,
      description: route.description,
      category: route.category,
      env: ENVIRONMENT,
    };

    Logger._applyEncryption(entry, encryptionTargets);
    const serializedEntry = Logger._serializeLogEntry(entry);

    if (!resolvedPath) {
      ErrorHandler.addError("Logger.writeLog: missing placeholders", {
        origin: "Logger",
        flag,
        missing: missing || [],
        routePath: route.path,
      });
      const fallbackTemplatePath = Logger._fallbackPathFromPattern(route.path);
      const fallbackRelative = Logger._buildFallbackRelativePath(
        fallbackTemplatePath,
        fileTimestamp,
      );
      const fallbackEntry = {
        ...entry,
        logError: missing?.length
          ? `Missing required placeholders: ${missing.join(", ")}`
          : "Missing required placeholders",
        missingPlaceholders: missing,
      };
      await Logger._writeFallbackLogEntry(
        FALLBACK_MISSING_PATH_DIR,
        fallbackRelative,
        Logger._serializeLogEntry(fallbackEntry),
        { stage: "missing-placeholders" },
      );
      return;
    }

    const timestampedPath = Logger._appendTimestampToPath(resolvedPath, fileTimestamp);
    await Logger.writeToStorage(timestampedPath, serializedEntry);

    if (isCritical) {
      await Logger.writeCriticalLogFile(
        resolvedPath,
        serializedEntry,
        fileTimestamp,
      );
      await Logger.sendToSlackCritical(entry);
    }
  }

  static async writeLogs(logs) {
    const { LOGGING_ENABLED, ENVIRONMENT } = Logger.ENV;
    if (!LOGGING_ENABLED) return null;
    Logger._warnIfLocalMode();
    if (!Array.isArray(logs)) {
      ErrorHandler.addError("Logger.writeLogs: logs must be an array", {
        origin: "Logger",
      });
      throw new Error("Logger.writeLogs: logs must be an array");
    }

    const storagePromises = [];
    const slackEntries = [];
    const fallbackKeys = new Set();

    logs.forEach((log, index) => {
      if (typeof log.flag !== "string" || !log.flag.trim()) {
        ErrorHandler.addError("Logger.writeLogs: invalid flag in log entry", {
          origin: "Logger",
          index,
        });
        throw new Error("Logger.writeLogs: invalid flag in log entry");
      }
      if (typeof log.data !== "object" || log.data === null) {
        ErrorHandler.addError("Logger.writeLogs: data must be object in log entry", {
          origin: "Logger",
          index,
        });
        throw new Error("Logger.writeLogs: data must be object in log entry");
      }
    });

    for (const log of logs) {
      const route = Logger.getRouteByFlag(log.flag);
      const isCritical = Logger._resolveCriticalFlag(log.critical, route.critical);
      const encryptionTargets = Logger._collectEncryptionTargets(route, log);
      const pathData = Logger._preparePathData(log.data, log.action);
      const { path: resolvedPath, missing = [] } = Logger.resolvePath(
        route.path,
        pathData,
      );
      const missingDescriptor = Logger._describeMissingPlaceholders(missing);
      const nowRaw = DateTime.now();
      const timestamp = Logger._safeFormatDate(
        nowRaw,
        DATE_FORMAT_TIMESTAMP,
        {
          placeholder: "timestamp",
          fallback: ISO_FALLBACK_TIMESTAMP,
        },
      );
      const fileTimestamp = Logger._safeFormatDate(
        nowRaw,
        LOG_TIMESTAMP_FORMAT,
        {
          placeholder: "fileTimestamp",
          fallback: FALLBACK_FILE_TIMESTAMP,
        },
      );

      const entry = {
        schemaVersion: "1.0",
        timestamp,
        level: log.level || "info",
        flag: log.flag,
        action: log.action || null,
        message: log.message || "",
        critical: isCritical,
        data: log.data,
        retention: route.retention,
        PciCompliance: route.PciCompliance,
        description: route.description,
        category: route.category,
        env: ENVIRONMENT,
      };
      Logger._applyEncryption(entry, encryptionTargets);
      const serializedEntry = Logger._serializeLogEntry(entry);

      if (!resolvedPath) {
        const sanitizedFlag = Logger._sanitizePathSegment(log.flag);
        const fallbackSuffix = missingDescriptor || "_missing";
        const fallbackKey = `missing:${sanitizedFlag}:${fallbackSuffix}`;
        if (!fallbackKeys.has(fallbackKey)) {
          fallbackKeys.add(fallbackKey);
          ErrorHandler.addError("Logger.writeLogs: missing placeholders in entry", {
            origin: "Logger",
            flag: log.flag,
            missing,
            routePath: route.path,
          });
          const fallbackTemplatePath = Logger._fallbackPathFromPattern(route.path);
          const fallbackRelative = Logger._buildFallbackRelativePath(
            fallbackTemplatePath,
            fileTimestamp,
          );
          const fallbackEntry = {
            ...entry,
            logError: missing.length
              ? `Missing required placeholders: ${missing.join(", ")}`
              : "Missing required placeholders",
            missingPlaceholders: missing,
          };
          storagePromises.push(
            Logger._writeFallbackLogEntry(
              FALLBACK_MISSING_PATH_DIR,
              fallbackRelative,
              Logger._serializeLogEntry(fallbackEntry),
              { stage: "missing-placeholders" },
            ),
          );
        }
        continue;
      }

      const timestampedPath = Logger._appendTimestampToPath(resolvedPath, fileTimestamp);
      storagePromises.push(Logger.writeToStorage(timestampedPath, serializedEntry));

      if (isCritical) {
        storagePromises.push(
          Logger.writeCriticalLogFile(
            resolvedPath,
            serializedEntry,
            fileTimestamp,
          ),
        );
        slackEntries.push(entry);
      }
    }

    await Promise.allSettled(storagePromises);

    for (const entry of slackEntries) {
      await Logger.sendToSlackCritical(entry);
    }
  }

    static async writeLogSafe(payload) {
    let attempt = 0;
    let attemptPayload = payload;
    while (attempt < 2) {
      try {
        return await Logger.writeLog(attemptPayload);
      } catch (err) {
        ErrorHandler.addError("Logger.writeLogSafe failed", {
          origin: "Logger",
          attempt,
          error: err?.message || "unknown",
        });
        attempt += 1;
        if (attempt >= 2) return null;
        attemptPayload =
          typeof payload === "object" && payload !== null
            ? { ...payload, safeFailed: true }
            : { safeFailed: true };
      }
    }
    return null;
  }
  static async writeLogsSafe(logs) {
    let attempt = 0;
    let attemptLogs = logs;
    while (attempt < 2) {
      try {
        return await Logger.writeLogs(attemptLogs);
      } catch (err) {
        ErrorHandler.addError("Logger.writeLogsSafe failed", {
          origin: "Logger",
          attempt,
          error: err?.message || "unknown",
        });
        attempt += 1;
        if (attempt >= 2) return null;
        attemptLogs = Array.isArray(logs)
          ? logs.map((log) => ({
            ...(log || {}),
            safeFailed: true,
          }))
          : logs;
      }
    }
    return null;
  }

    static async writeLogBatchFile(relativePath, entries) {
    const { ENVIRONMENT } = Logger.ENV;
    const resolved = Logger._resolvePathWithinRoot(Logger.LOG_ROOT, relativePath);
    const safeRel = resolved.relative;
    const full = resolved.full;
    const dir = resolved.dir;
    try {
      await Logger._ensureDirExists(dir, { stage: "primary-batch-write" });
      const content = entries
        .map((entry) => Logger._serializeLogEntry(entry))
        .join("\n") + "\n";
      await Logger._writeFileWithRetry(full, content);
    } catch (err) {
      if (Logger._isPermissionError(err)) return;
      const fallbackRoot = path.join(FALLBACK_LOG_ROOT, "batch_write_errors");
      const fallback = path.join(fallbackRoot, safeRel);
      try {
        await Logger._ensureDirExists(path.dirname(fallback), { stage: "fallback-batch-write" });
        const fallbackEntry = {
          timestamp: DateTime.now(DATE_FORMAT_TIMESTAMP),
          error: err.message,
          attemptedPath: full,
          entryCount: entries.length,
          env: ENVIRONMENT,
          errorCode: ERROR_CODES.BATCH_WRITE_FAIL,
        };
        const fallbackWithTimestamp = Logger._appendTimestampToPath(fallback);
        await Logger._writeFileWithRetry(
          fallbackWithTimestamp,
          `${Logger._serializeLogEntry(fallbackEntry)}\n`,
        );
      } catch (fallbackErr) {
        if (Logger._isPermissionError(fallbackErr)) return;
      }
    }
  }
  static _resolveRootPath(rootPath) {
    if (typeof rootPath !== "string") return "";
    try {
      if (typeof fs.realpathSync.native === "function") {
        return fs.realpathSync.native(rootPath);
      }
      return fs.realpathSync(rootPath);
    } catch {
      return path.resolve(rootPath);
    }
  }
  static async writeCriticalLogFile(relativePath, entryOrPayload, fileTimestamp = null) {
    const { ENVIRONMENT } = Logger.ENV;
    const criticalRel = Logger._toCriticalLogPath(relativePath);

    const timestampedCriticalRel = Logger._appendTimestampToPath(
      criticalRel,
      fileTimestamp,
    );
    const safeRel = Logger.ensureRelativeLogPath(timestampedCriticalRel);

    const isSubdir = Logger._isPathWithinRoot(Logger.LOG_ROOT, Logger.CRITICAL_ROOT);

    Logger._validateLogPayload(entryOrPayload);
    const payload =
      typeof entryOrPayload === "string"
        ? entryOrPayload
        : Logger._serializeLogEntry(entryOrPayload);

    if (isSubdir) {
      const resolvedLogRoot = Logger._resolveRootPath(Logger.LOG_ROOT);
      const resolvedCriticalRoot = Logger._resolveRootPath(Logger.CRITICAL_ROOT);
      const relFromRoot = path.join(
        path.relative(resolvedLogRoot, resolvedCriticalRoot),
        safeRel,
      );
      return Logger.writeToStorage(relFromRoot, payload);
    }

    const resolved = Logger._resolvePathWithinRoot(Logger.CRITICAL_ROOT, safeRel);
    const full = resolved.full;
    const dir = resolved.dir;
    try {
      await Logger._ensureDirExists(dir, { stage: "primary-critical-write" });
      await Logger._writeFileWithRetry(full, `${payload}\n`);
    } catch (err) {
      if (Logger._isPermissionError(err)) return;
      const fallbackRoot = path.join(FALLBACK_LOG_ROOT, "critical_write_errors");
      const fallback = path.join(fallbackRoot, safeRel);
      try {
        await Logger._ensureDirExists(path.dirname(fallback), { stage: "fallback-critical-write" });
        const fallbackEntry = {
          timestamp: DateTime.now(DATE_FORMAT_TIMESTAMP),
          error: err.message,
          attemptedPath: full,
          env: ENVIRONMENT,
          errorCode: ERROR_CODES.CRITICAL_WRITE_FAIL,
        };
        const fallbackWithTimestamp = Logger._appendTimestampToPath(fallback);
        await Logger._writeFileWithRetry(
          fallbackWithTimestamp,
          `${Logger._serializeLogEntry(fallbackEntry)}\n`,
        );
      } catch (fallbackErr) {
        if (Logger._isPermissionError(fallbackErr)) return;
      }
    }
  }
  static async sendToSlackCritical(entry) {
    if (!Logger._canSendSlack()) {
      Logger.debugLog?.("debug", "[Logger] Slack send skipped: in cooldown window");
      return null;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Logger._getSlackTimeoutMs(),
    );
    try {
      await Slack.critical(entry, { signal: controller.signal });
      Logger._recordSlackSuccess();
    } catch (err) {
      Logger._recordSlackFailure(err);
      Logger.debugLog?.("debug", `[Logger] Slack send failed: ${err.message}`);
      if (Date.now() < Logger._SLACK_FALLBACK_COOLDOWN_UNTIL) {
        Logger.debugLog?.("debug", "[Logger] Slack fallback suppressed during cooldown");
        return null;
      }
      const slackRoute = Logger.getRouteByFlag(entry.flag);
      const fallbackTemplatePath = Logger._fallbackPathFromPattern(slackRoute?.path);
      const fallbackRelative = Logger._buildFallbackRelativePath(fallbackTemplatePath);
      const fallbackEntry = {
        ...entry,
        slackError: err.message,
        errorCode: ERROR_CODES.SLACK_FAIL,
      };
      await Logger._writeFallbackLogEntry(
        FALLBACK_SLACK_DIR,
        fallbackRelative,
        Logger._serializeLogEntry(fallbackEntry),
        { stage: "slack-fallback" },
      );
      Logger._scheduleSlackRetry(entry);
      Logger._SLACK_FALLBACK_COOLDOWN_UNTIL = Date.now() + SLACK_FALLBACK_COOLDOWN_MS;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  static async writeToStorage(relativePath, entryOrPayload) {
    const { ENVIRONMENT } = Logger.ENV;
    const resolved = Logger._resolvePathWithinRoot(Logger.LOG_ROOT, relativePath);
    const safeRel = resolved.relative;
    const full = resolved.full;
    const dir = resolved.dir;
    Logger._validateLogPayload(entryOrPayload);
    const payload =
      typeof entryOrPayload === "string"
        ? entryOrPayload
        : Logger._serializeLogEntry(entryOrPayload);
    try {
      await Logger._ensureDirExists(dir, { stage: "primary-write" });
      await Logger._writeFileWithRetry(full, `${payload}\n`);
    } catch (err) {
      if (Logger._isPermissionError(err)) return;
      const fallbackRoot = path.join(FALLBACK_LOG_ROOT, "write_errors");
      const fallback = path.join(fallbackRoot, safeRel);
      try {
        await Logger._ensureDirExists(path.dirname(fallback), { stage: "fallback-write" });
        const fallbackEntry = {
          timestamp: DateTime.now(DATE_FORMAT_TIMESTAMP),
          error: err.message,
          attemptedPath: full,
          env: ENVIRONMENT,
          errorCode: ERROR_CODES.WRITE_FAIL,
        };
        const fallbackWithTimestamp = Logger._appendTimestampToPath(fallback);
        await Logger._writeFileWithRetry(
          fallbackWithTimestamp,
          `${Logger._serializeLogEntry(fallbackEntry)}\n`,
        );
      } catch (fallbackErr) {
        if (Logger._isPermissionError(fallbackErr)) return;
      }
    }
  }


  static _resolveCriticalFlag(usageCritical, routeCritical) {
    if (typeof usageCritical === "boolean") return usageCritical;
    return !!routeCritical;
  }



    static _isPathWithinRoot(baseRoot, candidatePath) {
    const resolvedBase = Logger._resolveRootPath(baseRoot);
    const resolvedCandidate = Logger._resolveRootPath(candidatePath);
    if (!resolvedBase || !resolvedCandidate) return false;
    const baseWithSep = resolvedBase.endsWith(path.sep)
      ? resolvedBase
      : resolvedBase + path.sep;
    return resolvedCandidate === resolvedBase || resolvedCandidate.startsWith(baseWithSep);
  }
  static _resolvePathWithinRoot(rootPath, relativePath) {
    const safeRel = Logger.ensureRelativeLogPath(relativePath);
    const cacheKey = `${rootPath}::${safeRel}`;
    const cached = Logger._PATH_CACHE.get(cacheKey);
    if (cached) return cached;
    const resolvedRoot = Logger._resolveRootPath(rootPath);
    const full = path.resolve(resolvedRoot, safeRel);
    const rootWithSep = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : resolvedRoot + path.sep;
    if (!full.startsWith(rootWithSep)) {
      ErrorHandler.addError("Blocked path traversal attempt.", {
        origin: "Logger",
        path: full,
      });
      throw new Error("Blocked path traversal attempt.");
    }
    const result = { full, dir: path.dirname(full), relative: safeRel };
    Logger._PATH_CACHE.set(cacheKey, result);
    Logger._trimCache(Logger._PATH_CACHE);
    return result;
  }



  
  static setLocalWarningHandler(handler) {
    if (typeof handler !== "function") return;
    Logger._LOCAL_WARNING_HANDLER = handler;
  }

  static _localWarningDefaultHandler() {
    Logger.debugLog("info", "[Logger] Local mode: logs written to local filesystem");
  }

  static _warnIfLocalMode() {
    if (!Logger.IS_LOCAL || Logger._LOCAL_WARNING_SHOWN) return;
    Logger._LOCAL_WARNING_SHOWN = true;
    const handler = Logger._LOCAL_WARNING_HANDLER || Logger._localWarningDefaultHandler;
    handler();
  }


  static ensureRelativeLogPath(relPath) {
    const candidate = typeof relPath === "string" ? relPath : String(relPath ?? "");
    if (!candidate.trim()) {
      ErrorHandler.addError("Log path cannot be empty", {
        origin: "Logger",
        relPath: candidate,
      });
      throw new Error("Log path cannot be empty");
    }

    const normalized = path.normalize(candidate);
    if (path.isAbsolute(normalized)) {
      ErrorHandler.addError("Absolute paths are not allowed", {
        origin: "Logger",
        relPath: normalized,
      });
      throw new Error("Absolute paths are not allowed");
    }

    if (/(^|[\\/])\.\.([\\/]|$)/.test(normalized)) {
      ErrorHandler.addError("Parent traversal not allowed", {
        origin: "Logger",
        relPath: normalized,
      });
      throw new Error("Parent traversal not allowed");
    }

    const trimmed = normalized.replace(/^[/\\]+/, "");
    const segments = trimmed.split(/[\\/]+/).filter(Boolean);
    if (segments.some((segment) => /^\.+$/.test(segment))) {
      ErrorHandler.addError("Dot-only path segments are not allowed", {
        origin: "Logger",
        relPath: trimmed,
      });
      throw new Error("Dot-only path segments are not allowed");
    }

    return trimmed;
  }
  static _fallbackPathFromPattern(template) {
    if (typeof template !== "string" || !template.trim()) {
      return "unknown.log";
    }
    PLACEHOLDER_REGEX.lastIndex = 0;
    const replaced = template.replace(PLACEHOLDER_REGEX, (match, token) => {
      const parsed = Logger._parsePlaceholderToken(token);
      return parsed.valid && parsed.key ? parsed.key : "missing";
    });
    return path.normalize(replaced);
  }
  static _toCriticalLogPath(relativePath) {
    if (typeof relativePath !== "string" || !relativePath.trim()) return "critical.log";
    if (relativePath.endsWith(".critical.log")) return relativePath;
    if (relativePath.endsWith(".log")) {
      return relativePath.slice(0, -4) + ".critical.log";
    }
    return relativePath + ".critical.log";
  }
  static _sanitizePathSegment(value) {
    const sanitizedInput = SafeUtils.sanitizeString(value);
    if (!sanitizedInput) return "";
    const normalized = sanitizedInput
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^\.+/, "")
      .replace(/\.{3,}/g, "..");
    return normalized.length > PATH_SEGMENT_MAX_LEN
      ? normalized.slice(0, PATH_SEGMENT_MAX_LEN)
      : normalized;
  }
  static _resolvePathPattern(template, data) {
    const normalizedData = Logger._normalizePathData(data);
    const cacheKey = `${template}::${Logger._serializePathCacheKey(normalizedData)}`;
    if (Logger._RESOLVE_CACHE.has(cacheKey)) return Logger._RESOLVE_CACHE.get(cacheKey);
    Logger.debugLog?.("[Logger] Resolve cache miss", { template });

    PLACEHOLDER_REGEX.lastIndex = 0;
    const placeholders = Array.from(template.matchAll(PLACEHOLDER_REGEX)).map(
      (m) => m[1],
    );
    const missing = [];
    let out = template;

    for (const placeholder of placeholders) {
      const parsed = Logger._parsePlaceholderToken(placeholder);
      if (!parsed.valid) {
        ErrorHandler.addError("Logger: invalid placeholder token", {
          origin: "Logger",
          placeholder,
        });
        missing.push(parsed.key || placeholder);
        continue;
      }
      const matchedKey = Logger._findMatchingKeyInsensitive(normalizedData, parsed.key);
      if (!matchedKey) {
        missing.push(parsed.key);
        continue;
      }
      let value = normalizedData[matchedKey];

      if (parsed.format) {
        value = Logger._safeFormatDate(value, parsed.format, {
          placeholder: parsed.key,
          template,
          fallback: ISO_FALLBACK_TIMESTAMP,
        });
      }

      const sanitizedVal = Logger._sanitizePathSegment(value);
      const placeholderWithBraces = `{${placeholder}}`;
      out = out.split(placeholderWithBraces).join(sanitizedVal);
    }

    const resolvedPath = missing.length ? null : path.normalize(out);
    const result = { path: resolvedPath, missing };
    if (!missing.length) {
      Logger._RESOLVE_CACHE.set(cacheKey, result);
      Logger._trimCache(Logger._RESOLVE_CACHE);
    }
    return result;
  }
  static _preparePathData(dataCandidate, action) {
    const normalized = Logger._normalizePathData(dataCandidate);
    if (typeof action === "string" && action.trim()) {
      normalized.action = action.trim();
    }
    return normalized;
  }
  static _normalizePathData(dataCandidate) {
    const normalized = Object.create(null);
    if (!dataCandidate || typeof dataCandidate !== "object") return normalized;
    for (const [key, value] of Object.entries(dataCandidate)) {
      if (!Logger._isAllowedPlaceholder(key)) {
        ErrorHandler.addError("Logger: invalid placeholder key in data", {
          origin: "Logger",
          key,
        });
        continue;
      }
      normalized[key] = value;
    }
    return normalized;
  }
  static _serializePathCacheKey(normalizedData) {
    const entries = Object.keys(normalizedData)
      .sort()
      .map((key) => [key, Logger._stringifyCacheValue(normalizedData[key])]);
    return JSON.stringify(entries);
  }
  static _stringifyCacheValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try {
        return Logger._stableStringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  static _stableStringify(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) {
      return `[${value.map((item) => Logger._stableStringify(item)).join(",")}]`;
    }
    if (typeof value === "object") {
      const entries = Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${Logger._stableStringify(value[key])}`,
        );
      return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
  }
  static _sanitizeLogEntryValue(key, value) {
    if (value === undefined) return null;
    if (typeof value === "number" && Number.isNaN(value)) return null;
    return value;
  }
  static _serializeLogEntry(entry) {
    if (typeof entry === "string") return entry;
    return JSON.stringify(entry, Logger._sanitizeLogEntryValue);
  }

  static _isLogEntryObject(value) {
    return (
      value &&
      typeof value === "object" &&
      typeof value.schemaVersion === "string" &&
      typeof value.timestamp === "string" &&
      typeof value.flag === "string"
    );
  }

  static _validateLogPayload(payload) {
    if (typeof payload === "string") {
      if (!payload.trim()) {
        ErrorHandler.addError("Logger.writeToStorage received empty string payload", {
          origin: "Logger",
        });
        throw new Error("Logger.writeToStorage received empty payload");
      }
      return true;
    }
    if (Logger._isLogEntryObject(payload)) return true;
    ErrorHandler.addError("Logger.writeToStorage received invalid payload", {
      origin: "Logger",
      payload,
    });
    throw new Error("Logger.writeToStorage received invalid payload");
  }
  static _isAllowedPlaceholder(key) {
    if (!key || typeof key !== "string") return false;
    if (RESERVED_PLACEHOLDER_KEYS.has(key)) return false;
    return SAFE_PLACEHOLDER_KEY_PATTERN.test(key);
  }
  static _normalizePathDateFormat(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (trimmed === "YYYY-MM-DD") return DATE_FORMAT_DAY;
    if (trimmed === "DD-MM-YYYY") return "dd-MM-yyyy";
    return trimmed;
  }
  static _parsePlaceholderToken(token) {
    const trimmed = typeof token === "string" ? token.trim() : "";
    if (!trimmed) {
      return { valid: false, key: "", format: "" };
    }
    const match = PLACEHOLDER_TOKEN_PATTERN.exec(trimmed);
    if (!match) {
      return { valid: false, key: trimmed, format: "" };
    }
    const key = match[1];
    const format = match[2] ? Logger._normalizePathDateFormat(match[2]) : "";
    if (!Logger._isAllowedPlaceholder(key)) {
      return { valid: false, key, format };
    }
    return { valid: true, key, format };
  }
  static _findMatchingKeyInsensitive(data, targetKey) {
    const normalizedTarget = targetKey.toLowerCase();
    return Object.keys(data).find(
      (candidate) => candidate.toLowerCase() === normalizedTarget,
    );
  }
  static _safeFormatDate(value, format, context = {}) {
    const { fallback = null, ...contextDetails } = context;
    const formatted = DateTime.formatDate(String(value), format);
    if (!formatted) {
      ErrorHandler.addError("Date formatting returned fallback value", {
        origin: "Logger",
        ...contextDetails,
        fallback,
      });
      return fallback;
    }
    return formatted;
  }
  static _describeMissingPlaceholders(missing = []) {
    if (!Array.isArray(missing) || missing.length === 0) return "";
    const sanitized = missing.map(Logger._sanitizePathSegment).filter(Boolean);
    return sanitized.length ? `_missing_${sanitized.join("_")}` : "";
  }
  static getRouteByFlag(flag) {
    const rawFlag = typeof flag === "string" ? flag : String(flag || "");
    const normalizedFlag = rawFlag.trim();
    const cacheKey = normalizedFlag.toLowerCase();
    if (Logger._ROUTE_CACHE.has(cacheKey)) return Logger._ROUTE_CACHE.get(cacheKey);
    Logger.debugLog?.("debug", `[Logger] Route cache miss for flag: ${normalizedFlag}`);
    try {
      for (const category of Object.values(Logger.LOG_CONFIG)) {
        if (!category?.logs) continue;
        const meta = {
          retention: category.retention,
          category: category.category,
          description: category.description,
        };
        const found = category.logs.find(
          (log) => String(log.flag || "").toLowerCase() === cacheKey,
        );
        if (found) {
          const route = { ...meta, ...found };
          Logger._ROUTE_CACHE.set(cacheKey, route);
          return route;
        }
      }
    } catch (err) {
      ErrorHandler.addError("Logger.getRouteByFlag failed to parse route metadata", {
        origin: "Logger",
        flag: rawFlag,
        error: err?.message || "unknown",
      });
    }

    const safeFlag = Logger._sanitizePathSegment(normalizedFlag) || "missing_route";
    const fallbackDate = Logger._safeFormatDate(
      DateTime.now(),
      DATE_FORMAT_DAY,
      {
        placeholder: "missingRouteDate",
        fallback: ISO_FALLBACK_DATE,
      },
    );
    Logger.debugLog?.("debug", `[Logger] Route not found for flag: ${normalizedFlag}`);
    const fallback = {
      retention: "unknown",
      category: "unknown",
      description: "Missing route definition",
      path: path.join("missingLogRoutes", safeFlag, `${fallbackDate}.log`),
      PciCompliance: false,
      critical: false,
    };
    Logger._ROUTE_CACHE.set(cacheKey, fallback);
    return fallback;
  }
  static resolvePath(template, data) {
    return Logger._resolvePathPattern(template, data);
  }
  static _appendTimestampToPath(relativePath, timestamp = null) {
    const resolvedTimestamp =
      timestamp || DateTime.now(LOG_TIMESTAMP_FORMAT);
    const normalizedPath = typeof relativePath === "string"
      ? path.normalize(relativePath)
      : "";
    const extension = path.extname(normalizedPath);
    const basePath = extension
      ? normalizedPath.slice(0, -extension.length)
      : normalizedPath;
    return `${basePath}_${resolvedTimestamp}${extension}`;
  }
  static _appendSuffixBeforeExtension(relativePath, suffix) {
    if (typeof relativePath !== "string" || !relativePath.trim()) return relativePath;
    if (typeof suffix !== "string" || !suffix) return relativePath;
    const extension = path.extname(relativePath);
    const basePath = extension
      ? relativePath.slice(0, -extension.length)
      : relativePath;
    return `${basePath}${suffix}${extension}`;
  }

  static _buildFallbackRelativePath(baseRelativePath, fileTimestamp = null) {
    const timestampedPath = Logger._appendTimestampToPath(
      baseRelativePath,
      fileTimestamp,
    );
    const hash = crypto.randomBytes(4).toString("hex");
    return Logger._appendSuffixBeforeExtension(timestampedPath, `_fallback_${hash}`);
  }
  static _isPermissionError(error) {
    return error && (error.code === "EACCES" || error.code === "EPERM");
  }
  static async _ensureDirExists(dirPath, context = {}) {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (err) {
      if (Logger._isPermissionError(err)) {
        ErrorHandler.addError("Logger cannot create directory due to permissions", {
          origin: "Logger",
          path: dirPath,
          ...context,
          error: err?.message || "permission error",
        });
      }
      throw err;
    }
  }
  static async _writeFallbackLogEntry(baseRoot, relativePath, payload, context = {}) {
    const resolved = Logger._resolvePathWithinRoot(baseRoot, relativePath);
    await Logger._ensureDirExists(resolved.dir, { stage: "fallback-write", ...context });
    await Logger._writeFileWithRetry(resolved.full, `${payload}\n`);
  }
  static async _rotateLogFileIfNeeded(filePath) {
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile() || stats.size < MAX_LOG_FILE_SIZE_BYTES) return;
      const rotatedPath = Logger._appendTimestampToPath(filePath);
      await fs.promises.rename(filePath, rotatedPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        ErrorHandler.addError("Logger failed to rotate log file", {
          origin: "Logger",
          filePath,
          error: err.message,
        });
        throw err;
      }
    }
  }
  static async _writeFileWithRetry(filePath, content, attempts = 2) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await Logger._rotateLogFileIfNeeded(filePath);
        await fs.promises.writeFile(filePath, content);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < attempts) {
          const backoffMs = 50 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    ErrorHandler.addError("Logger failed to write file after retries", {
      origin: "Logger",
      filePath,
      error: lastError?.message || "write failure",
    });
    throw lastError;
  }

  static _trimCache(cache) {
    if (!cache || typeof cache.size !== "number") return;
    while (cache.size > CACHE_SIZE_LIMIT) {
      const key = cache.keys().next().value;
      if (key === undefined) break;
      cache.delete(key);
    }
  }
  static _getSlackTimeoutMs() {
    const configured = Number(Logger.ENV.LOG_SLACK_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : SLACK_TIMEOUT_DEFAULT;
  }
  static _canSendSlack() {
    return Date.now() >= Logger._SLACK_COOLDOWN_UNTIL;
  }
  static _recordSlackSuccess() {
    Logger._SLACK_FAILURE_COUNT = 0;
  }
  static _recordSlackFailure(err) {
    Logger._SLACK_FAILURE_COUNT += 1;
    if (Logger._SLACK_FAILURE_COUNT >= SLACK_FAILURE_THRESHOLD) {
      Logger._SLACK_FAILURE_COUNT = 0;
      Logger._SLACK_COOLDOWN_UNTIL = Date.now() + SLACK_FAILURE_COOLDOWN_MS;
      ErrorHandler.addError("Slack disabled temporarily after repeated failures", {
        origin: "Logger",
        reason: err?.message || "unknown",
      });
    }
  }

  static _scheduleSlackRetry(entry) {
    if (!entry || typeof entry !== "object") return;
    const currentAttempts = entry.__slackRetryAttempts || 0;
    if (currentAttempts >= Logger._SLACK_RETRY_LIMIT) return;
    Object.defineProperty(entry, "__slackRetryAttempts", {
      value: currentAttempts + 1,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    setTimeout(() => {
      Logger.sendToSlackCritical(entry);
    }, SLACK_FALLBACK_COOLDOWN_MS);
  }
  static _isDebugLevel(level) {
    return Object.prototype.hasOwnProperty.call(DEBUG_LEVEL_RANKS, level);
  }
  static _normalizeDebugLevel(level) {
    if (typeof level !== "string") return DEFAULT_DEBUG_LEVEL;
    const normalized = level.trim().toLowerCase();
    return Logger._isDebugLevel(normalized) ? normalized : DEFAULT_DEBUG_LEVEL;
  }
  static _parseDebugLevel(level) {
    if (typeof level !== "string") return null;
    const normalized = level.trim().toLowerCase();
    return Logger._isDebugLevel(normalized) ? normalized : null;
  }
  static _getDebugLevelRank(level) {
    const normalized = Logger._normalizeDebugLevel(level);
    return DEBUG_LEVEL_RANKS[normalized] ?? DEBUG_LEVEL_RANKS[DEFAULT_DEBUG_LEVEL];
  }




    static _normalizeEncryptionFields(targets) {
    if (!targets) return [];
    const candidateList = Array.isArray(targets) ? targets : [targets];
    const normalized = [];
    for (const candidate of candidateList) {
      if (typeof candidate !== "string") continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (!SAFE_PLACEHOLDER_KEY_PATTERN.test(trimmed)) continue;
      normalized.push(trimmed);
    }
    return Array.from(new Set(normalized));
  }
  static _collectEncryptionTargets(route = {}, logEntry = {}) {
    if (logEntry.encryptFields === true) {
      return Logger._normalizeEncryptionFields(Object.keys(logEntry.data || {}));
    }
    const routeTargets = route.encryptFields || route.sensitivePlaceholders;
    const logTargets = logEntry.encryptFields;
    const combined = [
      ...Logger._normalizeEncryptionFields(routeTargets),
      ...Logger._normalizeEncryptionFields(logTargets),
    ];
    return Array.from(new Set(combined));
  }
  static _getEncryptionKeyBuffer() {
    if (Logger._ENCRYPTION_KEY_BUFFER !== undefined) return Logger._ENCRYPTION_KEY_BUFFER;
    const rawKey = Logger.ENV.LOG_ENCRYPTION_KEY;
    if (!rawKey) {
      Logger._ENCRYPTION_KEY_BUFFER = null;
      return null;
    }
    try {
      const candidate = Buffer.from(rawKey, "base64");
      if (candidate.length !== 32) {
        throw new Error("decoded key must be 32 bytes");
      }
      Logger._ENCRYPTION_KEY_BUFFER = candidate;
    } catch (err) {
      const message = "Logger encryption key is invalid";
      ErrorHandler.addError(message, {
        origin: "Logger",
        error: err?.message || "invalid key",
      });
      Logger._ENCRYPTION_KEY_BUFFER = null;
      throw new Error(message);
    }
    return Logger._ENCRYPTION_KEY_BUFFER;
  }
  static _encryptValue(value, keyBuffer) {
    const iv = crypto.randomBytes(ENCRYPTION_IV_BYTES);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(value), "utf8"),
      cipher.final(),
    ]);
    return {
      payload: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }
  static _decryptValue(segment, keyBuffer) {
    const iv = Buffer.from(segment.iv, "base64");
    const tag = Buffer.from(segment.tag, "base64");
    const encryptedPayload =
      typeof segment.payload === "string" ? segment.payload : segment.encrypted;
    const encrypted = Buffer.from(encryptedPayload || "", "base64");
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  }
  static _applyEncryption(entry, targets) {
    const normalizedTargets = Logger._normalizeEncryptionFields(targets);
    if (!normalizedTargets.length) return entry;
    let keyBuffer;
    try {
      keyBuffer = Logger._getEncryptionKeyBuffer();
    } catch (err) {
      ErrorHandler.addError("Logger encryption key validation failed", {
        origin: "Logger",
        error: err?.message || "invalid key",
      });
      return entry;
    }
    if (!keyBuffer) {
      ErrorHandler.addError("Logger encryption requested but key unavailable", {
        origin: "Logger",
        targets: normalizedTargets,
      });
      return entry;
    }
    if (!entry || !entry.data || typeof entry.data !== "object") return entry;
    for (const field of normalizedTargets) {
      if (!Object.prototype.hasOwnProperty.call(entry.data, field)) continue;
      try {
        const encryptedSegment = Logger._encryptValue(entry.data[field], keyBuffer);
        entry.data[field] = {
          placeholder: field,
          encrypted: encryptedSegment.payload,
          iv: encryptedSegment.iv,
          tag: encryptedSegment.tag,
          algorithm: ENCRYPTION_ALGORITHM,
        };
      } catch (err) {
        ErrorHandler.addError("Logger encryption failed for field", {
          origin: "Logger",
          field,
          flag: entry.flag,
          error: err?.message || "encryption error",
        });
      }
    }
    return entry;
  }
  static decryptEntry(entry) {
    const data = entry?.data;
    if (!data || typeof data !== "object") return null;
    let keyBuffer;
    try {
      keyBuffer = Logger._getEncryptionKeyBuffer();
    } catch {
      return null;
    }
    if (!keyBuffer) return null;
    const result = {};
    let changed = false;
    for (const [field, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === "object" &&
        value.iv &&
        value.tag &&
        (Object.prototype.hasOwnProperty.call(value, "encrypted") ||
          Object.prototype.hasOwnProperty.call(value, "payload"))
      ) {
        try {
          result[field] = Logger._decryptValue(value, keyBuffer);
          changed = true;
        } catch (err) {
          ErrorHandler.addError("Logger failed to decrypt field", {
            origin: "Logger",
            field,
            error: err?.message || "decryption error",
          });
        }
      }
    }
    return changed ? result : null;
  }
  static async decryptLogFile(logFilePath) {
    if (typeof logFilePath !== "string" || !logFilePath.trim()) {
      ErrorHandler.addError("Logger.decryptLogFile requires a file path", {
        origin: "Logger",
        path: logFilePath,
      });
      throw new Error("Logger.decryptLogFile requires a file path");
    }
    const resolvedSource = path.isAbsolute(logFilePath)
      ? logFilePath
      : path.resolve(logFilePath);
    try {
      await fs.promises.access(resolvedSource, fs.constants.R_OK);
    } catch {
      ErrorHandler.addError("Logger.decryptLogFile source missing", {
        origin: "Logger",
        path: resolvedSource,
      });
      throw new Error("Logger.decryptLogFile source missing");
    }
    const decryptedPath = Logger._appendSuffixBeforeExtension(
      resolvedSource,
      "_decrypted",
    );
    try {
      const rawContent = await fs.promises.readFile(resolvedSource, "utf8");
      const sanitizedLines = [];
      const chunks = rawContent.split(/\r?\n/);
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (!chunk || !chunk.trim()) continue;
        try {
          const parsed = JSON.parse(chunk);
          const decrypted = Logger.decryptEntry(parsed);
          delete parsed.encryption;
          if (decrypted) {
            parsed.data = { ...(parsed.data || {}), ...decrypted };
          }
          sanitizedLines.push(Logger._serializeLogEntry(parsed));
        } catch (innerErr) {
          ErrorHandler.addError("Logger.decryptLogFile could not parse entry", {
            origin: "Logger",
            path: resolvedSource,
            line: index + 1,
            error: innerErr?.message || "parse error",
          });
          sanitizedLines.push(chunk);
        }
      }
      await Logger._ensureDirExists(path.dirname(decryptedPath), { stage: "decrypt-output" });
      await fs.promises.writeFile(
        decryptedPath,
        sanitizedLines.length ? `${sanitizedLines.join("\n")}\n` : "",
        "utf8",
      );
      return decryptedPath;
    } catch (err) {
      if (Logger._isPermissionError(err)) {
        throw new Error("Logger.decryptLogFile failed");
      }
      ErrorHandler.addError("Logger.decryptLogFile failed", {
        origin: "Logger",
        path: resolvedSource,
        error: err?.message || "decrypt failure",
      });
      throw new Error("Logger.decryptLogFile failed");
    }
  }
  static async readLogFile(logFilePath, options = {}) {
    if (typeof logFilePath !== "string" || !logFilePath.trim()) {
      ErrorHandler.addError("Logger.readLogFile requires a file path", {
        origin: "Logger",
        path: logFilePath,
      });
      throw new Error("Logger.readLogFile requires a file path");
    }
    const resolvedSource = path.isAbsolute(logFilePath)
      ? logFilePath
      : path.resolve(logFilePath);
    try {
      await fs.promises.access(resolvedSource, fs.constants.R_OK);
    } catch {
      ErrorHandler.addError("Logger.readLogFile source missing", {
        origin: "Logger",
        path: resolvedSource,
      });
      throw new Error("Logger.readLogFile source missing");
    }
    const { decrypt = false, limit = 1000 } = options || {};
    const maxEntries = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : 1000;
    const rawContent = await fs.promises.readFile(resolvedSource, "utf8");
    const entries = [];
    const chunks = rawContent.split(/\r?\n/);
    for (let index = 0; index < chunks.length; index += 1) {
      if (entries.length >= maxEntries) break;
      const chunk = chunks[index];
      if (!chunk || !chunk.trim()) continue;
      try {
        const parsed = JSON.parse(chunk);
        if (decrypt) {
          const decrypted = Logger.decryptEntry(parsed);
          if (decrypted) {
            parsed.data = { ...(parsed.data || {}), ...decrypted };
          }
        }
        entries.push(parsed);
      } catch (innerErr) {
        ErrorHandler.addError("Logger.readLogFile could not parse entry", {
          origin: "Logger",
          path: resolvedSource,
          line: index + 1,
          error: innerErr?.message || "parse error",
        });
        entries.push({ raw: chunk, line: index + 1, parseError: true });
      }
    }
    return entries;
  }
}

module.exports = Logger;



