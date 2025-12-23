const ApiHandler = require("./ApiHandler"); // adjust this path

// Mock SafeUtils
jest.mock("./SafeUtils.js", () => ({
  sanitizeTextField: jest.fn((x) => String(x).replace(/<.*?>/g, "").trim()),
  sanitizeFloat: jest.fn((x) => parseFloat(x)),
  sanitizeBoolean: jest.fn((x) => Boolean(x)),
  sanitizeArray: jest.fn((x) => x.map(String)),
  sanitizeObject: jest.fn((x) => x),
  sanitizeValidate: jest.fn((schema) => {
    const out = {};
    for (const key in schema) out[key] = String(schema[key].value);
    return out;
  }),
}));

jest.mock("./UtilityLogger.js", () => ({ writeLog: jest.fn() }));
jest.mock("./ErrorHandler.js", () => ({
  clear: jest.fn(),
  add_error: jest.fn(),
  get_all_errors: jest.fn(() => []),
}));

const SafeUtils = require("./SafeUtils.js");

describe("ApiHandler Tests (All Methods)", () => {
  let handler;
  const dummyRouteConfig = {
    apiHandler: [
      {
        testNS: {
          testAction: {
            params: [{ name: "param1", type: "string", required: true }],
          },
        },
      },
    ],
  };

  beforeEach(() => {
    handler = new ApiHandler({
      routeConfig: dummyRouteConfig,
      autoLoader: {
        loadCoreUtilities: () => {},
        ensureRouteDependencies: () => ({
          handlerFns: [jest.fn().mockResolvedValue({ result: "ok" })],
        }),
      },
      logFlagOk: "ok",
      logFlagError: "err",
    });
  });

  // --- handleRootApi ---

  test("PASS_handleRootApi_1: GET with valid query", async () => {
    const res = await handler.handleRootApi({
      method: "GET",
      query: { namespace: "testNS", action: "testAction", param1: "abc" },
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  test("FAIL_handleRootApi_1: Missing namespace/action", async () => {
    const res = await handler.handleRootApi({
      method: "GET",
      query: { param1: "x" },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  test("FAIL_handleRootApi_2: Unknown route returns 404", async () => {
    const res = await handler.handleRootApi({
      method: "POST",
      body: { namespace: "bad", action: "none", param1: "x" },
    });
    expect(res.status).toBe(404);
  });

  test("FAIL_handleRootApi_3: Validation schema throws error", async () => {
    handler._buildValidationSchema = () => {
      throw new Error("oops");
    };
    const res = await handler.handleRootApi({
      method: "POST",
      body: { namespace: "testNS", action: "testAction", param1: "x" },
    });
    expect(res.status).toBe(400);
  });

  test("FAIL_handleRootApi_4: Handler throws inside pipeline", async () => {
    handler.autoLoader.ensureRouteDependencies = () => ({
      handlerFns: [
        () => {
          throw new Error("fail");
        },
      ],
    });
    const res = await handler.handleRootApi({
      method: "POST",
      body: { namespace: "testNS", action: "testAction", param1: "x" },
    });
    expect(res.status).toBe(500);
  });

  test("FAIL_handleRootApi_6: Handler aborts with response", async () => {
    handler.autoLoader.ensureRouteDependencies = () => ({
      handlerFns: [
        () => ({
          abort: true,
          response: {
            ok: false,
            status: 418,
            error: { message: "I'm a teapot" },
          },
        }),
      ],
    });
    const res = await handler.handleRootApi({
      method: "POST",
      body: { namespace: "testNS", action: "testAction", param1: "x" },
    });
    expect(res.status).toBe(418);
  });

  // --- _resolveRouteFromArgs ---

  test("PASS__resolveRouteFromArgs_1: resolves valid route", () => {
    const res = handler._resolveRouteFromArgs("testNS", "testAction");
    expect(res?.entry).toBeDefined();
  });

  test("FAIL__resolveRouteFromArgs_1: unknown namespace returns null", () => {
    const res = handler._resolveRouteFromArgs("wrong", "testAction");
    expect(res).toBeNull();
  });

  test("FAIL__resolveRouteFromArgs_2: unknown action returns null", () => {
    const res = handler._resolveRouteFromArgs("testNS", "badAction");
    expect(res).toBeNull();
  });

  // --- _buildValidationSchema ---

  test("PASS__buildValidationSchema_1: valid schema", () => {
    const result = handler._buildValidationSchema(
      [{ name: "x", type: "string", required: true }],
      { x: "abc" }
    );
    expect(result.x).toMatchObject({
      value: "abc",
      type: "string",
      required: true,
    });
  });

  test("FAIL__buildValidationSchema_1: missing name throws", () => {
    expect(() =>
      handler._buildValidationSchema([{ type: "string" }], {})
    ).toThrow();
  });

  // --- _sanitizeExtraArgs ---

  test("PASS__sanitizeExtraArgs_1: sanitizes unknown props", () => {
    const res = handler._sanitizeExtraArgs([{ name: "p" }], {
      p: "x",
      xtra: "<b>hi</b>",
    });
    expect(res.xtra).toBe("hi");
  });

  test("PASS__sanitizeExtraArgs_2: no extras returns {}", () => {
    const res = handler._sanitizeExtraArgs([{ name: "a" }], { a: "x" });
    expect(res).toEqual({});
  });

  // --- _collectIncomingArgs ---

  test("PASS__collectIncomingArgs_1: GET uses query only", () => {
    const res = handler._collectIncomingArgs("GET", { a: 1 }, { b: 2 });
    expect(res).toEqual({ a: 1 });
  });

  test("PASS__collectIncomingArgs_2: POST merges body > query", () => {
    const res = handler._collectIncomingArgs("POST", { a: 1 }, { a: 2, b: 3 });
    expect(res).toEqual({ a: 2, b: 3 });
  });

  test("PASS__collectIncomingArgs_3: DELETE merges query & body", () => {
    const res = handler._collectIncomingArgs("DELETE", { x: "1" }, { y: "2" });
    expect(res).toEqual({ x: "1", y: "2" });
  });

  test("PASS__collectIncomingArgs_4: unknown method uses query only", () => {
    const res = handler._collectIncomingArgs(
      "WHATEVER",
      { x: "1" },
      { y: "2" }
    );
    expect(res).toEqual({ x: "1" });
  });

  // --- _errorResponse ---

  test("PASS__errorResponse_1: returns standard error format", () => {
    const res = handler._errorResponse(403, "Forbidden", { cause: "auth" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error.details.cause).toBe("auth");
  });
});
