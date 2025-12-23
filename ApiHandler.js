const ErrorHandler = require("./ErrorHandler.js");
const Logger = require("./UtilityLogger.js");
const SafeUtils = require("./SafeUtils.js");

class ApiHandler {
  constructor({ routeConfig, autoLoader, logFlagOk = "startup", logFlagError = "startup" }) {
    this.routeConfig = routeConfig;
    this.autoLoader = autoLoader;
    this.logFlagOk = logFlagOk;
    this.logFlagError = logFlagError;
    if (this.autoLoader && typeof this.autoLoader.loadCoreUtilities === "function") {
      this.autoLoader.loadCoreUtilities();
    }
  }

  async handleRootApi({ method = "POST", query = {}, body = {}, headers = {}, context = {} }) {
    console.log('\n🚀 [ApiHandler] === NEW API REQUEST ===');
    console.log('🚀 [ApiHandler] Method:', method, 'Query:', query, 'Body:', body);
    ErrorHandler.clear();

    const args = this._collectIncomingArgs(method, query, body);
    console.log('🚀 [ApiHandler] Collected args:', args);
    
    const namespace = SafeUtils.sanitizeTextField(args.namespace || "");
    const actionKey = SafeUtils.sanitizeTextField(args.action || "");
    console.log(`🚀 [ApiHandler] Route requested: ${namespace}/${actionKey}`);

    if (!namespace || !actionKey) {
      const message = "Missing required routing fields: 'namespace' and/or 'action'";
      console.log('❌ [ApiHandler] Missing routing fields');
      ErrorHandler.add_error(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.route_fields_missing", message, critical: true, data: { method, at: Date.now() } });
      return this._errorResponse(400, message, ErrorHandler.get_all_errors());
    }

    console.log('🔍 [ApiHandler] Resolving route...');
    const resolved = this._resolveRouteFromArgs(namespace, actionKey);
    if (!resolved) {
      const message = `API route not found for ${namespace}/${actionKey}`;
      console.log('❌ [ApiHandler] Route not found:', namespace + '/' + actionKey);
      ErrorHandler.add_error(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.route_not_found", message, critical: true, data: { namespace, actionKey, method, at: Date.now() } });
      return this._errorResponse(404, message);
    }
    console.log('✅ [ApiHandler] Route found:', namespace + '/' + actionKey);
    const { entry } = resolved;

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
      ErrorHandler.add_error(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.validation_failed", message, critical: true, data: { namespace, actionKey, error: String(err), at: Date.now() } });
      return this._errorResponse(400, message, ErrorHandler.get_all_errors());
    }

    console.log('🔍 [ApiHandler] Sanitizing extra arguments...');
    const extra = this._sanitizeExtraArgs(entry.params, args);
    console.log('✅ [ApiHandler] Extra args sanitized:', extra);

    let handlerFns;
    try {
      ({ handlerFns } = this.autoLoader.ensureRouteDependencies(entry));
    } catch (err) {
      const message = `Failed to load route dependencies for ${namespace}/${actionKey}: ${err?.message || err}`;
      ErrorHandler.add_error(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.autoload_failed", message, critical: true, data: { namespace, actionKey, error: String(err), at: Date.now() } });
      return this._errorResponse(500, message, ErrorHandler.get_all_errors());
    }

    const pipelineInput = { validated, extra, raw: { query, body, headers }, context, method };
    console.log('🔄 [ApiHandler] Starting pipeline execution with', handlerFns.length, 'handlers');
    console.log('🔄 [ApiHandler] Pipeline input:', pipelineInput);
    
    let lastNonUndefined;
    try {
      for (let i = 0; i < handlerFns.length; i++) {
        const fn = handlerFns[i];
        console.log(`🔄 [ApiHandler] Executing handler ${i + 1}/${handlerFns.length}: ${fn.name || 'anonymous'}`);
        
        const out = await fn(pipelineInput);
        console.log(`🔄 [ApiHandler] Handler ${i + 1} result:`, out);
        
        if (out && typeof out === "object" && out.abort === true) {
          console.log(`🛑 [ApiHandler] Handler ${i + 1} requested abort, short-circuiting pipeline`);
          console.log('🛑 [ApiHandler] Abort response:', out.response);
          return out.response;
        }
        if (typeof out !== "undefined") {
          lastNonUndefined = out;
          console.log(`✅ [ApiHandler] Handler ${i + 1} completed, stored result`);
        } else {
          console.log(`✅ [ApiHandler] Handler ${i + 1} completed, no result to store`);
        }
      }
      console.log('✅ [ApiHandler] All pipeline handlers completed successfully');
      console.log('✅ [ApiHandler] Final result:', lastNonUndefined);

      Logger.writeLog({
        flag: this.logFlagOk,
        action: "api.ok",
        message: `Success: ${namespace}/${actionKey}`,
        critical: false,
        data: { namespace, actionKey, method, at: Date.now() }
      });

      return { ok: true, status: 200, data: typeof lastNonUndefined !== "undefined" ? lastNonUndefined : {} };
    } catch (err) {
      const message = `Handler exception for ${namespace}/${actionKey}: ${err?.message || err}`;
      ErrorHandler.add_error(message, { namespace, actionKey });
      Logger.writeLog({ flag: this.logFlagError, action: "api.handler_exception", message, critical: true, data: { namespace, actionKey, error: String(err), at: Date.now() } });
      return this._errorResponse(500, message, ErrorHandler.get_all_errors());
    }
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
    const schema = {};
    for (const def of Array.isArray(paramDefs) ? paramDefs : []) {
      const name = String(def.name || "").trim();
      if (!name) throw new TypeError("Param definition missing name");
      const type = String(def.type || "string").trim().toLowerCase();
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
    if (m === "GET") return { ...q };
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return { ...q, ...b };
    return { ...q };
  }

  _errorResponse(status, message, details = null) {
    return { ok: false, status, error: { message, details } };
  }
}

module.exports = ApiHandler;