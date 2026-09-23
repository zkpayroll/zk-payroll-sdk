/**
 * Tests for the error code documentation generator: that it produces
 * stable markdown from the canonical registry, and correctly detects
 * declared error codes that are missing a registry entry.
 */

import {
  buildErrorDocRows,
  findUndocumentedErrorCodes,
  getDeclaredErrorCodesBySource,
  renderErrorDocsMarkdown,
} from "../src/error-docs/docGenerator";
import { ERROR_CODE_REGISTRY, type ErrorCodeEntry } from "../src/core/error-codes";

describe("findUndocumentedErrorCodes", () => {
  it("finds no undocumented codes against the real SDK registry", () => {
    expect(findUndocumentedErrorCodes()).toEqual([]);
  });

  it("every code declared by a *ErrorCode object has a matching registry entry", () => {
    const declared = Object.values(getDeclaredErrorCodesBySource()).flat();
    for (const code of declared) {
      expect(ERROR_CODE_REGISTRY).toHaveProperty(code);
    }
  });
});

describe("buildErrorDocRows", () => {
  it("produces one row per registry entry, sorted by code", () => {
    const rows = buildErrorDocRows();
    expect(rows).toHaveLength(Object.keys(ERROR_CODE_REGISTRY).length);

    const codes = rows.map((r) => r.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });

  it("labels a code's source as the *ErrorCode object(s) that declare it", () => {
    const rows = buildErrorDocRows();
    const rpcTimeout = rows.find((r) => r.code === "RPC_TIMEOUT");
    expect(rpcTimeout?.source).toBe("ContractErrorCode");
  });

  it("falls back to 'registry' for codes not surfaced by any *ErrorCode object", () => {
    const rows = buildErrorDocRows();
    const auditCode = rows.find((r) => r.code === "AUDIT_ACCESS_REQUEST_VALIDATION_FAILED");
    expect(auditCode?.source).toBe("registry");
  });
});

describe("renderErrorDocsMarkdown", () => {
  it("is deterministic across repeated calls against unchanged source", () => {
    expect(renderErrorDocsMarkdown()).toBe(renderErrorDocsMarkdown());
  });

  it("includes a header, row count, and a markdown table with every code", () => {
    const markdown = renderErrorDocsMarkdown();
    expect(markdown).toContain("# SDK Error Codes");
    expect(markdown).toContain(
      `${Object.keys(ERROR_CODE_REGISTRY).length} documented error code(s).`
    );
    expect(markdown).toContain(
      "| Code | Source | Category | Meaning | Retryable | Suggested Fix |"
    );
    for (const code of Object.keys(ERROR_CODE_REGISTRY)) {
      expect(markdown).toContain(`\`${code}\``);
    }
  });

  it("escapes pipe characters in meaning/suggestedMessage so the table doesn't break", () => {
    const registry: Record<string, ErrorCodeEntry> = {
      TEST_CODE: {
        category: "validation",
        meaning: "A meaning with a | pipe character",
        retryable: false,
        suggestedMessage: "A fix with a | pipe too",
      },
    };
    const markdown = renderErrorDocsMarkdown(buildErrorDocRows(registry));
    expect(markdown).toContain("A meaning with a \\| pipe character");
    expect(markdown).toContain("A fix with a \\| pipe too");
  });
});

describe("undocumented-code detection (regression guard)", () => {
  it("flags a real declared code when it's missing from a candidate registry", () => {
    // Simulates the exact failure mode the issue calls out: a new code
    // added to a *ErrorCode object (here, a real one — RPC_TIMEOUT) is
    // introduced before ERROR_CODE_REGISTRY is updated to document it.
    const registryMissingRpcTimeout = { ...ERROR_CODE_REGISTRY };
    delete registryMissingRpcTimeout.RPC_TIMEOUT;

    expect(findUndocumentedErrorCodes(registryMissingRpcTimeout)).toEqual(["RPC_TIMEOUT"]);
  });

  it("returns an empty array when every declared code has a registry entry", () => {
    expect(findUndocumentedErrorCodes(ERROR_CODE_REGISTRY)).toEqual([]);
  });
});
