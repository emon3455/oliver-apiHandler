const ErrorHandler = require("./ErrorHandler.js");
const Logger = require("./UtilityLogger.js");
const SafeUtils = require("./SafeUtils.js");

class ApiHandler {
  constructor({ routeConfig, autoLoader, logFlagOk = "startup", logFlagError = "startup" }) {
    this._validateRouteConfig(routeConfig);
    this.routeConfig = routeConfig;
    this.autoLoader = autoLoader;
    this.logFlagOk = logFlagOk;
    this.logFlagError = logFlagError;
    if (this.autoLoader && typeof this.autoLoader.loadCoreUtilities === "function") {
      this.autoLoader.loadCoreUtilities();
    }
  }

  _validateRouteConfig(routeConfig) {
    if (!routeConfig || typeof routeConfig !== "object") {
      throw new TypeError("routeConfig must be a valid object");
    }
    if (!Array.isArray(routeConfig.apiHandler)) {
      throw new TypeError("routeConfig.apiHandler must be an array");
    }
    for (const group of routeConfig.apiHandler) {
      if (!group || typeof group !== "object") {
        throw new TypeError("Each route group must be a valid object");
      }
    }
  }

  async handleRootApi({ method = "POST", query = {}, body = {}, headers = {}, context = {} }) {
    // Create request-scoped error handler to prevent cross-request leakage
    const errorHandler = { errors: [] };
    errorHandler.add = (message, data = null) => errorHandler.errors.push({ message, data });
    errorHandler.hasErrors = () => errorHandler.errors.length > 0;
    errorHandler.getAll = () => errorHandler.errors;

    console.log('\n🚀 [ApiHandler] === NEW API REQUEST ===');
    // Sanitize inputs before logging to prevent sensitive data leakage
    const sanitizedQuery = this._sanitizeForLogging(query);
    const sanitizedBody = this._sanitizeForLogging(body);
    console.log('🚀 [ApiHandler] Method:', method, 'Query:', sanitizedQuery, 'Body:', sanitizedBody);

    const args = this._collectIncomingArgs(method, query, body);
    const sanitizedArgs = this._sanitizeForLogging(args);
    console.log('🚀 [ApiHandler] Collected args:', sanitizedArgs);
    
    const namespace = SafeUtils.sanitizeTextField(args.namespace || "");
    const actionKey = SafeUtils.sanitizeTextField(args.action || "");
    console.log(`🚀 [ApiHandler] Route requested: ${namespace}/${actionKey}`);

    if (!namespace || !actionKey) {
      const message = "Missing required routing fields: 'namespace' and/or 'action'";
      console.log('❌ [ApiHandler] Missing routing fields');
      errorHandler.add(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.route_fields_missing", message, critical: true, data: { method, at: Date.now() } });
      return this._errorResponse(400, message, errorHandler.getAll());
    }

    console.log('🔍 [ApiHandler] Resolving route...');
    const resolved = this._resolveRouteFromArgs(namespace, actionKey);
    if (!resolved) {
      const message = `API route not found for ${namespace}/${actionKey}`;
      console.log('❌ [ApiHandler] Route not found:', namespace + '/' + actionKey);
      errorHandler.add(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.route_not_found", message, critical: true, data: { namespace, actionKey, method, at: Date.now() } });
      return this._errorResponse(404, message);
    }
    console.log('✅ [ApiHandler] Route found:', namespace + '/' + actionKey);
    const { entry } = resolved;

    // Validate entry structure
    if (!entry || typeof entry !== "object") {
      const message = `Invalid route entry structure for ${namespace}/${actionKey}`;
      errorHandler.add(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.invalid_route_entry", message, critical: true, data: { namespace, actionKey, at: Date.now() } });
      return this._errorResponse(500, message, errorHandler.getAll());
    }

    console.log('🔍 [ApiHandler] Starting validation...');
    console.log('🔍 [ApiHandler] Route params config:', entry.params);
    let validated;
    try {
      const schema = this._buildValidationSchema(entry.params, args);
      console.log('🔍 [ApiHandler] Built validation schema:', schema);
      validated = SafeUtils.sanitizeValidate(schema);
      console.log('✅ [ApiHandler] Validation passed:', validated);
    } catch (err) {
      const message = `Validation failed for ${namespace}/${actionKey}: ${err?.message || err}`;
      console.log('❌ [ApiHandler] Validation failed:', err.message);
      errorHandler.add(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.validation_failed", message, critical: true, data: { namespace, actionKey, error: String(err), at: Date.now() } });
      return this._errorResponse(400, message, errorHandler.getAll());
    }

    console.log('🔍 [ApiHandler] Sanitizing extra arguments...');
    const extra = this._sanitizeExtraArgs(entry.params, args);
    console.log('✅ [ApiHandler] Extra args sanitized:', extra);

    let handlerFns;
    try {
      ({ handlerFns } = this.autoLoader.ensureRouteDependencies(entry));
    } catch (err) {
      const message = `Failed to load route dependencies for ${namespace}/${actionKey}: ${err?.message || err}`;
      errorHandler.add(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.autoload_failed", message, critical: true, data: { namespace, actionKey, error: String(err), at: Date.now() } });
      return this._errorResponse(500, message, errorHandler.getAll());
    }

    const pipelineInput = { validated, extra, raw: { query, body, headers }, context, method };
    console.log('🔄 [ApiHandler] Starting pipeline execution with', handlerFns.length, 'handlers');
    const sanitizedPipelineInput = this._sanitizeForLogging(pipelineInput);
    console.log('🔄 [ApiHandler] Pipeline input:', sanitizedPipelineInput);
    
    let lastNonUndefined;
    for (let i = 0; i < handlerFns.length; i++) {
      const fn = handlerFns[i];
      console.log(`🔄 [ApiHandler] Executing handler ${i + 1}/${handlerFns.length}: ${fn.name || 'anonymous'}`);
      
      try {
        // Individual try/catch for each handler to prevent one failure from crashing the app
        const out = await fn(pipelineInput);
        const sanitizedOut = this._sanitizeForLogging(out);
        console.log(`🔄 [ApiHandler] Handler ${i + 1} result:`, sanitizedOut);
        
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
        const message = `Handler ${i + 1} (${fn.name || 'anonymous'}) exception for ${namespace}/${actionKey}: ${err?.message || err}`;
        errorHandler.add(message, { namespace, actionKey, handlerIndex: i, handlerName: fn.name || 'anonymous' });
        Logger.writeLog({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, handlerIndex: i, error: String(err), stack: err?.stack, at: Date.now() } });
        return this._errorResponse(500, message, errorHandler.getAll());
      }
    }
    console.log('✅ [ApiHandler] All pipeline handlers completed successfully');
    const sanitizedFinalResult = this._sanitizeForLogging(lastNonUndefined);
    console.log('✅ [ApiHandler] Final result:', sanitizedFinalResult);

    Logger.writeLog({
      flag: this.logFlagOk,
      action: "api.ok",
      message: `Success: ${namespace}/${actionKey}`,
      critical: false,
      data: { namespace, actionKey, method, at: Date.now() }
    });

    return { ok: true, status: 200, data: typeof lastNonUndefined !== "undefined" ? lastNonUndefined : {} };
  }

  _resolveRouteFromArgs(namespace, actionKey) {
    const containers = Array.isArray(this.routeConfig?.apiHandler) ? this.routeConfig.apiHandler : [];
    for (const group of containers) {
      if (group && Object.prototype.hasOwnProperty.call(group, namespace)) {
        const ns = group[namespace];
        if (ns && Object.prototype.hasOwnProperty.call(ns, actionKey)) {
          return { entry: ns[actionKey] };
        }
      }
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
      
      schema[name] = { value: incoming[name], type, required: !!def.required };
    }
    return schema;
  }

  _sanitizeExtraArgs(paramDefs = [], incoming = {}) {
    const allowed = new Set((Array.isArray(paramDefs) ? paramDefs : []).map((d) => String(d.name)));
    const extra = {};
    for (const [key, val] of Object.entries(incoming || {})) {
      if (allowed.has(key)) continue;
      let cleaned = null;
      switch (typeof val) {
        case "string": cleaned = SafeUtils.sanitizeTextField(val); break;
        case "number": cleaned = SafeUtils.sanitizeFloat(val); break;
        case "boolean": cleaned = SafeUtils.sanitizeBoolean(val); break;
        case "object":
          if (val === null) cleaned = null;
          else if (Array.isArray(val)) cleaned = SafeUtils.sanitizeArray(val);
          else cleaned = SafeUtils.sanitizeObject(val);
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
    
    if (m === "GET") return safeQuery;
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return { ...safeQuery, ...safeBody };
    return safeQuery;
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

  _errorResponse(status, message, details = null) {
    return { ok: false, status, error: { message, details } };
  }
}

module.exports = ApiHandler;