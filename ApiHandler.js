const ErrorHandler = require("./ErrorHandler.js");
const Logger = require("./UtilityLogger.js");
const SafeUtils = require("./SafeUtils.js");
const crypto = require('crypto');

// Default configuration constants
const DEFAULT_CONFIG = Object.freeze({
  HANDLER_TIMEOUT_MS: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 100,
  MAX_ROUTE_CACHE_SIZE: 1000,
  MAX_SANITIZE_DEPTH: 5,
  REQUEST_ID_BYTES: 8
});

class ApiHandler {
  constructor({ 
    routeConfig, 
    autoLoader, 
    logFlagOk = "startup", 
    logFlagError = "startup", 
    allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], 
    preValidationMiddleware = null, 
    dependencyRetries = DEFAULT_CONFIG.MAX_RETRIES,
    logger = Logger,
    safeUtils = SafeUtils,
    enableRouteCache = true,
    enableVersioning = false,
    handlerTimeout = DEFAULT_CONFIG.HANDLER_TIMEOUT_MS,
    debugMode = false,
    parallelHandlers = false,
    timestampFn = null
  }) {
    try {
      this._validateRouteConfig(routeConfig);
    } catch (err) {
      ErrorHandler.addError(`ApiHandler constructor validation failed: ${err.message}`, {
        code: "CONSTRUCTOR_VALIDATION_FAILED",
        origin: "ApiHandler.constructor",
        data: { error: err.message }
      });
      throw new Error(`ApiHandler constructor validation failed: ${err.message}`);
    }
    this.routeConfig = routeConfig;
    this.autoLoader = autoLoader;
    this.logFlagOk = logFlagOk;
    this.logFlagError = logFlagError;
    this.allowedMethods = allowedMethods;
    this.preValidationMiddleware = preValidationMiddleware;
    this.dependencyRetries = dependencyRetries;
    this._paramDefsCache = new Map(); // Cache for allowed keys Set
    this.maxRouteCacheSize = DEFAULT_CONFIG.MAX_ROUTE_CACHE_SIZE;
    
    // New configuration options
    this.enableRouteCache = enableRouteCache;
    this.enableVersioning = enableVersioning;
    this.handlerTimeout = handlerTimeout;
    this.debugMode = debugMode;
    this.parallelHandlers = parallelHandlers;
    this.timestampFn = timestampFn || (() => Date.now()); // Injectable for testing
    
    // Route cache for performance
    this._routeCache = enableRouteCache ? new Map() : null;
    
    // Inject dependencies for testability
    this.logger = logger;
    this.safeUtils = safeUtils;
    
    // Async-safe initialization of core utilities
    if (this.autoLoader && typeof this.autoLoader.loadCoreUtilities === "function") {
      this._initCoreUtilities();
    }
  }

  async _initCoreUtilities() {
    try {
      const result = this.autoLoader.loadCoreUtilities();
      // Handle both sync and async returns
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (err) {
      ErrorHandler.addError(`Failed to load core utilities: ${err.message}`, {
        code: "CORE_UTILITIES_FAILED",
        origin: "ApiHandler._initCoreUtilities",
        data: { error: String(err), at: this.timestampFn() }
      });
      await this._safeLogWrite({ 
        flag: this.logFlagError, 
        action: "api.core_utilities_failed", 
        message: `Core utilities initialization failed: ${err?.message || err}`, 
        critical: true, 
        data: { error: String(err), at: this.timestampFn() } 
      });
    }
  }

  _validateRouteConfig(routeConfig) {
    if (!routeConfig || typeof routeConfig !== "object") {
      ErrorHandler.addError(`routeConfig must be a valid object. Received: ${typeof routeConfig}`, {
        code: "INVALID_ROUTE_CONFIG_TYPE",
        origin: "ApiHandler._validateRouteConfig",
        data: { receivedType: typeof routeConfig }
      });
      throw new TypeError("routeConfig must be a valid object. Received: " + typeof routeConfig);
    }
    if (!routeConfig.apiHandler) {
      ErrorHandler.addError('routeConfig.apiHandler is required but was not provided', {
        code: "MISSING_API_HANDLER",
        origin: "ApiHandler._validateRouteConfig",
        data: {}
      });
      throw new TypeError("routeConfig.apiHandler is required but was not provided");
    }
    if (!Array.isArray(routeConfig.apiHandler)) {
      ErrorHandler.addError(`routeConfig.apiHandler must be an array. Received: ${typeof routeConfig.apiHandler}`, {
        code: "INVALID_API_HANDLER_TYPE",
        origin: "ApiHandler._validateRouteConfig",
        data: { receivedType: typeof routeConfig.apiHandler }
      });
      throw new TypeError("routeConfig.apiHandler must be an array. Received: " + typeof routeConfig.apiHandler);
    }
    if (routeConfig.apiHandler.length === 0) {
      ErrorHandler.addError('routeConfig.apiHandler is empty - no routes configured', {
        code: "EMPTY_ROUTE_CONFIG",
        origin: "ApiHandler._validateRouteConfig",
        data: {}
      });
    }
    for (let i = 0; i < routeConfig.apiHandler.length; i++) {
      const group = routeConfig.apiHandler[i];
      if (!group || typeof group !== "object") {
        ErrorHandler.addError(`Each route group must be a valid object. Group at index ${i} is invalid: ${typeof group}`, {
          code: "INVALID_ROUTE_GROUP",
          origin: "ApiHandler._validateRouteConfig",
          data: { groupIndex: i, receivedType: typeof group }
        });
        throw new TypeError(`Each route group must be a valid object. Group at index ${i} is invalid: ` + typeof group);
      }
    }
  }

  async handleRootApi({ method = "POST", query = {}, body = {}, headers = {}, context = {} }) {
    // Catch-all error guard to prevent any unexpected exceptions from crashing the app
    try {
      return await this._handleRootApiInternal({ method, query, body, headers, context });
    } catch (err) {
      // Last-resort error handler for unexpected exceptions outside normal flow
      const message = `Unexpected API handler exception: ${err?.message || err}`;
      ErrorHandler.addError(message, {
        code: "CRITICAL_UNHANDLED_EXCEPTION",
        origin: "ApiHandler.handleRootApi",
        data: { 
          error: String(err), 
          stack: err?.stack,
          method,
          at: Date.now() 
        }
      });
      
      await this._safeLogWrite({ 
        flag: this.logFlagError, 
        action: "api.critical_unhandled_exception", 
        message, 
        critical: true, 
        data: { 
          error: String(err), 
          stack: err?.stack,
          method,
          at: Date.now() 
        } 
      });
      
      return this._errorResponse(500, 'Internal server error - unexpected exception', [{ message, data: { error: String(err) } }]);
    }
  }

  async _handleRootApiInternal({ method = "POST", query = {}, body = {}, headers = {}, context = {} }) {
    // Capture timestamp once for entire request
    const requestTimestamp = this.timestampFn();
    const requestStartTime = requestTimestamp;
    
    // Generate unique request ID for tracing (crypto-based for collision resistance)
    const randomHex = crypto.randomBytes(DEFAULT_CONFIG.REQUEST_ID_BYTES).toString('hex');
    const requestId = `req_${requestTimestamp}_${randomHex}`;
    
    // Create request-scoped error handler with categorization
    const errorHandler = { errors: [] };
    errorHandler.add = (message, data = null, category = 'general') => {
      errorHandler.errors.push({ message, data, category, timestamp: this.timestampFn(), requestId });
    };
    errorHandler.hasErrors = () => errorHandler.errors.length > 0;
    errorHandler.getAll = () => errorHandler.errors;

    // Sanitize inputs before logging to prevent sensitive data leakage
    const sanitizedQuery = this._sanitizeForLogging(query);
    const sanitizedBody = this._sanitizeForLogging(body);
    this._debugLog(`\n🚀 [ApiHandler] [${requestId}] New Request - Method: ${method}, Query:`, sanitizedQuery, 'Body:', sanitizedBody);

    // Validate HTTP method
    const normalizedMethod = String(method || "").toUpperCase();
    if (!this.allowedMethods.includes(normalizedMethod)) {
      // Provide specific guidance for common methods that might be unsupported
      const commonUnsupported = ['OPTIONS', 'PATCH', 'TRACE', 'CONNECT'];
      const hint = commonUnsupported.includes(normalizedMethod) 
        ? ` (${normalizedMethod} is not enabled by default; configure allowedMethods if needed)` 
        : '';
      const message = `Method ${normalizedMethod} not allowed. Supported methods: ${this.allowedMethods.join(', ')}${hint}`;
      this._debugLog(`❌ [ApiHandler] [${requestId}] Method not allowed: ${normalizedMethod}`);
      ErrorHandler.addError(message, {
        code: "METHOD_NOT_ALLOWED",
        origin: "ApiHandler._handleRootApiInternal",
        data: { method: normalizedMethod, allowedMethods: this.allowedMethods, requestId }
      });
      errorHandler.add(message, { method: normalizedMethod, allowedMethods: this.allowedMethods }, 'method_validation');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.method_not_allowed", message, critical: false, data: { method: normalizedMethod, requestId, at: requestTimestamp } });
      return this._errorResponse(405, message, errorHandler.getAll(), 'METHOD_NOT_ALLOWED', requestId);
    }

    const args = this._collectIncomingArgs(method, query, body);
    
    // Extract namespace, actionKey, and optional version
    const namespace = String(args.namespace || "").trim();
    const actionKey = String(args.action || "").trim();
    const version = this.enableVersioning ? String(args.version || args.v || "").trim() : null;
    
    const routeIdentifier = version ? `${namespace}/${actionKey}@${version}` : `${namespace}/${actionKey}`;
    const sanitizedArgs = this._sanitizeForLogging(args);
    this._debugLog(`🚀 [ApiHandler] [${requestId}] Route: ${routeIdentifier}, Args:`, sanitizedArgs);

    // Explicit validation: check for empty strings and actual content
    if (!namespace || namespace.length === 0 || !actionKey || actionKey.length === 0) {
      const message = "Missing or empty routing fields: 'namespace' and/or 'action' must be non-empty strings";
      this._debugLog(`❌ [ApiHandler] [${requestId}] Invalid routing fields:`, { namespace, actionKey });
      ErrorHandler.addError(message, {
        code: "MISSING_ROUTE_FIELDS",
        origin: "ApiHandler._handleRootApiInternal",
        data: { namespace, actionKey, version, requestId }
      });
      errorHandler.add(message, { namespace, actionKey, version }, 'routing');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.route_fields_missing", message, critical: true, data: { method, requestId, at: requestTimestamp } });
      return this._errorResponse(400, message, errorHandler.getAll(), 'MISSING_ROUTE_FIELDS', requestId);
    }

    const resolved = this._resolveRouteFromArgs(namespace, actionKey, version);
    
    // LRU cache management (Issue #9)
    if (resolved && this._routeCache && this._routeCache.size >= this.maxRouteCacheSize) {
      // Remove oldest entry (first key in Map maintains insertion order)
      const firstKey = this._routeCache.keys().next().value;
      if (firstKey) {
        this._routeCache.delete(firstKey);
      }
    }
    
    if (!resolved) {
      const message = `API route not found for ${routeIdentifier}`;
      this._debugLog(`❌ [ApiHandler] [${requestId}] Route not found: ${routeIdentifier}`);
      ErrorHandler.addError(message, {
        code: "ROUTE_NOT_FOUND",
        origin: "ApiHandler._handleRootApiInternal",
        data: { namespace, actionKey, version, requestId }
      });
      errorHandler.add(message, { namespace, actionKey, version }, 'routing');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.route_not_found", message, critical: true, data: { namespace, actionKey, version, method, requestId, at: requestTimestamp } });
      return this._errorResponse(404, message, null, 'ROUTE_NOT_FOUND', requestId);
    }
    this._debugLog(`✅ [ApiHandler] [${requestId}] Route resolved: ${routeIdentifier}`);
    const { entry } = resolved;

    // Validate entry structure
    if (!entry || typeof entry !== "object") {
      const message = `Invalid route entry structure for ${namespace}/${actionKey}`;
      ErrorHandler.addError(message, {
        code: "INVALID_ROUTE_ENTRY",
        origin: "ApiHandler._handleRootApiInternal",
        data: { namespace, actionKey }
      });
      errorHandler.add(message, { namespace, actionKey }, 'configuration');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.invalid_route_entry", message, critical: true, data: { namespace, actionKey, at: requestTimestamp } });
      return this._errorResponse(500, message, errorHandler.getAll(), 'INVALID_ROUTE_ENTRY', requestId);
    }

    // Execute pre-validation middleware if configured
    if (this.preValidationMiddleware && typeof this.preValidationMiddleware === 'function') {
      this._debugLog(`🔍 [ApiHandler] [${requestId}] Running pre-validation middleware...`);
      try {
        const middlewareResult = await this.preValidationMiddleware({ 
          method: normalizedMethod, 
          query, 
          body, 
          headers, 
          context, 
          namespace, 
          actionKey,
          version,
          args,
          requestId 
        });
        
        // Allow middleware to short-circuit the request
        if (middlewareResult && middlewareResult.abort === true) {
          this._debugLog(`🛑 [ApiHandler] [${requestId}] Pre-validation middleware aborted request`);
          return middlewareResult.response || this._errorResponse(403, 'Request blocked by middleware', null, 'MIDDLEWARE_BLOCKED', requestId);
        }
      } catch (err) {
        const sanitizedError = this._sanitizeErrorMessage(err);
        const message = `Pre-validation middleware failed: ${sanitizedError}`;
        ErrorHandler.addError(message, {
          code: "MIDDLEWARE_FAILED",
          origin: "ApiHandler._handleRootApiInternal",
          data: { namespace, actionKey, error: sanitizedError, requestId }
        });
        errorHandler.add(message, { namespace, actionKey }, 'middleware');
        await this._safeLogWrite({ flag: this.logFlagError, action: "api.middleware_failed", message, critical: true, data: { namespace, actionKey, requestId, error: sanitizedError, at: requestTimestamp } });
        return this._errorResponse(500, message, errorHandler.getAll(), 'MIDDLEWARE_FAILED', requestId);
      }
    }

    this._debugLog(`🔍 [ApiHandler] [${requestId}] Validating params...`);
    let validated;
    try {
      const schema = this._buildValidationSchema(entry.params, args);
      
      // Support both sync and async validation
      const validationResult = this.safeUtils.sanitizeValidate(schema);
      validated = (validationResult && typeof validationResult.then === 'function') 
        ? await validationResult 
        : validationResult;
      
      this._debugLog(`✅ [ApiHandler] [${requestId}] Validation passed`);
    } catch (err) {
      const sanitizedError = this._sanitizeErrorMessage(err);
      const message = `Validation failed for ${routeIdentifier}: ${sanitizedError}`;
      this._debugLog(`❌ [ApiHandler] [${requestId}] Validation failed:`, sanitizedError);
      ErrorHandler.addError(message, {
        code: "VALIDATION_FAILED",
        origin: "ApiHandler._handleRootApiInternal",
        data: { namespace, actionKey, error: sanitizedError, requestId }
      });
      errorHandler.add(message, { namespace, actionKey }, 'validation');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.validation_failed", message, critical: true, data: { namespace, actionKey, requestId, error: sanitizedError, at: requestTimestamp } });
      return this._errorResponse(400, message, errorHandler.getAll(), 'VALIDATION_FAILED', requestId);
    }

    this._debugLog(`🔍 [ApiHandler] [${requestId}] Sanitizing extra arguments...`);
    const rawExtra = this._sanitizeExtraArgs(entry.params, args, validated);
    // Namespace extra args to prevent collision with response keys like ok, status, error
    const extra = { userInput: rawExtra };
    this._debugLog(`✅ [ApiHandler] [${requestId}] Extra args namespaced under userInput`);

    let handlerFns;
    let lastError;
    
    // Retry logic for dependency loading
    for (let attempt = 0; attempt <= this.dependencyRetries; attempt++) {
      try {
        ({ handlerFns } = this.autoLoader.ensureRouteDependencies(entry));
        if (attempt > 0) {
          this._debugLog(`✅ [ApiHandler] Dependencies loaded on attempt ${attempt + 1}`);
        }
        break; // Success, exit retry loop
      } catch (err) {
        lastError = err;
        if (attempt < this.dependencyRetries) {
          this._debugLog(`⚠️ [ApiHandler] [${requestId}] Dependency load attempt ${attempt + 1} failed, retrying...`);
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }
    
    // If all retries failed, return error
    if (!handlerFns) {
      const sanitizedError = this._sanitizeErrorMessage(lastError);
      const message = `Failed to load route dependencies for ${routeIdentifier} after ${this.dependencyRetries + 1} attempts: ${sanitizedError}`;
      ErrorHandler.addError(message, {
        code: "AUTOLOAD_FAILED",
        origin: "ApiHandler._handleRootApiInternal",
        data: { namespace, actionKey, attempts: this.dependencyRetries + 1, error: sanitizedError, requestId }
      });
      errorHandler.add(message, { namespace, actionKey, attempts: this.dependencyRetries + 1 }, 'dependencies');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.autoload_failed", message, critical: true, data: { namespace, actionKey, requestId, error: sanitizedError, attempts: this.dependencyRetries + 1, at: requestTimestamp } });
      return this._errorResponse(500, message, errorHandler.getAll(), 'AUTOLOAD_FAILED', requestId);
    }

    // Deep-clone pipelineInput to isolate handler context and prevent mutations
    const basePipelineInput = { 
      validated: this._deepClone(validated), 
      extra: this._deepClone(extra), 
      raw: { 
        query: this._deepClone(query), 
        body: this._deepClone(body), 
        headers: this._deepClone(headers) 
      }, 
      context: { ...this._deepClone(context), requestId }, // Add requestId to context
      method 
    };
    
    // Freeze to prevent accidental mutations (handlers should not modify input)
    Object.freeze(basePipelineInput);
    Object.freeze(basePipelineInput.validated);
    Object.freeze(basePipelineInput.extra);
    Object.freeze(basePipelineInput.raw);
    Object.freeze(basePipelineInput.context);
    
    this._debugLog(`🔄 [ApiHandler] [${requestId}] Executing ${handlerFns.length} handler(s)...`);
    
    const pipelineStartTime = this.timestampFn();
    
    // Execute handlers (serial or parallel based on config)
    const lastNonUndefined = this.parallelHandlers
      ? await this._executeHandlersParallel(handlerFns, basePipelineInput, namespace, actionKey, errorHandler, requestTimestamp, pipelineStartTime)
      : await this._executeHandlersSerial(handlerFns, basePipelineInput, namespace, actionKey, errorHandler, requestTimestamp, pipelineStartTime);
    
    // Check if error response was returned
    if (lastNonUndefined && lastNonUndefined._isErrorResponse) {
      const { _isErrorResponse, ...response } = lastNonUndefined;
      return response;
    }

    const pipelineDuration = this.timestampFn() - pipelineStartTime;
    const totalDuration = this.timestampFn() - requestStartTime;
    this._debugLog(`✅ [ApiHandler] [${requestId}] Pipeline completed in ${pipelineDuration}ms (total: ${totalDuration}ms)`);

    await this._safeLogWrite({
      flag: this.logFlagOk,
      action: "api.ok",
      message: `Success: ${routeIdentifier}`,
      critical: false,
      data: { namespace, actionKey, method, requestId, pipelineDuration, totalDuration, at: requestTimestamp }
    });

    return { ok: true, status: 200, data: lastNonUndefined !== undefined ? lastNonUndefined : {}, requestId };
  }

  _resolveRouteFromArgs(namespace, actionKey, version = null) {
    // Check cache first if enabled
    const cacheKey = version ? `${namespace}/${actionKey}@${version}` : `${namespace}/${actionKey}`;
    
    if (this.enableRouteCache && this._routeCache.has(cacheKey)) {
      return this._routeCache.get(cacheKey);
    }
    
    // Find namespace in route config
    const ns = this._findNamespace(namespace);
    if (!ns) {
      // Cache null result to avoid repeated lookups
      if (this.enableRouteCache) {
        this._routeCache.set(cacheKey, null);
      }
      return null;
    }
    
    // Resolve entry based on versioning
    const entry = this.enableVersioning && version 
      ? this._resolveVersionedEntry(ns, actionKey, version)
      : this._resolveStandardEntry(ns, actionKey);
    
    const result = entry ? { entry } : null;
    
    // Cache result
    if (this.enableRouteCache) {
      this._routeCache.set(cacheKey, result);
    }
    
    return result;
  }

  _findNamespace(namespace) {
    const containers = Array.isArray(this.routeConfig?.apiHandler) ? this.routeConfig.apiHandler : [];
    
    for (const group of containers) {
      if (group && Object.prototype.hasOwnProperty.call(group, namespace)) {
        return group[namespace];
      }
    }
    
    return null;
  }

  _resolveVersionedEntry(ns, actionKey, version) {
    if (!ns) return null;
    
    // Strategy 1: Look for versioned key (e.g., "action.v1")
    const versionedKey = `${actionKey}.${version}`;
    if (Object.prototype.hasOwnProperty.call(ns, versionedKey)) {
      return ns[versionedKey];
    }
    
    // Strategy 2: Look for entry with version/versions property
    if (Object.prototype.hasOwnProperty.call(ns, actionKey)) {
      const entry = ns[actionKey];
      if (entry.version === version || (Array.isArray(entry.versions) && entry.versions.includes(version))) {
        return entry;
      }
    }
    
    return null;
  }

  _resolveStandardEntry(ns, actionKey) {
    return (ns && Object.prototype.hasOwnProperty.call(ns, actionKey)) ? ns[actionKey] : null;
  }

  _buildValidationSchema(paramDefs = [], incoming = {}) {
    // Pre-validate paramDefs structure
    if (!Array.isArray(paramDefs)) {
      paramDefs = [];
    }
    
    const schema = {};
    const validTypes = ['int', 'integer', 'float', 'numeric', 'bool', 'boolean', 'string', 'text', 'array', 'iterable', 'email', 'url', 'html', 'object'];
    
    for (const def of paramDefs) {
      // Validate each param definition structure
      if (!def || typeof def !== "object") {
        ErrorHandler.addError('Each param definition must be a valid object', {
          code: "INVALID_PARAM_DEFINITION",
          origin: "ApiHandler._buildValidationSchema",
          data: { receivedType: typeof def }
        });
        throw new TypeError("Each param definition must be a valid object");
      }
      
      const name = String(def.name || "").trim();
      if (!name) {
        ErrorHandler.addError('Param definition missing name', {
          code: "MISSING_PARAM_NAME",
          origin: "ApiHandler._buildValidationSchema",
          data: { def }
        });
        throw new TypeError("Param definition missing name");
      }
      
      const type = String(def.type || "string").trim().toLowerCase();
      
      // Validate type is supported
      if (!validTypes.includes(type)) {
        ErrorHandler.addError(`Invalid param type "${type}" for "${name}". Must be one of: ${validTypes.join(', ')}`, {
          code: "INVALID_PARAM_TYPE",
          origin: "ApiHandler._buildValidationSchema",
          data: { paramName: name, invalidType: type, validTypes }
        });
        throw new TypeError(`Invalid param type "${type}" for "${name}". Must be one of: ${validTypes.join(', ')}`);
      }
      
      // Apply type coercion to incoming value
      let coercedValue = incoming[name];
      
      // Apply default value for optional params if not provided
      if ((coercedValue === undefined || coercedValue === null) && !def.required && def.default !== undefined) {
        coercedValue = def.default;
      }
      
      if (coercedValue !== undefined && coercedValue !== null) {
        coercedValue = this._coerceType(coercedValue, type);
      }
      
      schema[name] = { value: coercedValue, type, required: !!def.required };
    }
    return schema;
  }

  _sanitizeExtraArgs(paramDefs = [], incoming = {}, validated = {}) {
    // Use cached Set with stable string keys (Issue #15)
    let allowed;
    if (Array.isArray(paramDefs) && paramDefs.length > 0) {
      // Create stable cache key from parameter definitions
      const cacheKey = paramDefs.map(d => `${d.name}:${d.type}`).join('|');
      
      // Try to get cached Set
      if (!this._paramDefsCache.has(cacheKey)) {
        allowed = new Set(paramDefs.map((d) => String(d.name)));
        this._paramDefsCache.set(cacheKey, allowed);
      } else {
        allowed = this._paramDefsCache.get(cacheKey);
      }
    } else {
      allowed = new Set();
    }
    
    // Also exclude validated keys to prevent duplication
    const validatedKeys = new Set(Object.keys(validated || {}));
    
    const extra = {};
    for (const [key, val] of Object.entries(incoming || {})) {
      // Skip if in param definitions or already in validated
      if (allowed.has(key) || validatedKeys.has(key)) continue;
      
      let cleaned = null;
      switch (typeof val) {
        case "string": cleaned = this.safeUtils.sanitizeTextField(val); break;
        case "number": cleaned = this.safeUtils.sanitizeFloat(val); break;
        case "boolean": cleaned = this.safeUtils.sanitizeBoolean(val); break;
        case "object":
          if (val === null) cleaned = null;
          else if (Array.isArray(val)) cleaned = this.safeUtils.sanitizeArray(val);
          else cleaned = this.safeUtils.sanitizeObject(val);
          break;
        default: cleaned = null;
      }
      if (cleaned !== null && cleaned !== undefined) extra[key] = cleaned;
    }
    return extra;
  }

  _collectIncomingArgs(method = "POST", query = {}, body = {}) {
    const m = String(method || "").toUpperCase();
    const q = query && typeof query === "object" ? query : {};
    const b = body && typeof body === "object" ? body : {};
    
    // Use deep sanitization for complete prototype pollution protection (Issue #3)
    const safeQuery = this.safeUtils.sanitizeDeep(q);
    const safeBody = this.safeUtils.sanitizeDeep(b);
    
    // HEAD behaves like GET - query params only
    if (m === "GET" || m === "HEAD") return safeQuery;
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return { ...safeQuery, ...safeBody };
    return safeQuery;
  }

  _deepClone(obj, seen = new WeakSet()) {
    // Handle primitives and null
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    // Circular reference detection (Issue #8)
    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);
    
    // Handle Date
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    
    // Handle Array
    if (Array.isArray(obj)) {
      return obj.map(item => this._deepClone(item, seen));
    }
    
    // Handle plain objects
    if (Object.prototype.toString.call(obj) === '[object Object]') {
      const cloned = {};
      // Use for...in for better performance (Issue #14)
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          cloned[key] = this._deepClone(obj[key], seen);
        }
      }
      return cloned;
    }
    
    // For other types (functions, symbols, etc.), return as-is
    // These shouldn't typically be in pipelineInput, but handle gracefully
    return obj;
  }

  _coerceType(value, type) {
    try {
      switch (type) {
        case 'int':
        case 'integer':
          if (typeof value === 'string') {
            const parsed = parseInt(value, 10);
            return isNaN(parsed) ? value : parsed;
          }
          return value;
          
        case 'float':
        case 'numeric':
          if (typeof value === 'string') {
            const parsed = parseFloat(value);
            return isNaN(parsed) ? value : parsed;
          }
          return value;
          
        case 'bool':
        case 'boolean':
          if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === 'true' || lower === '1') return true;
            if (lower === 'false' || lower === '0') return false;
          }
          return value;
          
        case 'array':
          // Try to parse JSON string to array
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              return Array.isArray(parsed) ? parsed : value;
            } catch {
              return value;
            }
          }
          return value;
          
        default:
          return value;
      }
    } catch {
      // If coercion fails, return original value for validator to handle
      return value;
    }
  }

  _validateHandlerResponse(response) {
    // Validate that handler returns valid structure
    if (response === null || response === undefined) {
      return null; // Allow null/undefined returns
    }
    
    // If it's an abort response, validate structure
    if (typeof response === 'object' && response.abort === true) {
      if (!response.response) {
        return 'Abort response missing "response" property';
      }
      if (typeof response.response !== 'object') {
        return 'Abort response.response must be an object';
      }
    }
    
    // Check for circular references using WeakSet (Issue #13)
    const circularCheck = this._hasCircularReference(response);
    if (circularCheck) {
      return 'Response contains circular references';
    }
    
    return null; // Valid
  }

  _sanitizeForLogging(data) {
    if (data === null || data === undefined) return data;
    
    // Expanded list of sensitive keys to redact (Issue #5)
    const sensitiveKeys = [
      'password', 'passwd', 'pwd',
      'token', 'access_token', 'refresh_token', 'id_token', 'bearer',
      'secret', 'client_secret', 'api_secret', 'secret_key',
      'apikey', 'api_key', 'key',
      'authorization', 'auth',
      'credentials', 'credential',
      'creditcard', 'credit_card', 'cardnumber', 'cvv', 'cvc',
      'ssn', 'social_security',
      'sessionid', 'session_id', 'session',
      'private_key', 'privatekey',
      'pin', 'pincode'
    ];
    
    const sanitize = (obj, depth = 0) => {
      // Prevent infinite recursion
      if (depth > DEFAULT_CONFIG.MAX_SANITIZE_DEPTH) return '[Max Depth Reached]';
      
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item, depth + 1));
      }
      
      const sanitized = {};
      // Use for...in for better performance (Issue #14)
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          const lowerKey = key.toLowerCase();
          if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '[REDACTED]';
          } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitize(value, depth + 1);
          } else {
            sanitized[key] = value;
          }
        }
      }
      return sanitized;
    };
    
    return sanitize(data);
  }

  _debugLog(...args) {
    if (this.debugMode) {
      console.log(...args);
    }
  }

  async _safeLogWrite(logData) {
    try {
      const result = this.logger.writeLog(logData);
      // Handle async logger
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (err) {
      // Fallback if logger fails - don't let logging errors crash the app
      ErrorHandler.addError(`Logger failed: ${err.message}`, {
        code: "LOGGER_FAILED",
        origin: "ApiHandler._safeLogWrite",
        data: { error: err.message }
      });
    }
  }

  _sanitizeErrorMessage(err) {
    if (!err) return 'Unknown error occurred';
    
    // Extract message
    let message = err?.message || String(err) || 'Unexpected error occurred';
    
    // Enhanced sanitization with multiple patterns (Issue #6)
    // Basic key=value patterns
    message = message.replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]');
    message = message.replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]');
    message = message.replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]');
    message = message.replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]');
    
    // URL-encoded patterns
    message = message.replace(/password%3D[^&\s]+/gi, 'password%3D[REDACTED]');
    message = message.replace(/token%3D[^&\s]+/gi, 'token%3D[REDACTED]');
    
    // Connection strings (e.g., mongodb://user:pass@host)
    message = message.replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@');
    
    // Bearer tokens
    message = message.replace(/Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, 'Bearer [REDACTED]');
    
    // AWS-style keys (AKIA...)
    message = message.replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]');
    
    // JWT-like patterns (xxx.yyy.zzz)
    message = message.replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g, '[JWT_REDACTED]');
    
    // Limit stack trace exposure in production
    if (!this.debugMode && err?.stack) {
      // Don't include full stack trace in error message
      return message;
    }
    
    return message;
  }

  _stripInternalMetadata(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    // List of internal metadata prefixes to strip
    const internalPrefixes = ['_', '__'];
    const internalKeys = ['__meta', '_debug', '_internal', '__proto__', 'constructor', 'prototype'];
    
    if (Array.isArray(data)) {
      return data.map(item => this._stripInternalMetadata(item));
    }
    
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip keys that start with _ or __ or are in internal list
      if (internalKeys.includes(key) || internalPrefixes.some(prefix => key.startsWith(prefix))) {
        continue;
      }
      
      // Recursively clean nested objects
      if (value && typeof value === 'object') {
        cleaned[key] = this._stripInternalMetadata(value);
      } else {
        cleaned[key] = value;
      }
    }
    
    return cleaned;
  }

  async _executeHandlersSerial(handlerFns, basePipelineInput, namespace, actionKey, errorHandler, requestTimestamp, pipelineStartTime) {
    let lastNonUndefined;
    
    for (let i = 0; i < handlerFns.length; i++) {
      const fn = handlerFns[i];
      const handlerStartTime = this.timestampFn();
      this._debugLog(`🔄 [ApiHandler] Executing handler ${i + 1}/${handlerFns.length}: ${fn.name || 'anonymous'}`);
      
      try {
        // Execute handler with timeout
        const out = await this._executeHandlerWithTimeout(fn, basePipelineInput, i);
        const handlerDuration = this.timestampFn() - handlerStartTime;
        
        // Validate handler response structure
        if (out !== undefined && out !== null) {
          const validationError = this._validateHandlerResponse(out);
          if (validationError) {
            throw new TypeError(`Handler ${i + 1} returned invalid response: ${validationError}`);
          }
        }
        
        const sanitizedOut = this._sanitizeForLogging(out);
        this._debugLog(`🔄 [ApiHandler] Handler ${i + 1} result (${handlerDuration}ms):`, sanitizedOut);
        
        if (out && typeof out === "object" && out.abort === true) {
          this._debugLog(`🛑 [ApiHandler] Handler ${i + 1} requested abort, short-circuiting pipeline`);
          const sanitizedResponse = this._sanitizeForLogging(out.response);
          this._debugLog('🛑 [ApiHandler] Abort response:', sanitizedResponse);
          return { ...out.response, _isErrorResponse: true };
        }
        if (typeof out !== "undefined") {
          lastNonUndefined = out;
          this._debugLog(`✅ [ApiHandler] Handler ${i + 1} completed, stored result`);
        } else {
          this._debugLog(`✅ [ApiHandler] Handler ${i + 1} completed, no result to store`);
        }
      } catch (err) {
        // Catch individual handler errors
        const handlerDuration = this.timestampFn() - handlerStartTime;
        const sanitizedError = this._sanitizeErrorMessage(err);
        const message = `Handler ${i + 1} (${fn.name || 'anonymous'}) exception for ${namespace}/${actionKey}: ${sanitizedError}`;
        ErrorHandler.addError(message, {
          code: "HANDLER_EXCEPTION",
          origin: "ApiHandler._executeHandlersSerial",
          data: { namespace, actionKey, handlerIndex: i, handlerName: fn.name || 'anonymous', duration: handlerDuration, error: sanitizedError }
        });
        errorHandler.add(message, { namespace, actionKey, handlerIndex: i, handlerName: fn.name || 'anonymous', duration: handlerDuration }, 'handler_execution');
        await this._safeLogWrite({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, handlerIndex: i, error: sanitizedError, duration: handlerDuration, at: requestTimestamp } });
        return { ...this._errorResponse(500, message, errorHandler.getAll(), 'HANDLER_EXCEPTION', requestId), _isErrorResponse: true };
      }
    }
    
    return lastNonUndefined;
  }

  async _executeHandlersParallel(handlerFns, basePipelineInput, namespace, actionKey, errorHandler, requestTimestamp, pipelineStartTime) {
    this._debugLog('🔄 [ApiHandler] Executing handlers in parallel mode');
    
    const handlerPromises = handlerFns.map(async (fn, i) => {
      const handlerStartTime = this.timestampFn();
      try {
        const out = await this._executeHandlerWithTimeout(fn, basePipelineInput, i);
        const handlerDuration = this.timestampFn() - handlerStartTime;
        
        // Validate handler response
        if (out !== undefined && out !== null) {
          const validationError = this._validateHandlerResponse(out);
          if (validationError) {
            throw new TypeError(`Handler ${i + 1} returned invalid response: ${validationError}`);
          }
        }
        
        return { index: i, success: true, result: out, duration: handlerDuration };
      } catch (err) {
        const handlerDuration = this.timestampFn() - handlerStartTime;
        const sanitizedError = this._sanitizeErrorMessage(err);
        return { index: i, success: false, error: sanitizedError, duration: handlerDuration, handlerName: fn.name || 'anonymous' };
      }
    });
    
    const results = await Promise.all(handlerPromises);
    
    // Check for errors
    const failedHandler = results.find(r => !r.success);
    if (failedHandler) {
      const message = `Handler ${failedHandler.index + 1} (${failedHandler.handlerName}) exception: ${failedHandler.error}`;
      ErrorHandler.addError(message, {
        code: "HANDLER_EXCEPTION",
        origin: "ApiHandler._executeHandlersParallel",
        data: { namespace, actionKey, handlerIndex: failedHandler.index, handlerName: failedHandler.handlerName, error: failedHandler.error }
      });
      errorHandler.add(message, { namespace, actionKey, handlerIndex: failedHandler.index }, 'handler_execution');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, handlerIndex: failedHandler.index, error: failedHandler.error, at: requestTimestamp } });
      return { ...this._errorResponse(500, message, errorHandler.getAll(), 'HANDLER_EXCEPTION', requestId), _isErrorResponse: true };
    }
    
    // Return last non-undefined result
    let lastNonUndefined;
    for (const result of results) {
      if (typeof result.result !== 'undefined') {
        lastNonUndefined = result.result;
      }
    }
    
    return lastNonUndefined;
  }

  async _executeHandlerWithTimeout(fn, input, handlerIndex) {
    if (!this.handlerTimeout || this.handlerTimeout <= 0) {
      // No timeout configured
      return await fn(input);
    }
    
    // Fix memory leak by clearing timeout (Issue #7)
    let timeoutId;
    try {
      return await Promise.race([
        fn(input),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Handler ${handlerIndex + 1} (${fn.name || 'anonymous'}) timed out after ${this.handlerTimeout}ms`));
          }, this.handlerTimeout);
        })
      ]);
    } finally {
      // Always clear timeout to prevent memory leak
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  _hasCircularReference(obj, seen = new WeakSet()) {
    if (obj === null || typeof obj !== 'object') {
      return false;
    }
    
    if (seen.has(obj)) {
      return true;
    }
    
    seen.add(obj);
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (this._hasCircularReference(item, seen)) {
          return true;
        }
      }
    } else {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (this._hasCircularReference(obj[key], seen)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  _deepFreeze(obj) {
    // Get all property names including non-enumerable ones
    Object.freeze(obj);
    
    Object.getOwnPropertyNames(obj).forEach(prop => {
      const value = obj[prop];
      
      // Recursively freeze nested objects
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        this._deepFreeze(value);
      }
    });
    
    return obj;
  }

  _errorResponse(status, message, details = null, code = null, requestId = null) {
    // Standardized error format (Issue #16)
    return {
      ok: false,
      status,
      error: {
        code: code || `ERROR_${status}`,
        message,
        details: details || [],
        timestamp: this.timestampFn ? this.timestampFn() : Date.now(),
        requestId: requestId || 'unknown'
      }
    };
  }
}

module.exports = ApiHandler;