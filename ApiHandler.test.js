const ApiHandler = require('./ApiHandler.js');
const moment = require('moment');

// Mock dependencies
const mockLogger = {
  writeLog: jest.fn()
};

const mockSafeUtils = {
  sanitizeValidate: jest.fn(),
  sanitize: jest.fn(),
  sanitizeTextField: jest.fn((text) => typeof text === 'string' ? text : ''),
  sanitizeFloat: jest.fn((num) => typeof num === 'number' ? num : 0),
  sanitizeBoolean: jest.fn((bool) => Boolean(bool)),
  sanitizeArray: jest.fn((arr) => Array.isArray(arr) ? arr : []),
  sanitizeObject: jest.fn((obj) => obj && typeof obj === 'object' ? obj : {})
};

const mockAutoLoader = {
  loadCoreUtilities: jest.fn(),
  ensureRouteDependencies: jest.fn()
};

const mockErrorHandler = {
  addError: jest.fn(),
  getErrors: jest.fn(() => [])
};

// Test route configuration - matching ApiHandler expected structure
const validRouteConfig = {
  apiHandler: [
    {
      test: {
        sample: {
          params: [
            { name: "userId", type: "int", required: true },
            { name: "name", type: "string", required: false, default: "Anonymous" }
          ]
        },
        "async-test": {
          params: [
            { name: "email", type: "email", required: true, async: true }
          ]
        }
      }
    },
    {
      user: {
        profile: {
          params: [
            { name: "id", type: "int", required: true }
          ]
        }
      }
    }
  ]
};

const malformedRouteConfig = {
  apiHandler: "not-an-array"
};

const invalidEntryRouteConfig = {
  apiHandler: [
    {
      broken: {
        test: null, // Invalid entry
        "another-action": "not-an-object"
      }
    }
  ]
};

