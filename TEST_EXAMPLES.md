# Test Examples for New Security Features

This document provides test cases to verify the new security features.

---

## Test 1: Catch-All Error Guard

### Purpose
Verify that unexpected exceptions anywhere in the request flow are caught and don't crash the app.

### Test Code
```javascript
// Simulate an unexpected error during route resolution
const apiHandler = new ApiHandler({
  routeConfig: {
    apiHandler: [null] // Invalid: will cause error during iteration
  },
  autoLoader: mockAutoLoader
});

const result = await apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'test' },
  body: {}
});

// Expected: Returns 500 error instead of crashing
console.assert(result.status === 500, 'Should return 500');
console.assert(result.error.message.includes('Unexpected'), 'Should indicate unexpected error');
```

**Expected Behavior**: Returns graceful 500 error with message "Internal server error - unexpected exception"

---

## Test 2: Handler Context Isolation - Mutation Prevention

### Purpose
Verify that handlers cannot mutate pipelineInput and affect other handlers.

### Test Code
```javascript
const handler1 = async (input) => {
  console.log('Handler 1 - Before mutation attempt');
  
  try {
    // Attempt to mutate validated data
    input.validated.userId = 'HACKED';
    console.log('❌ SECURITY ISSUE: Mutation succeeded!');
  } catch (err) {
    console.log('✅ Mutation prevented:', err.message);
  }
  
  try {
    // Attempt to add new property
    input.newProp = 'malicious';
    console.log('❌ SECURITY ISSUE: Property addition succeeded!');
  } catch (err) {
    console.log('✅ Property addition prevented:', err.message);
  }
  
  return { handler1Result: 'done' };
};

const handler2 = async (input) => {
  console.log('Handler 2 - Checking data integrity');
  
  // Should still see original validated data
  console.assert(!input.validated.userId || input.validated.userId !== 'HACKED', 
    'Data should not be mutated');
  console.assert(!input.newProp, 'New properties should not exist');
  
  return { handler2Result: 'done' };
};

// Configure route with both handlers
const result = await apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'testMutation' },
  body: { userId: 'original123' }
});
```

**Expected Behavior**: 
- Handler 1 throws errors when trying to mutate
- Handler 2 sees original data unchanged
- Console shows "Mutation prevented" and "Property addition prevented"

---

## Test 3: Deep Clone Verification

### Purpose
Verify that nested objects are properly cloned, not just shallow copied.

### Test Code
```javascript
const handler1 = async (input) => {
  // Attempt to mutate nested object
  try {
    input.validated.user.role = 'admin'; // Should fail
    console.log('❌ Nested mutation succeeded!');
  } catch (err) {
    console.log('✅ Nested object protected:', err.message);
  }
  
  try {
    input.raw.body.settings.theme = 'dark'; // Should fail
    console.log('❌ Deep nested mutation succeeded!');
  } catch (err) {
    console.log('✅ Deep nested object protected:', err.message);
  }
  
  return { done: true };
};

const result = await apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'testDeepClone' },
  body: { 
    user: { id: 1, role: 'user' },
    settings: { theme: 'light' }
  }
});
```

**Expected Behavior**: All mutation attempts fail due to Object.freeze on deeply cloned objects

---

## Test 4: Prototype Pollution Prevention

### Purpose
Verify that prototype pollution attacks are blocked.

### Test Code
```javascript
const result = await apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'test' },
  body: {
    '__proto__': { admin: true },
    'constructor': { isAdmin: true },
    'prototype': { elevated: true },
    normalField: 'safe'
  }
});

// Check that Object.prototype wasn't polluted
console.assert(!Object.prototype.admin, 'Prototype should not be polluted');
console.assert(!Object.prototype.isAdmin, 'Constructor pollution prevented');
console.assert(!Object.prototype.elevated, 'Prototype pollution prevented');

// Verify only safe fields were processed
console.log('Safe field processed:', result);
```

**Expected Behavior**: 
- Dangerous keys are filtered out
- Object.prototype remains unpolluted
- Only normalField is processed

---

## Test 5: Sensitive Data Redaction in Logs

### Purpose
Verify that sensitive data is redacted from console logs.

### Test Code
```javascript
// Capture console.log output
const logs = [];
const originalLog = console.log;
console.log = (...args) => {
  logs.push(args.join(' '));
  originalLog(...args);
};

const result = await apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'test' },
  body: {
    username: 'john',
    password: 'secret123',
    apiKey: 'sk-1234567890',
    token: 'jwt-token-here',
    normalData: 'visible'
  }
});

// Restore console.log
console.log = originalLog;

// Check logs for redaction
const bodyLog = logs.find(log => log.includes('Body:'));
console.assert(bodyLog.includes('[REDACTED]'), 'Sensitive data should be redacted');
console.assert(bodyLog.includes('normalData'), 'Normal data should be visible');
console.assert(!bodyLog.includes('secret123'), 'Password should not appear in logs');
console.assert(!bodyLog.includes('sk-1234567890'), 'API key should not appear in logs');
```

