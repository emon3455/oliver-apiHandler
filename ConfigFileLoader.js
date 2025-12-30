/*
 * Methods:
 *    loadConfig() ƒ?" Load a sanitized config file from the project root directory.
 *    load() ƒ?" Load a file via absolute or relative path.
 *    sanitizeConfigPath() ƒ?" Ensure config file paths are safe.
 *    resolveInBaseDir() ƒ?" Resolve paths within the project root directory safely.
 *    atomicReadFile() ƒ?" Perform atomic file reads.
 *    parseJsonStrict() ƒ?" Parse JSON with strict validation.
 *    deepFreeze() ƒ?" Deep freeze an object graph recursively.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SafeUtils = require("./SafeUtils");
const ErrorHandler = require("./ErrorHandler");

/**
 * Class ConfigSchemaLoader
 *
 * Generic secure JSON configuration loader that enforces filename sanitization,
 * caches by file metadata, and deep-freezes configuration outputs.
 */
class ConfigSchemaLoader {
  // Private in-memory cache keyed by sanitized relative file paths.
  static #cache = new Map();
  // Base directory (project root) that backs config lookups.
  static #baseDirectoryPath = path.resolve(process.cwd());

  /**
   * Load a sanitized config file from the project root directory.
   *
   * @param {string} requestedConfigPath - Path (relative to repo root) of the config file.
   * @returns {object} Frozen config object resolved from disk.
   */
  static loadConfig(requestedConfigPath) {
    if (!requestedConfigPath || typeof requestedConfigPath !== "string") {
      ErrorHandler.addError("loadConfig(filePath) requires a file path string.", {
        code: "INVALID_FILE_PATH",
        file: requestedConfigPath || null,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("loadConfig(filePath) requires a file path string.");
    }
    const sanitizedInputPath = SafeUtils.sanitizeString(requestedConfigPath);
    const sanitizedRelativePath = this.#sanitizeConfigPath(sanitizedInputPath);
    const resolvedConfigFilePath =
      this.#resolveInBaseDir(sanitizedRelativePath);
    if (!fs.existsSync(resolvedConfigFilePath)) {
      ErrorHandler.addError(`Config file not found: ${resolvedConfigFilePath}`, {
        code: "FILE_NOT_FOUND",
        file: resolvedConfigFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error(`Config file not found: ${resolvedConfigFilePath}`);
    }
    const initialConfigFileStats = fs.statSync(resolvedConfigFilePath);
    if (!initialConfigFileStats.isFile()) {
      ErrorHandler.addError(`Config path is not a file: ${resolvedConfigFilePath}`, {
        code: "NOT_A_FILE",
        file: resolvedConfigFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error(`Config path is not a file: ${resolvedConfigFilePath}`);
    }
    const cacheKey = sanitizedRelativePath;
    const cachedConfigEntry = this.#cache.get(cacheKey);
    if (
      cachedConfigEntry &&
      cachedConfigEntry.mtimeMs === initialConfigFileStats.mtimeMs &&
      cachedConfigEntry.size === initialConfigFileStats.size
    ) {
      return cachedConfigEntry.config;
    }
    const serializedConfig = this.#atomicReadFile(resolvedConfigFilePath);
    const parsedConfigObject = this.#parseJsonStrict(
      serializedConfig,
      resolvedConfigFilePath,
    );
    const frozenConfig = this.#deepFreeze(parsedConfigObject);
    const latestConfigFileStats = fs.statSync(resolvedConfigFilePath);
    this.#cache.set(cacheKey, {
      mtimeMs: latestConfigFileStats.mtimeMs,
      size: latestConfigFileStats.size,
      config: frozenConfig,
    });
    return frozenConfig;
  }

  /**
   * Load a file via absolute or relative path.
   *
   * @param {string} requestedArbitraryFilePath - Absolute or relative path to load.
   * @returns {object} Parsed and frozen configuration object.
   */
  static load(requestedArbitraryFilePath) {
    if (
      !requestedArbitraryFilePath ||
      typeof requestedArbitraryFilePath !== "string"
    ) {
      ErrorHandler.addError("load(filePath) requires a file path string.", {
        code: "INVALID_FILE_PATH",
        file: requestedArbitraryFilePath || null,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("load(filePath) requires a file path string.");
    }
    const sanitizedFilePathRequest = SafeUtils.sanitizeString(
      requestedArbitraryFilePath,
    );
    if (!sanitizedFilePathRequest.length) {
      ErrorHandler.addError("load(filePath) requires a non-empty path string.", {
        code: "INVALID_FILE_PATH",
        file: requestedArbitraryFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("load(filePath) requires a non-empty path string.");
    }
    const resolvedArbitraryFilePath = path.resolve(
      process.cwd(),
      sanitizedFilePathRequest,
    );
    if (!fs.existsSync(resolvedArbitraryFilePath)) {
      ErrorHandler.addError(`Config file not found: ${resolvedArbitraryFilePath}`, {
        code: "FILE_NOT_FOUND",
        file: resolvedArbitraryFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error(`Config file not found: ${resolvedArbitraryFilePath}`);
    }
    const resolvedFileStats = fs.statSync(resolvedArbitraryFilePath);
    if (!resolvedFileStats.isFile()) {
      ErrorHandler.addError(
        `Config path is not a file: ${resolvedArbitraryFilePath}`,
        {
          code: "NOT_A_FILE",
          file: resolvedArbitraryFilePath,
          origin: "ConfigSchemaLoader",
        },
      );
      throw new Error(`Config path is not a file: ${resolvedArbitraryFilePath}`);
    }
    const fileContent = fs.readFileSync(resolvedArbitraryFilePath, "utf8");
    const parsedConfigObject = this.#parseJsonStrict(
      fileContent,
      resolvedArbitraryFilePath,
    );
    return this.#deepFreeze(parsedConfigObject);
  }

  /**
   * Ensure config file paths are safe.
   *
   * @param {string} candidatePath - Already sanitized path string.
   * @returns {string} Sanitized relative path (no leading separators).
   */
  static #sanitizeConfigPath(candidatePath) {
    if (!candidatePath || typeof candidatePath !== "string") {
      ErrorHandler.addError("loadConfig(filePath) requires a file path string.", {
        code: "INVALID_FILE_NAME",
        file: candidatePath || null,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("loadConfig(filePath) requires a file path string.");
    }
    if (!candidatePath.length) {
      ErrorHandler.addError("Config file path cannot be empty.", {
        code: "INVALID_FILE_NAME",
        file: candidatePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("Config file path cannot be empty.");
    }
    if (candidatePath.includes("\0")) {
      ErrorHandler.addError("Config file path cannot contain null bytes.", {
        code: "INVALID_FILE_NAME",
        file: candidatePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("Config file path cannot contain null bytes.");
    }
    const normalizedCase = candidatePath.toLowerCase();
    if (!normalizedCase.endsWith(".json")) {
      ErrorHandler.addError(`Config file must be .json: ${candidatePath}`, {
        code: "INVALID_FILE_EXT",
        file: candidatePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error(`Config file must be .json: ${candidatePath}`);
    }
    const withoutLeadingSeparators = candidatePath.replace(/^[\\/]+/, "");
    if (path.isAbsolute(withoutLeadingSeparators)) {
      ErrorHandler.addError(
        "loadConfig(filePath) expects a path relative to the project root.",
        {
          code: "INVALID_FILE_PATH",
          file: candidatePath,
          origin: "ConfigSchemaLoader",
        },
      );
      throw new Error(
        "loadConfig(filePath) expects a path relative to the project root.",
      );
    }
    const normalizedPath = path.normalize(withoutLeadingSeparators);
    if (normalizedPath.length === 0) {
      ErrorHandler.addError("Config file path cannot be empty.", {
        code: "INVALID_FILE_NAME",
        file: candidatePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("Config file path cannot be empty.");
    }
    return normalizedPath;
  }

  /**
   * Resolve a sanitized relative path within the project root safely.
   *
   * @param {string} sanitizedRelativePath - Validated relative path to resolve.
   * @returns {string} Absolute path to the file within the project root directory.
   */
  static #resolveInBaseDir(sanitizedRelativePath) {
    const resolvedFilePath = path.resolve(
      this.#baseDirectoryPath,
      sanitizedRelativePath,
    );
    const normalizedBaseDirectory = this.#baseDirectoryPath.endsWith(path.sep)
      ? this.#baseDirectoryPath
      : this.#baseDirectoryPath + path.sep;
    if (!resolvedFilePath.startsWith(normalizedBaseDirectory)) {
      ErrorHandler.addError("Blocked path traversal attempt.", {
        code: "PATH_TRAVERSAL_BLOCKED",
        file: resolvedFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("Blocked path traversal attempt.");
    }
    return resolvedFilePath;
  }

  /**
   * Perform atomic file reads.
   *
   * @param {string} configFilePath - Path to the config file to read.
   * @returns {string} Raw file contents.
   */
  static #atomicReadFile(configFilePath) {
    for (
      let readAttemptNumber = 1;
      readAttemptNumber <= 3;
      readAttemptNumber++
    ) {
      const fileStatsBeforeRead = fs.statSync(configFilePath);
      const fileRawContent = fs.readFileSync(configFilePath, "utf8");
      const fileStatsAfterRead = fs.statSync(configFilePath);
      const isContentChanged =
        fileStatsBeforeRead.mtimeMs !== fileStatsAfterRead.mtimeMs ||
        fileStatsBeforeRead.size !== fileStatsAfterRead.size ||
        (typeof fileRawContent === "string" &&
          fileRawContent.length === 0 &&
          fileStatsAfterRead.size > 0);
      if (!isContentChanged) {
        return fileRawContent;
      }
      if (readAttemptNumber === 3) {
        ErrorHandler.addError(
          "Config file changed while reading; atomic read failed after retries.",
          {
            code: "ATOMIC_READ_FAILED",
            file: configFilePath,
            origin: "ConfigSchemaLoader",
          },
        );
        throw new Error(
          "Config file changed while reading; atomic read failed after retries.",
        );
      }
    }
    ErrorHandler.addError("Atomic read failed.", {
      code: "ATOMIC_READ_FAILED",
      file: configFilePath,
      origin: "ConfigSchemaLoader",
    });
    throw new Error("Atomic read failed.");
  }

  /**
   * Parse JSON with strict validation.
   *
   * @param {string} rawJsonString - Raw string content from disk.
   * @param {string} configFilePath - File path used for error context.
   * @returns {*} Parsed JSON value.
   */
  static #parseJsonStrict(rawJsonString, configFilePath) {
    if (typeof rawJsonString !== "string") {
      ErrorHandler.addError("Invalid config content (expected string).", {
        code: "INVALID_CONTENT",
        file: configFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("Invalid config content (expected string).");
    }
    const trimmedJsonContent = rawJsonString.trim();
    if (
      !trimmedJsonContent.startsWith("{") &&
      !trimmedJsonContent.startsWith("[")
    ) {
      ErrorHandler.addError("Invalid JSON syntax: content does not look like JSON.", {
        code: "INVALID_JSON_SYNTAX",
        file: configFilePath,
        origin: "ConfigSchemaLoader",
      });
      throw new Error("Invalid JSON syntax: content does not look like JSON.");
    }
    try {
      return JSON.parse(trimmedJsonContent);
    } catch (jsonParseError) {
      const parseErrorMessage =
        jsonParseError && jsonParseError.message
          ? jsonParseError.message
          : String(jsonParseError);
      ErrorHandler.addError(
        `Invalid JSON syntax: ${parseErrorMessage}`,
        {
          code: "INVALID_JSON_SYNTAX",
          file: configFilePath,
          origin: "ConfigSchemaLoader",
        },
      );
      throw new Error(`Invalid JSON syntax: ${parseErrorMessage}`);
    }
  }

  /**
   * Deep freeze an object graph recursively.
   *
   * @param {any} objectToFreeze - The value to deep-freeze if it is an object.
   * @returns {any} The original value, frozen when applicable.
   */
  static #deepFreeze(objectToFreeze) {
    if (objectToFreeze === null || typeof objectToFreeze !== "object")
      return objectToFreeze;
    Object.freeze(objectToFreeze);
    for (const propertyKey of Object.keys(objectToFreeze)) {
      const propertyValue = objectToFreeze[propertyKey];
      if (
        propertyValue &&
        typeof propertyValue === "object" &&
        !Object.isFrozen(propertyValue)
      ) {
        this.#deepFreeze(propertyValue);
      }
    }
    return objectToFreeze;
  }
}

module.exports = ConfigSchemaLoader;