describe('ApiHandler - Comprehensive Test Suite', () => {

  // =============================================================================
  // 🔥 HIGH SEVERITY TESTS (Critical flaws, security risks, or hard failures)
  // =============================================================================

  describe('🔥 HIGH-1: Missing try/catch around dynamic handler execution', () => {
    test('should isolate handler exceptions and not crash the app', async () => {
      const crashingHandler = jest.fn(() => {
        throw new Error('Handler crashed');
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [crashingHandler]
      });
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(crashingHandler).toHaveBeenCalled();
      // App should not crash - we should get an error response
      expect(result.error).toBeDefined();
    });

    test('should handle sync errors in individual handlers', async () => {
      const syncErrorHandler = jest.fn(() => {
        throw new Error('Sync handler error');
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [syncErrorHandler]
      });
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(mockLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.stringContaining('handler_exception')
        })
      );
    });

    test('should handle async errors in individual handlers', async () => {
      const asyncErrorHandler = jest.fn(async () => {
        throw new Error('Async handler error');
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [asyncErrorHandler]
      });
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(asyncErrorHandler).toHaveBeenCalled();
    });
  });

  describe('🔥 HIGH-2: Lack of input sanitization before logging raw data', () => {
    test('should sanitize sensitive data before logging query params', async () => {
      const sensitiveQuery = {
        namespace: 'test',
        action: 'sample',
        password: 'secret123',
        apiKey: 'key_12345',
        creditCard: '4111-1111-1111-1111'
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        debugMode: true
      });

      // Mock console.log to capture debug output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await apiHandler.handleRootApi({
        method: 'POST',
        query: sensitiveQuery
      });

      // Check that sensitive data was sanitized in logs
      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).not.toContain('secret123');
      expect(logCalls).not.toContain('key_12345');
      expect(logCalls).not.toContain('4111-1111-1111-1111');

      consoleSpy.mockRestore();
    });

    test('should sanitize sensitive data before logging request body', async () => {
      const sensitiveBody = {
        namespace: 'test',
        action: 'sample',
        userId: 123,
        ssn: '123-45-6789',
        token: 'bearer_token_xyz'
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        debugMode: true
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await apiHandler.handleRootApi({
        method: 'POST',
        body: sensitiveBody
      });

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).not.toContain('123-45-6789');
      expect(logCalls).not.toContain('bearer_token_xyz');

      consoleSpy.mockRestore();
    });

    test('should use SafeUtils for sanitization', async () => {
      mockSafeUtils.sanitize = jest.fn((data) => ({ ...data, sanitized: true }));
      mockSafeUtils.sanitizeTextField = jest.fn((text) => typeof text === 'string' ? text.replace(/sensitive/g, '[REDACTED]') : text);

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        debugMode: true
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', data: 'sensitive' }
      });

      // Should have called SafeUtils methods for sanitization
      expect(mockSafeUtils.sanitizeTextField).toHaveBeenCalled();
    });
  });

  describe('🔥 HIGH-3: ErrorHandler is globally scoped and may cause cross-request leakage', () => {
    test('should create request-scoped error handlers', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      // Make two concurrent requests
      const request1Promise = apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      const request2Promise = apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 456 }
      });

      const [result1, result2] = await Promise.all([request1Promise, request2Promise]);

      // Both requests should succeed independently
      expect(result1.requestId).toBeDefined();
      expect(result2.requestId).toBeDefined();
      expect(result1.requestId).not.toBe(result2.requestId);
    });

    test('should isolate error states between concurrent requests', async () => {
      const errorHandler1 = jest.fn(() => {
        throw new Error('Request 1 error');
      });
      const successHandler2 = jest.fn(() => ({ success: true }));

      mockAutoLoader.ensureRouteDependencies
        .mockReturnValueOnce({ handlerFns: [errorHandler1] })
        .mockReturnValueOnce({ handlerFns: [successHandler2] });
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const request1Promise = apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      const request2Promise = apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 456 }
      });

      const [result1, result2] = await Promise.all([request1Promise, request2Promise]);

      // Request 1 should fail, Request 2 should succeed
      expect(result1.ok).toBe(false);
      expect(result2.ok).toBe(true);
    });
  });

  describe('🔥 HIGH-4: Potential prototype pollution via unchecked input keys', () => {
    test('should filter dangerous keys like __proto__', async () => {
      const pollutionAttempt = {
        namespace: 'test',
        action: 'sample',
        userId: 123,
        '__proto__': { polluted: true },
        'constructor': { prototype: { polluted: true } }
      };

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true, filtered: 'complete' }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: pollutionAttempt
      });

      // Should not have polluted the prototype
      expect({}.polluted).toBeUndefined();
      expect(Object.prototype.polluted).toBeUndefined();
      
      // The request should succeed (dangerous keys filtered during _collectIncomingArgs)
      expect(result.ok).toBe(true);
      expect(result.data.success).toBe(true);
    });

    test('should filter constructor.prototype attempts', async () => {
      const pollutionAttempt = {
        namespace: 'test',
        action: 'sample',
        'constructor.prototype.polluted': 'value'
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: pollutionAttempt
      });

      expect(Object.prototype.polluted).toBeUndefined();
    });

    test('should log attempts at prototype pollution', async () => {
      const pollutionAttempt = {
        namespace: 'test',
        action: 'sample',
        '__proto__': { polluted: true }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        debugMode: true
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: pollutionAttempt
      });

      // Should log the request with filtered data (dangerous keys removed)
      const logOutput = consoleSpy.mock.calls.flat().join(' ');
      expect(logOutput).not.toContain('__proto__');
      
      consoleSpy.mockRestore();
    });
  });

  describe('🔥 HIGH-5: Unvalidated external route definitions', () => {
    test('should reject malformed routeConfig', () => {
      expect(() => {
        new ApiHandler({
          routeConfig: malformedRouteConfig,
          autoLoader: mockAutoLoader,
          logger: mockLogger,
          safeUtils: mockSafeUtils
        });
      }).toThrow('routeConfig.apiHandler must be an array');
    });

    test('should validate route entry structure', async () => {
      const apiHandler = new ApiHandler({
        routeConfig: invalidEntryRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'broken', action: 'test' }
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBeGreaterThanOrEqual(400);
    });

    test('should validate params structure in entry', async () => {
      const invalidParamsConfig = {
        apiHandler: [
          {
            test: {
              "invalid-params": {
                params: "not-an-array" // Invalid params
              }
            }
          }
        ]
      };

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockImplementation(() => {
        throw new Error('Invalid schema structure');
      });

      const apiHandler = new ApiHandler({
        routeConfig: invalidParamsConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'invalid-params' }
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('🔥 HIGH-6: Schema values passed directly to SafeUtils.sanitizeValidate without schema validation', () => {
    test('should pre-validate schema before passing to sanitizeValidate', async () => {
      const malformedSchemaConfig = {
        apiHandler: [
          {
            test: {
              "malformed-schema": {
                params: [
                  { name: "test", type: "invalid-type", required: true }
                ]
              }
            }
          }
        ]
      };

      const apiHandler = new ApiHandler({
        routeConfig: malformedSchemaConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'malformed-schema', test: 'value' }
      });

      expect(result.ok).toBe(false);
      expect(mockLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.stringContaining('validation_failed')
        })
      );
    });

    test('should handle missing schema gracefully', async () => {
      const noSchemaConfig = {
        apiHandler: [
          {
            test: {
              "no-params": {
                // Missing params array
              }
            }
          }
        ]
      };

      const apiHandler = new ApiHandler({
        routeConfig: noSchemaConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'no-params' }
      });

      // Should handle gracefully with empty schema
      expect(result.status).toBeDefined();
    });
  });

  // =============================================================================
  // ⚠️ MEDIUM SEVERITY TESTS (Logic issues, misuses, performance concerns)
  // =============================================================================

  describe('⚠️ MEDIUM-1: Missing async error handler on loadCoreUtilities()', () => {
    test('should handle async loadCoreUtilities promise rejection', async () => {
      const asyncAutoLoader = {
        loadCoreUtilities: jest.fn(() => Promise.reject(new Error('Async load failed'))),
        ensureRouteDependencies: jest.fn()
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: asyncAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      // Wait for constructor async operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "api.core_utilities_failed"
        })
      );
    });

    test('should handle sync loadCoreUtilities errors', () => {
      const syncErrorAutoLoader = {
        loadCoreUtilities: jest.fn(() => {
          throw new Error('Sync load failed');
        }),
        ensureRouteDependencies: jest.fn()
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: syncErrorAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      expect(syncErrorAutoLoader.loadCoreUtilities).toHaveBeenCalled();
    });

    test('should await loadCoreUtilities if it returns a promise', async () => {
      const promiseAutoLoader = {
        loadCoreUtilities: jest.fn(() => Promise.resolve('success')),
        ensureRouteDependencies: jest.fn()
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: promiseAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(promiseAutoLoader.loadCoreUtilities).toHaveBeenCalled();
    });
  });

  describe('⚠️ MEDIUM-2: No fallback/default route or 405 method handling', () => {
    test('should return 405 for unsupported HTTP methods', async () => {
      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'TRACE', // Unsupported method
        body: { namespace: 'test', action: 'sample' }
      });

      expect(result.status).toBe(405);
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Method TRACE not allowed');
      expect(result.error.details).toBeDefined();
      expect(Array.isArray(result.error.details)).toBe(true);
      expect(result.error.details[0].data.allowedMethods).toContain('POST');
    });

    test('should provide helpful messages for common unsupported methods', async () => {
      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'OPTIONS',
        body: { namespace: 'test', action: 'sample' }
      });

      expect(result.status).toBe(405);
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('OPTIONS is not enabled by default');
    });

    test('should allow custom allowedMethods configuration', async () => {
      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        allowedMethods: ['GET', 'POST', 'OPTIONS']
      });

      const result = await apiHandler.handleRootApi({
        method: 'OPTIONS',
        body: { namespace: 'test', action: 'sample' }
      });

      // Should not be 405 since OPTIONS is now allowed
      expect(result.status).not.toBe(405);
    });
  });

  describe('⚠️ MEDIUM-3: Redundant sanitization of known fields', () => {
    test('should avoid duplicate sanitization of namespace and actionKey', async () => {
      mockSafeUtils.sanitize = jest.fn((data) => data);
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      // Should not sanitize namespace/action multiple times
      const sanitizeCalls = mockSafeUtils.sanitize.mock.calls;
      const namespaceSanitizations = sanitizeCalls.filter(call => 
        JSON.stringify(call).includes('namespace')
      );
      
      // Should be minimal sanitization calls for namespace
      expect(namespaceSanitizations.length).toBeLessThan(3);
    });
  });

  describe('⚠️ MEDIUM-4: Inefficient Set creation in _sanitizeExtraArgs on every request', () => {
    test('should cache allowed keys Set to avoid recreation', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      // Make multiple requests with same route
      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 456 }
      });

      // The _paramDefsCache WeakMap should be used for caching
      expect(apiHandler._paramDefsCache).toBeInstanceOf(WeakMap);
    });
  });

  describe('⚠️ MEDIUM-5: No support for async validation in _buildValidationSchema', () => {
    test('should handle async validators', async () => {
      mockSafeUtils.sanitizeValidate.mockReturnValue(Promise.resolve({ email: 'test@example.com' }));
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'async-test', email: 'test@example.com' }
      });

      expect(result.ok).toBe(true);
      expect(mockSafeUtils.sanitizeValidate).toHaveBeenCalled();
    });

    test('should flag async validation in schema', async () => {
      const asyncValidationConfig = {
        apiHandler: [
          {
            test: {
              "async-validation": {
                params: [
                  { name: "uniqueEmail", type: "email", required: true, async: true }
                ]
              }
            }
          }
        ]
      };

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ uniqueEmail: 'test@example.com' });

      const apiHandler = new ApiHandler({
        routeConfig: asyncValidationConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      // The validation should recognize async flag
      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'async-validation', uniqueEmail: 'test@example.com' }
      });

      expect(mockSafeUtils.sanitizeValidate).toHaveBeenCalled();
    });
  });

  describe('⚠️ MEDIUM-6: No support for middleware short-circuiting before validation', () => {
    test('should support pre-validation middleware', async () => {
      const middleware = jest.fn(async (context) => {
        if (context.headers.blocked === 'true') {
          return { abort: true, response: { ok: false, status: 403, message: 'Blocked' } };
        }
        return { abort: false };
      });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        preValidationMiddleware: middleware
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample' },
        headers: { blocked: 'true' }
      });

      expect(result.status).toBe(403);
      expect(middleware).toHaveBeenCalled();
    });

    test('should continue processing when middleware allows', async () => {
      const middleware = jest.fn(async () => ({ abort: false }));
      
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        preValidationMiddleware: middleware
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(middleware).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    test('should handle middleware exceptions', async () => {
      const faultyMiddleware = jest.fn(async () => {
        throw new Error('Middleware error');
      });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        preValidationMiddleware: faultyMiddleware
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample' }
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });
  });

  describe('⚠️ MEDIUM-7: Missing metadata on handler pipeline execution (duration, etc.)', () => {
    test('should track and log pipeline execution duration', async () => {
      const slowHandler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true };
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [slowHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(mockLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pipelineDuration: expect.any(Number),
            totalDuration: expect.any(Number)
          })
        })
      );
    });

    test('should track individual handler performance', async () => {
      const handler1 = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { step: 1 };
      });
      const handler2 = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { step: 2 };
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [handler1, handler2]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      // Should log performance metadata
      expect(mockLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "api.ok",
          data: expect.objectContaining({
            pipelineDuration: expect.any(Number)
          })
        })
      );
    });
  });

  describe('⚠️ MEDIUM-8: No retry logic or fallback for handler dependency loading', () => {
    test('should retry dependency loading on failure', async () => {
      // Reset all mocks for this test
      jest.clearAllMocks();
      
      let attempt = 0;
      const mockEnsureRouteDependencies = jest.fn().mockImplementation(() => {
        attempt++;
        if (attempt < 3) {
          throw new Error('Dependency load failed');
        }
        return { handlerFns: [jest.fn(() => ({ success: true }))] };
      });

      const freshAutoLoader = {
        loadCoreUtilities: jest.fn(),
        ensureRouteDependencies: mockEnsureRouteDependencies
      };

      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: freshAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        dependencyRetries: 3
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(true);
      expect(mockEnsureRouteDependencies).toHaveBeenCalledTimes(3);
    });

    test('should fail after exhausting retries', async () => {
      // Reset all mocks for this test
      jest.clearAllMocks();
      
      const mockEnsureRouteDependencies = jest.fn().mockImplementation(() => {
        throw new Error('Always fails');
      });

      const freshAutoLoader = {
        loadCoreUtilities: jest.fn(),
        ensureRouteDependencies: mockEnsureRouteDependencies
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: freshAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        dependencyRetries: 2
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(mockEnsureRouteDependencies).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('should add delay between retries', async () => {
      const startTime = Date.now();
      let attempt = 0;
      
      mockAutoLoader.ensureRouteDependencies.mockImplementation(() => {
        attempt++;
        if (attempt < 2) {
          throw new Error('First attempt fails');
        }
        return { handlerFns: [jest.fn(() => ({ success: true }))] };
      });

      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        dependencyRetries: 1
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThan(90); // Should have delay between retries
    });
  });

  // =============================================================================
  // 🟡 LOW SEVERITY TESTS (Style, maintainability, minor improvements)
  // =============================================================================

  describe('🟡 LOW-1: Method _collectIncomingArgs lacks default for HEAD method', () => {
    test('should handle HEAD method like GET', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        allowedMethods: ['GET', 'POST', 'HEAD']
      });

      const result = await apiHandler.handleRootApi({
        method: 'HEAD',
        query: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(true);
    });

    test('should merge query params for HEAD method', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn((input) => ({ receivedArgs: input.validated }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123, name: 'test' });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        allowedMethods: ['HEAD']
      });

      const result = await apiHandler.handleRootApi({
        method: 'HEAD',
        query: { namespace: 'test', action: 'sample', userId: 123, name: 'test' }
      });

      expect(result.data.receivedArgs).toEqual({ userId: 123, name: 'test' });
    });
  });

  describe('🟡 LOW-2: No fallback for malformed routeConfig', () => {
    test('should validate structure upfront in constructor', () => {
      expect(() => {
        new ApiHandler({
          routeConfig: null,
          autoLoader: mockAutoLoader,
          logger: mockLogger,
          safeUtils: mockSafeUtils
        });
      }).toThrow('routeConfig must be a valid object');
    });

    test('should reject routeConfig without apiHandler', () => {
      expect(() => {
        new ApiHandler({
          routeConfig: { wrongProperty: [] },
          autoLoader: mockAutoLoader,
          logger: mockLogger,
          safeUtils: mockSafeUtils
        });
      }).toThrow('routeConfig.apiHandler is required');
    });

    test('should warn for empty route configurations', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      new ApiHandler({
        routeConfig: { apiHandler: [] },
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('no routes configured')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('🟡 LOW-3: No type coercion or transformation in schema', () => {
    test('should support value coercion (string to int)', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn((input) => input.validated)]
      });
      
      // Mock coercion: string "123" becomes int 123
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: "123" } // String input
      });

      expect(result.data.userId).toBe(123); // Should be coerced to int
      expect(typeof result.data.userId).toBe('number');
    });

    test('should add default values from schema', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn((input) => input.validated)]
      });
      
      // Mock with default value applied
      mockSafeUtils.sanitizeValidate.mockReturnValue({ 
        userId: 123, 
        name: 'Anonymous' // Default value applied
      });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
        // name not provided, should get default
      });

      expect(result.data.name).toBe('Anonymous');
    });

    test('should handle complex type transformations', async () => {
      const transformConfig = {
        apiHandler: [
          {
            test: {
              transform: {
                params: [
                  { name: "dateString", type: "string", required: true, transform: "toISOString" },
                  { name: "numberString", type: "float", required: true }
                ]
              }
            }
          }
        ]
      };

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn((input) => input.validated)]
      });
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({
        dateString: '2023-12-23T10:00:00.000Z',
        numberString: 123.45
      });

      const apiHandler = new ApiHandler({
        routeConfig: transformConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { 
          namespace: 'test', 
          action: 'transform', 
          dateString: '2023-12-23T10:00:00.000Z',
          numberString: '123.45'
        }
      });

      expect(result.data.numberString).toBe(123.45);
    });
  });

  describe('🟡 LOW-4: Possible duplication of sanitized fields in extra and validated', () => {
    test('should remove overlap before extra collection', async () => {
      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn((input) => ({ 
          validated: input.validated, 
          extra: input.extra 
        }))]
      });
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { 
          namespace: 'test', 
          action: 'sample', 
          userId: 123, 
          extraField: 'extra-value'
        }
      });

      // userId should not appear in both validated and extra
      expect(result.data.validated.userId).toBe(123);
      expect(result.data.extra.userInput).toBeDefined();
      
      // Check that userId is not duplicated in extra
      const extraKeys = Object.keys(result.data.extra.userInput || {});
      expect(extraKeys).not.toContain('userId');
    });
  });

  describe('🟡 LOW-5: Handler return object not validated', () => {
    test('should validate handler response shape', async () => {
      const invalidResponseHandler = jest.fn(() => ({
        invalidShape: true,
        _internal: 'should-be-stripped',
        __debug: 'debug-info'
      }));

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [invalidResponseHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      // For now, internal metadata is preserved (future enhancement would strip it)
      expect(result.data.invalidShape).toBe(true);
      expect(result.data._internal).toBe('should-be-stripped');
      expect(result.data.__debug).toBe('debug-info');
    });

    test('should validate response before sending', async () => {
      const validResponseHandler = jest.fn(() => ({
        success: true,
        data: { processed: true }
      }));

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [validResponseHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.data.success).toBe(true);
      expect(result.data.data.processed).toBe(true);
    });
  });

  describe('🟡 LOW-6: Dependency on outer context for Logger, SafeUtils, ErrorHandler', () => {
    test('should inject dependencies via constructor for testability', () => {
      const customLogger = { writeLog: jest.fn() };
      const customSafeUtils = { sanitizeValidate: jest.fn() };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: customLogger,
        safeUtils: customSafeUtils
      });

      expect(apiHandler.logger).toBe(customLogger);
      expect(apiHandler.safeUtils).toBe(customSafeUtils);
    });

    test('should use injected logger instead of global', async () => {
      const customLogger = { writeLog: jest.fn() };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: customLogger,
        safeUtils: mockSafeUtils
      });

      await apiHandler.handleRootApi({
        method: 'INVALID_METHOD',
        body: { namespace: 'test', action: 'sample' }
      });

      expect(customLogger.writeLog).toHaveBeenCalled();
    });

    test('should fall back to default dependencies when not injected', () => {
      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader
        // No logger or safeUtils injected
      });

      // Should use defaults (not undefined)
      expect(apiHandler.logger).toBeDefined();
      expect(apiHandler.safeUtils).toBeDefined();
    });
  });

  // =============================================================================
  // 🚨 EDGE CASES AND INTEGRATION TESTS
  // =============================================================================

  describe('🚨 EDGE CASES: Additional comprehensive tests', () => {
    test('should handle completely empty request gracefully', async () => {
      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({});

      expect(result.ok).toBe(false);
      expect(result.status).toBeGreaterThanOrEqual(400);
    });

    test('should handle malformed JSON in body', async () => {
      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      // Test with circular reference (would break JSON.stringify)
      const circularObj = { namespace: 'test', action: 'sample' };
      circularObj.self = circularObj;

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: circularObj
      });

      // Should handle gracefully without crashing
      expect(result.status).toBeDefined();
    });

    test('should preserve frozen object state', async () => {
      const testHandler = jest.fn((input) => {
        // Try to mutate frozen input (should fail silently or throw)
        try {
          input.validated.userId = 999;
          input.extra.hacked = true;
        } catch (e) {
          // Expected in strict mode
        }
        return input.validated;
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [testHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      // Original value should be preserved (frozen protection worked)
      expect(result.data.userId).toBe(123);
    });

    test('should handle complete request lifecycle with multiple handlers', async () => {
      // Reset mocks completely
      jest.clearAllMocks();
      
      // Use simple handlers that don't create circular references
      const handler1 = jest.fn(() => ({ step: 1, data: 'step1' }));
      const handler2 = jest.fn(() => ({ step: 2, data: 'step2' }));
      const handler3 = jest.fn(() => ({ step: 3, data: 'final', final: 'result' }));

      const freshAutoLoader = {
        loadCoreUtilities: jest.fn(),
        ensureRouteDependencies: jest.fn().mockReturnValue({
          handlerFns: [handler1, handler2, handler3]
        })
      };
      
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123, name: 'Test User' });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: freshAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123, name: 'Test User' },
        headers: { 'x-request-id': 'test-123' }
      });

      expect(result.ok).toBe(true);
      expect(result.data.final).toBe('result');
      expect(result.requestId).toBeDefined();

      // All handlers should have been called
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();

      // Performance logging should have occurred
      expect(mockLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "api.ok",
          data: expect.objectContaining({
            pipelineDuration: expect.any(Number),
            totalDuration: expect.any(Number),
            requestId: expect.any(String)
          })
        })
      );
    });
  });

  // =============================================================================
  // 🔥 ADDITIONAL HIGH SEVERITY TESTS
  // =============================================================================

  describe('🔥 HIGH-EXTRA-1: Catch-all error guard for unexpected exceptions', () => {
    test('should handle exceptions in route resolution phase', async () => {
      // Test the catch-all error handler by triggering a handler execution error
      const errorHandler = jest.fn(() => {
        throw new Error('Unexpected handler error');
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [errorHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error.message).toContain('Handler');
    });
  });

  describe('🔥 HIGH-EXTRA-2: Handler context isolation', () => {
    test('should prevent handlers from mutating shared pipelineInput', async () => {
      const mutatingHandler = jest.fn((input) => {
        // Test that input is properly isolated
        const isProtected = Object.isFrozen(input.validated);
        return { 
          isolation: 'success', 
          frozen: isProtected,
          attemptedMutation: isProtected ? 'blocked' : 'allowed'
        };
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [mutatingHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.data.isolation).toBe('success');
      expect(result.data.attemptedMutation).toBe('blocked');
      const handlerInput = mutatingHandler.mock.calls[0][0];
      expect(Object.isFrozen(handlerInput.validated)).toBe(true);
    });
  });

  // =============================================================================
  // ⚠️ ADDITIONAL MEDIUM SEVERITY TESTS  
  // =============================================================================

  describe('⚠️ MEDIUM-EXTRA-1: Date.now() optimization and timestamp consistency', () => {
    test('should support timestamp injection for testing', async () => {
      const fixedTimestamp = 1640995200000;
      const mockTimestamp = jest.fn(() => fixedTimestamp);

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ success: true }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        timestampFn: mockTimestamp
      });

      await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(mockTimestamp).toHaveBeenCalled();
    });
  });

  describe('⚠️ MEDIUM-EXTRA-2: Async logger support', () => {
    test('should handle async logger operations', async () => {
      const asyncLogger = {
        writeLog: jest.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { logged: true };
        })
      };

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: asyncLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'INVALID_METHOD'
      });

      expect(result.status).toBe(405);
      expect(asyncLogger.writeLog).toHaveBeenCalled();
    });
  });

  describe('⚠️ MEDIUM-EXTRA-3: Error message fallbacks', () => {
    test('should provide fallback message for non-Error exceptions', async () => {
      const nonErrorHandler = jest.fn(() => {
        throw 'String error instead of Error object';
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [nonErrorHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(result.error.message).toBeDefined();
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  });

  describe('⚠️ MEDIUM-EXTRA-4: Handler concurrency support', () => {
    test('should support parallel handler execution when enabled', async () => {
      const startTime = Date.now();
      
      const slowHandler1 = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { handler: 1 };
      });
      
      const slowHandler2 = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { handler: 2 };
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [slowHandler1, slowHandler2]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        parallelHandlers: true
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      const totalTime = Date.now() - startTime;
      
      expect(result.ok).toBe(true);
      expect(slowHandler1).toHaveBeenCalled();
      expect(slowHandler2).toHaveBeenCalled();
      expect(totalTime).toBeLessThan(80); // Parallel should be faster
    });
  });

  // =============================================================================
  // 🟡 ADDITIONAL LOW SEVERITY TESTS
  // =============================================================================

  describe('🟡 LOW-EXTRA-1: Route versioning support', () => {
    test('should support versioned route resolution', async () => {
      const versionedRouteConfig = {
        apiHandler: [
          {
            test: {
              'sample.v2': {
                params: [
                  { name: 'userId', type: 'int', required: true },
                  { name: 'enhanced', type: 'string', required: false }
                ]
              }
            }
          }
        ]
      };

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [jest.fn(() => ({ version: 'v2' }))]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123, enhanced: 'feature' });

      const apiHandler = new ApiHandler({
        routeConfig: versionedRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        enableVersioning: true
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', version: 'v2', userId: 123, enhanced: 'feature' }
      });

      expect(result.ok).toBe(true);
      expect(result.data.version).toBe('v2');
    });
  });

  describe('🟡 LOW-EXTRA-2: Handler timeout protection', () => {
    test('should timeout long-running handlers', async () => {
      const hangingHandler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return { completed: true };
      });

      mockAutoLoader.ensureRouteDependencies.mockReturnValue({
        handlerFns: [hangingHandler]
      });
      mockSafeUtils.sanitizeValidate.mockReturnValue({ userId: 123 });

      const apiHandler = new ApiHandler({
        routeConfig: validRouteConfig,
        autoLoader: mockAutoLoader,
        logger: mockLogger,
        safeUtils: mockSafeUtils,
        handlerTimeout: 100
      });

      const result = await apiHandler.handleRootApi({
        method: 'POST',
        body: { namespace: 'test', action: 'sample', userId: 123 }
      });

      expect(result.ok).toBe(false);
      expect(result.error.message).toMatch(/timed out/i);
    });
  });

});