**Expected Behavior**: 
- Logs show `[REDACTED]` for password, token, apiKey
- Normal data remains visible
- Sensitive values never appear in logs

---

## Test 6: Concurrent Request Isolation

### Purpose
Verify that errors in one request don't affect another concurrent request.

### Test Code
```javascript
const request1Promise = apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'fail' }, // Will cause error
  body: {}
});

const request2Promise = apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'success' }, // Should succeed
  body: {}
});

const [result1, result2] = await Promise.all([request1Promise, request2Promise]);

console.assert(!result1.ok, 'Request 1 should fail');
console.assert(result2.ok, 'Request 2 should succeed');
console.assert(
  !result2.error?.details?.some(e => e.message.includes('fail')),
  'Request 2 should not contain errors from request 1'
);
```

**Expected Behavior**: 
- Request 1 fails with its own errors
- Request 2 succeeds independently
- No error contamination between requests

---

## Test 7: Unexpected Exception Handling

### Purpose
Test that exceptions thrown in unexpected places are caught.

### Test Code
```javascript
// Mock autoLoader that throws during dependency loading
const faultyAutoLoader = {
  loadCoreUtilities: () => {},
  ensureRouteDependencies: () => {
    throw new Error('Database connection lost');
  }
};

const apiHandler = new ApiHandler({
  routeConfig: validConfig,
  autoLoader: faultyAutoLoader
});

const result = await apiHandler.handleRootApi({
  method: 'POST',
  query: { namespace: 'test', action: 'test' },
  body: {}
});

// Should catch and handle gracefully
console.assert(!result.ok, 'Should return error response');
console.assert(result.status === 500, 'Should return 500 status');
console.log('Error handled gracefully:', result.error.message);
```

**Expected Behavior**: 
- Exception is caught by catch-all guard or retry logic
- Returns 500 error response
- Logs critical error
- App continues running

---

## Test 8: Object.freeze Verification

### Purpose
Verify that frozen objects actually prevent mutations.

### Test Code
```javascript
const testHandler = async (input) => {
  // Check if objects are frozen
  console.assert(Object.isFrozen(input), 'Root input should be frozen');
  console.assert(Object.isFrozen(input.validated), 'validated should be frozen');
  console.assert(Object.isFrozen(input.extra), 'extra should be frozen');
  console.assert(Object.isFrozen(input.raw), 'raw should be frozen');
  
  // Verify strict mode throws on frozen object mutation
  'use strict';
  let errorThrown = false;
  try {
    input.validated.newField = 'test';
  } catch (err) {
    errorThrown = true;
    console.log('✅ Strict mode prevents mutation');
  }
  
  console.assert(errorThrown || input.validated.newField === undefined, 
    'Mutation should be prevented');
  
  return { success: true };
};
```

**Expected Behavior**: 
- All nested objects are frozen
- Mutations fail silently in non-strict mode
- Mutations throw in strict mode
- Objects remain immutable

---

## Running Tests

```bash
# Run all tests
node test-security-features.js

# Expected output:
# ✅ Test 1: Catch-all error guard - PASSED
# ✅ Test 2: Handler context isolation - PASSED
# ✅ Test 3: Deep clone verification - PASSED
# ✅ Test 4: Prototype pollution prevention - PASSED
# ✅ Test 5: Sensitive data redaction - PASSED
# ✅ Test 6: Concurrent request isolation - PASSED
# ✅ Test 7: Unexpected exception handling - PASSED
# ✅ Test 8: Object.freeze verification - PASSED
```

---

## Performance Impact Tests

### Test Memory Usage
```javascript
const before = process.memoryUsage();

// Make 1000 requests
for (let i = 0; i < 1000; i++) {
  await apiHandler.handleRootApi({
    method: 'POST',
    query: { namespace: 'test', action: 'test' },
    body: { data: 'x'.repeat(1000) }
  });
}

const after = process.memoryUsage();
console.log('Memory increase:', (after.heapUsed - before.heapUsed) / 1024 / 1024, 'MB');
```

**Expected**: <50MB increase for 1000 requests (WeakMap caching prevents memory leaks)

---

## Notes

- All tests should pass without crashing the application
- Error logs should show appropriate error types and stack traces
- Performance should remain acceptable (<10ms overhead per request)
- Memory usage should be stable with no leaks
