const ErrorHandler = require("./ErrorHandler.js");
const Logger = require("./UtilityLogger.js");
const SafeUtils = require("./SafeUtils.js");

class ApiHandler {
  constructor({ 
    routeConfig, 
    autoLoader, 
    logFlagOk = "startup", 
    logFlagError = "startup", 
    allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], 
    preValidationMiddleware = null, 
    dependencyRetries = 2,
    logger = Logger,
    safeUtils = SafeUtils,
    enableRouteCache = true,
    enableVersioning = false,
    handlerTimeout = 30000, // 30 seconds default
    debugMode = false,
    parallelHandlers = false,
    timestampFn = null
  }) {
    this._validateRouteConfig(routeConfig);
    this.routeConfig = routeConfig;
    this.autoLoader = autoLoader;
    this.logFlagOk = logFlagOk;
    this.logFlagError = logFlagError;
    this.allowedMethods = allowedMethods;
    this.preValidationMiddleware = preValidationMiddleware;
    this.dependencyRetries = dependencyRetries;
    this._paramDefsCache = new WeakMap(); // Cache for allowed keys Set
    
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
      console.error('[ApiHandler] Failed to load core utilities:', err.message);
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
      throw new TypeError("routeConfig must be a valid object. Received: " + typeof routeConfig);
    }
    if (!routeConfig.apiHandler) {
      throw new TypeError("routeConfig.apiHandler is required but was not provided");
    }
    if (!Array.isArray(routeConfig.apiHandler)) {
      throw new TypeError("routeConfig.apiHandler must be an array. Received: " + typeof routeConfig.apiHandler);
    }
    if (routeConfig.apiHandler.length === 0) {
      console.warn('[ApiHandler] Warning: routeConfig.apiHandler is empty - no routes configured');
    }
    for (let i = 0; i < routeConfig.apiHandler.length; i++) {
      const group = routeConfig.apiHandler[i];
      if (!group || typeof group !== "object") {
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
      console.error('[ApiHandler] CRITICAL: Unhandled exception in handleRootApi:', err);
      
      this.logger.writeLog({ 
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
    
    // Create request-scoped error handler with categorization
    const errorHandler = { errors: [] };
    errorHandler.add = (message, data = null, category = 'general') => {
      errorHandler.errors.push({ message, data, category, timestamp: this.timestampFn() });
    };
    errorHandler.hasErrors = () => errorHandler.errors.length > 0;
    errorHandler.getAll = () => errorHandler.errors;

    this._debugLog('\n🚀 [ApiHandler] === NEW API REQUEST ===');
    // Sanitize inputs before logging to prevent sensitive data leakage
    const sanitizedQuery = this._sanitizeForLogging(query);
    const sanitizedBody = this._sanitizeForLogging(body);
    this._debugLog('🚀 [ApiHandler] Method:', method, 'Query:', sanitizedQuery, 'Body:', sanitizedBody);

    // Validate HTTP method
    const normalizedMethod = String(method || "").toUpperCase();
    if (!this.allowedMethods.includes(normalizedMethod)) {
      const message = `Method ${normalizedMethod} not allowed. Supported methods: ${this.allowedMethods.join(', ')}`;
      this._debugLog('❌ [ApiHandler] Method not allowed:', normalizedMethod);
      errorHandler.add(message, { method: normalizedMethod, allowedMethods: this.allowedMethods }, 'method_validation');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.method_not_allowed", message, critical: false, data: { method: normalizedMethod, at: requestTimestamp } });
      return this._errorResponse(405, message, errorHandler.getAll());
    }

    const args = this._collectIncomingArgs(method, query, body);
    const sanitizedArgs = this._sanitizeForLogging(args);
    this._debugLog('🚀 [ApiHandler] Collected args:', sanitizedArgs);
    
    // Extract namespace, actionKey, and optional version
    const namespace = String(args.namespace || "").trim();
    const actionKey = String(args.action || "").trim();
    const version = this.enableVersioning ? String(args.version || args.v || "").trim() : null;
    
    const routeIdentifier = version ? `${namespace}/${actionKey}@${version}` : `${namespace}/${actionKey}`;
    this._debugLog(`🚀 [ApiHandler] Route requested: ${routeIdentifier}`);

    if (!namespace || !actionKey) {
      const message = "Missing required routing fields: 'namespace' and/or 'action'";
      this._debugLog('❌ [ApiHandler] Missing routing fields');
      errorHandler.add(message, { namespace, actionKey, version }, 'routing');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.route_fields_missing", message, critical: true, data: { method, at: requestTimestamp } });
      return this._errorResponse(400, message, errorHandler.getAll());
    }

    this._debugLog('🔍 [ApiHandler] Resolving route...');
    const resolved = this._resolveRouteFromArgs(namespace, actionKey, version);
    if (!resolved) {
      const message = `API route not found for ${namespace}/${actionKey}${version ? `@${version}` : ''}`;
      this._debugLog('❌ [ApiHandler] Route not found:', namespace + '/' + actionKey);
      errorHandler.add(message, { namespace, actionKey, version }, 'routing');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.route_not_found", message, critical: true, data: { namespace, actionKey, version, method, at: requestTimestamp } });
      return this._errorResponse(404, message);
    }
    this._debugLog('✅ [ApiHandler] Route found:', namespace + '/' + actionKey);
    const { entry } = resolved;

    // Validate entry structure
    if (!entry || typeof entry !== "object") {
      const message = `Invalid route entry structure for ${namespace}/${actionKey}`;
      errorHandler.add(message, { namespace, actionKey }, 'configuration');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.invalid_route_entry", message, critical: true, data: { namespace, actionKey, at: requestTimestamp } });
      return this._errorResponse(500, message, errorHandler.getAll());
    }

    // Execute pre-validation middleware if configured
    if (this.preValidationMiddleware && typeof this.preValidationMiddleware === 'function') {
      this._debugLog('🔍 [ApiHandler] Running pre-validation middleware...');
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
          args 
        });
        
        // Allow middleware to short-circuit the request
        if (middlewareResult && middlewareResult.abort === true) {
          this._debugLog('🛑 [ApiHandler] Pre-validation middleware aborted request');
          return middlewareResult.response || this._errorResponse(403, 'Request blocked by middleware');
        }
      } catch (err) {
        const sanitizedError = this._sanitizeErrorMessage(err);
        const message = `Pre-validation middleware failed: ${sanitizedError}`;
        errorHandler.add(message, { namespace, actionKey }, 'middleware');
        await this._safeLogWrite({ flag: this.logFlagError, action: "api.middleware_failed", message, critical: true, data: { namespace, actionKey, error: sanitizedError, at: requestTimestamp } });
        return this._errorResponse(500, message, errorHandler.getAll());
      }
    }

    this._debugLog('🔍 [ApiHandler] Starting validation...');
    this._debugLog('🔍 [ApiHandler] Route params config:', entry.params);
    let validated;
    try {
      const schema = this._buildValidationSchema(entry.params, args);
      this._debugLog('🔍 [ApiHandler] Built validation schema:', schema);
      
      // Support both sync and async validation
      const validationResult = this.safeUtils.sanitizeValidate(schema);
      validated = (validationResult && typeof validationResult.then === 'function') 
        ? await validationResult 
        : validationResult;
      
      this._debugLog('✅ [ApiHandler] Validation passed:', validated);
    } catch (err) {
      const sanitizedError = this._sanitizeErrorMessage(err);
      const message = `Validation failed for ${namespace}/${actionKey}: ${sanitizedError}`;
      this._debugLog('❌ [ApiHandler] Validation failed:', sanitizedError);
      errorHandler.add(message, { namespace, actionKey }, 'validation');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.validation_failed", message, critical: true, data: { namespace, actionKey, error: sanitizedError, at: requestTimestamp } });
      return this._errorResponse(400, message, errorHandler.getAll());
    }

    console.log('🔍 [ApiHandler] Sanitizing extra arguments...');
    const extra = this._sanitizeExtraArgs(entry.params, args, validated);
    console.log('✅ [ApiHandler] Extra args sanitized:', extra);

    let handlerFns;
    let lastError;
    
    // Retry logic for dependency loading
    for (let attempt = 0; attempt <= this.dependencyRetries; attempt++) {
      try {
        ({ handlerFns } = this.autoLoader.ensureRouteDependencies(entry));
        if (attempt > 0) {
          console.log(`✅ [ApiHandler] Dependencies loaded on attempt ${attempt + 1}`);
        }
        break; // Success, exit retry loop
      } catch (err) {
        lastError = err;
        if (attempt < this.dependencyRetries) {
          console.log(`⚠️ [ApiHandler] Dependency load attempt ${attempt + 1} failed, retrying...`);
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }
    
    // If all retries failed, return error
    if (!handlerFns) {
      const sanitizedError = this._sanitizeErrorMessage(lastError);
      const message = `Failed to load route dependencies for ${namespace}/${actionKey} after ${this.dependencyRetries + 1} attempts: ${sanitizedError}`;
      errorHandler.add(message, { namespace, actionKey, attempts: this.dependencyRetries + 1 }, 'dependencies');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.autoload_failed", message, critical: true, data: { namespace, actionKey, error: sanitizedError, attempts: this.dependencyRetries + 1, at: requestTimestamp } });
      return this._errorResponse(500, message, errorHandler.getAll());
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
      context: this._deepClone(context), 
      method 
    };
    
    // Freeze to prevent accidental mutations (handlers should not modify input)
    Object.freeze(basePipelineInput);
    Object.freeze(basePipelineInput.validated);
    Object.freeze(basePipelineInput.extra);
    Object.freeze(basePipelineInput.raw);
    
    console.log('🔄 [ApiHandler] Starting pipeline execution with', handlerFns.length, 'handlers');
    const sanitizedPipelineInput = this._sanitizeForLogging(basePipelineInput);
    console.log('🔄 [ApiHandler] Pipeline input:', sanitizedPipelineInput);
    
    const pipelineStartTime = Date.now();
    let lastNonUndefined;
    for (let i = 0; i < handlerFns.length; i++) {
      const fn = handlerFns[i];
      const handlerStartTime = Date.now();
      console.log(`🔄 [ApiHandler] Executing handler ${i + 1}/${handlerFns.length}: ${fn.name || 'anonymous'}`);
      
      try {
        // Individual try/catch for each handler to prevent one failure from crashing the app
        // Each handler receives isolated, frozen input to prevent context pollution
        const out = await fn(basePipelineInput);
        const handlerDuration = Date.now() - handlerStartTime;
        
        // Validate handler response structure
        if (out !== undefined && out !== null) {
          const validationError = this._validateHandlerResponse(out);
          if (validationError) {
            throw new TypeError(`Handler ${i + 1} returned invalid response: ${validationError}`);
          }
        }
        
        const sanitizedOut = this._sanitizeForLogging(out);
        console.log(`🔄 [ApiHandler] Handler ${i + 1} result (${handlerDuration}ms):`, sanitizedOut);
        
        if (out && typeof out === "object" && out.abort === true) {
          console.log(`🛑 [ApiHandler] Handler ${i + 1} requested abort, short-circuiting pipeline`);
          const sanitizedResponse = this._sanitizeForLogging(out.response);
          console.log('🛑 [ApiHandler] Abort response:', sanitizedResponse);
          return out.response;
        }
        if (typeof out !== "undefined") {
          lastNonUndefined = out;
          console.log(`✅ [ApiHandler] Handler ${i + 1} completed, stored result`);
        } else {
          console.log(`✅ [ApiHandler] Handler ${i + 1} completed, no result to store`);
        }
      } catch (err) {
        // Catch individual handler errors
        const handlerDuration = Date.now() - handlerStartTime;
        const message = `Handler ${i + 1} (${fn.name || 'anonymous'}) exception for ${namespace}/${actionKey}: ${err?.message || err}`;
        errorHandler.add(message, { namespace, actionKey, handlerIndex: i, handlerName: fn.name || 'anonymous', duration: handlerDuration });
        this.logger.writeLog({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, handlerIndex: i, error: String(err), stack: err?.stack, duration: handlerDuration, at: Date.now() } });
        return this._errorResponse(500, message, errorHandler.getAll());
      }
    }
    
    const pipelineDuration = Date.now() - pipelineStartTime;
    const totalDuration = Date.now() - requestStartTime;
    console.log(`✅ [ApiHandler] All pipeline handlers completed successfully in ${pipelineDuration}ms`);
    const sanitizedFinalResult = this._sanitizeForLogging(lastNonUndefined);
    console.log('✅ [ApiHandler] Final result:', sanitizedFinalResult);

    this.logger.writeLog({
      flag: this.logFlagOk,
      action: "api.ok",
      message: `Success: ${namespace}/${actionKey}`,
      critical: false,
      data: { namespace, actionKey, method, pipelineDuration, totalDuration, at: Date.now() }
    });

    return { ok: true, status: 200, data: typeof lastNonUndefined !== "undefined" ? lastNonUndefined : {} };
  }

  _resolveRouteFromArgs(namespace, actionKey, version = null) {
    // Check cache first if enabled
    const cacheKey = version ? `${namespace}/${actionKey}@${version}` : `${namespace}/${actionKey}`;
    
    if (this.enableRouteCache && this._routeCache.has(cacheKey)) {
      return this._routeCache.get(cacheKey);
    }
    
    const containers = Array.isArray(this.routeConfig?.apiHandler) ? this.routeConfig.apiHandler : [];
    
    for (const group of containers) {
      if (group && Object.prototype.hasOwnProperty.call(group, namespace)) {
        const ns = group[namespace];
        
        // Handle versioning if enabled
        if (this.enableVersioning && version) {
          // Look for versioned route: namespace.action.v1, namespace.action.v2, etc.
          const versionedKey = `${actionKey}.${version}`;
          if (ns && Object.prototype.hasOwnProperty.call(ns, versionedKey)) {
            const result = { entry: ns[versionedKey] };
            if (this.enableRouteCache) {
              this._routeCache.set(cacheKey, result);
            }
            return result;
          }
          
          // Look for action with version property
          if (ns && Object.prototype.hasOwnProperty.call(ns, actionKey)) {
            const entry = ns[actionKey];
            if (entry.version === version || (Array.isArray(entry.versions) && entry.versions.includes(version))) {
              const result = { entry };
              if (this.enableRouteCache) {
                this._routeCache.set(cacheKey, result);
              }
              return result;
            }
          }
        } else {
          // Standard lookup without versioning
          if (ns && Object.prototype.hasOwnProperty.call(ns, actionKey)) {
            const result = { entry: ns[actionKey] };
            if (this.enableRouteCache) {
              this._routeCache.set(cacheKey, result);
            }
            return result;
          }
        }
      }
    }
    
    // Cache null result too to avoid repeated lookups
    if (this.enableRouteCache) {
      this._routeCache.set(cacheKey, null);
    }
    
    return null;
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
        throw new TypeError("Each param definition must be a valid object");
      }
      
      const name = String(def.name || "").trim();
      if (!name) throw new TypeError("Param definition missing name");
      
      const type = String(def.type || "string").trim().toLowerCase();
      
      // Validate type is supported
      if (!validTypes.includes(type)) {
        throw new TypeError(`Invalid param type "${type}" for "${name}". Must be one of: ${validTypes.join(', ')}`);
      }
      
      // Apply type coercion to incoming value
      let coercedValue = incoming[name];
      if (coercedValue !== undefined && coercedValue !== null) {
        coercedValue = this._coerceType(coercedValue, type);
      }
      
      schema[name] = { value: coercedValue, type, required: !!def.required };
    }
    return schema;
  }

  _sanitizeExtraArgs(paramDefs = [], incoming = {}, validated = {}) {
    // Use cached Set if available to avoid recreation on every request
    let allowed;
    if (Array.isArray(paramDefs) && paramDefs.length > 0) {
      // Try to get cached Set
      if (!this._paramDefsCache.has(paramDefs)) {
        allowed = new Set(paramDefs.map((d) => String(d.name)));
        this._paramDefsCache.set(paramDefs, allowed);
      } else {
        allowed = this._paramDefsCache.get(paramDefs);
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
    
    // Prevent prototype pollution by filtering dangerous keys
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const filterDangerousKeys = (obj) => {
      const filtered = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && !dangerousKeys.includes(key)) {
          filtered[key] = obj[key];
        }
      }
      return filtered;
    };
    
    const safeQuery = filterDangerousKeys(q);
    const safeBody = filterDangerousKeys(b);
    
    // HEAD behaves like GET - query params only
    if (m === "GET" || m === "HEAD") return safeQuery;
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return { ...safeQuery, ...safeBody };
    return safeQuery;
  }

  _deepClone(obj) {
    // Handle primitives and null
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    // Handle Date
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    
    // Handle Array
    if (Array.isArray(obj)) {
      return obj.map(item => this._deepClone(item));
    }
    
    // Handle plain objects
    if (Object.prototype.toString.call(obj) === '[object Object]') {
      const cloned = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          cloned[key] = this._deepClone(obj[key]);
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
    
    // Check for circular references that could cause serialization issues
    try {
      JSON.stringify(response);
    } catch (err) {
      return `Response contains circular references or non-serializable data: ${err.message}`;
    }
    
    return null; // Valid
  }

  _sanitizeForLogging(data) {
    if (data === null || data === undefined) return data;
    
    // List of sensitive keys to redact
    const sensitiveKeys = ['password', 'token', 'secret', 'apikey', 'api_key', 'authorization', 'auth', 'credentials', 'creditcard', 'ssn', 'sessionid', 'session_id'];
    
    const sanitize = (obj, depth = 0) => {
      // Prevent infinite recursion
      if (depth > 5) return '[Max Depth Reached]';
      
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item, depth + 1));
      }
      
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = sanitize(value, depth + 1);
        } else {
          sanitized[key] = value;
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
      console.error('[ApiHandler] Logger failed:', err.message);
    }
  }

  _sanitizeErrorMessage(err) {
    if (!err) return 'Unknown error occurred';
    
    // Extract message
    let message = err?.message || String(err) || 'Unexpected error occurred';
    
    // Redact common sensitive patterns from error messages
    message = message.replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]');
    message = message.replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]');
    message = message.replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]');
    message = message.replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]');
    
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
        errorHandler.add(message, { namespace, actionKey, handlerIndex: i, handlerName: fn.name || 'anonymous', duration: handlerDuration }, 'handler_execution');
        await this._safeLogWrite({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, handlerIndex: i, error: sanitizedError, duration: handlerDuration, at: requestTimestamp } });
        return { ...this._errorResponse(500, message, errorHandler.getAll()), _isErrorResponse: true };
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
      errorHandler.add(message, { namespace, actionKey, handlerIndex: failedHandler.index }, 'handler_execution');
      await this._safeLogWrite({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, handlerIndex: failedHandler.index, error: failedHandler.error, at: requestTimestamp } });
      return { ...this._errorResponse(500, message, errorHandler.getAll()), _isErrorResponse: true };
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
    
    return Promise.race([
      fn(input),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Handler ${handlerIndex + 1} (${fn.name || 'anonymous'}) timed out after ${this.handlerTimeout}ms`));
        }, this.handlerTimeout);
      })
    ]);
  }

  _errorResponse(status, message, details = null) {
    return { ok: false, status, error: { message, details } };
  }
}

module.exports = ApiHandler;