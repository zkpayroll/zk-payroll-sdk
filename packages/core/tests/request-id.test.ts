import {
  REQUEST_ID_HEADER,
  isValidRequestIdentifier,
  normalizeRequestId,
  withRequestIdHeader,
} from "../src/core/request-id";
import { RunIdentifier } from "../src/core/run-identifier";
import { ValidationError } from "../src/core/errors";

describe("request id validation", () => {
  it("accepts RunIdentifier formats and common tracing ids", () => {
    expect(isValidRequestIdentifier(RunIdentifier.generateRequestId("private_pay"))).toBe(true);
    const run = RunIdentifier.generate();
    expect(isValidRequestIdentifier(run)).toBe(true);
    expect(isValidRequestIdentifier(RunIdentifier.generateCorrelationId(run, "commit"))).toBe(true);
    expect(isValidRequestIdentifier("6f1c2d9e-8b1a-4c3d-9e2f-1a2b3c4d5e6f")).toBe(true);
  });

  it("rejects empty, oversized and free-form values", () => {
    for (const bad of [
      "",
      " req_1",
      "req 1",
      "req\n1",
      "salary=5000 alice",
      "x".repeat(129),
      "-leading",
    ]) {
      expect(isValidRequestIdentifier(bad)).toBe(false);
    }
  });

  it("normalizeRequestId passes through undefined and throws a redacted ValidationError", () => {
    expect(normalizeRequestId(undefined)).toBeUndefined();
    expect(normalizeRequestId("req_abc")).toBe("req_abc");

    const secret = "Alice salary 95000";
    let caught: unknown;
    try {
      normalizeRequestId(secret);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).code).toBe("INVALID_REQUEST_ID");
    expect((caught as ValidationError).field).toBe("requestId");
    expect((caught as Error).message).not.toContain("95000");
    expect((caught as Error).message).not.toContain("Alice");
  });
});

describe("withRequestIdHeader", () => {
  it("adds the header without mutating the input", () => {
    const headers = { Accept: "application/json" };
    const out = withRequestIdHeader(headers, "req_1");
    expect(out).toEqual({ Accept: "application/json", [REQUEST_ID_HEADER]: "req_1" });
    expect(headers).toEqual({ Accept: "application/json" });
  });

  it("is a no-op without an id and preserves an explicit header", () => {
    const headers = { "x-request-id": "caller-set" };
    expect(withRequestIdHeader(headers, undefined)).toBe(headers);
    expect(withRequestIdHeader(headers, "req_2")).toBe(headers);
  });
});
