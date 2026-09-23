/**
 * Tests for the release smoke check building blocks: build-artifact
 * verification, example-import extraction/resolution (including
 * `.d.ts`-only type exports reached via `export * from`), and
 * client-construction against a mock RPC server.
 */

import {
  checkBuildArtifacts,
  checkClientConstruction,
  extractDeclaredTypeNames,
  extractNamedImports,
  findBrokenExampleImports,
  isSdkRootImport,
} from "../src/testing/releaseSmoke";

describe("checkBuildArtifacts", () => {
  it("passes when the entry point loads with members and types exist", () => {
    // __filename is a stand-in for "a real, readable file" — only its
    // existence matters here, checkBuildArtifacts never parses it.
    const result = checkBuildArtifacts(__filename, __filename, () => ({ Foo: class {} }));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when require() throws", () => {
    const result = checkBuildArtifacts("/fake/dist/index.js", "/fake/dist/index.d.ts", () => {
      throw new Error("Cannot find module");
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Failed to require");
  });

  it("fails when the module exports nothing", () => {
    const result = checkBuildArtifacts("/fake/dist/index.js", "/fake/dist/index.d.ts", () => ({}));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("/fake/dist/index.js exports no members");
  });
});

describe("extractNamedImports", () => {
  it("extracts a plain named import", () => {
    const [imp] = extractNamedImports('import { Foo, Bar } from "../packages/core/src";');
    expect(imp).toEqual({
      names: ["Foo", "Bar"],
      specifier: "../packages/core/src",
      isTypeOnly: false,
    });
  });

  it("marks `import type { ... }` as type-only", () => {
    const [imp] = extractNamedImports('import type { Foo } from "@zk-payroll/core";');
    expect(imp.isTypeOnly).toBe(true);
  });

  it("strips `as` aliases down to the imported name", () => {
    const [imp] = extractNamedImports('import { Foo as F } from "@zk-payroll/core";');
    expect(imp.names).toEqual(["Foo"]);
  });

  it("ignores default and namespace imports", () => {
    expect(extractNamedImports('import Foo from "bar";')).toEqual([]);
    expect(extractNamedImports('import * as Foo from "bar";')).toEqual([]);
  });
});

describe("isSdkRootImport", () => {
  it("matches the published package name", () => {
    expect(isSdkRootImport("@zk-payroll/core")).toBe(true);
  });

  it("matches a relative path into packages/core/src", () => {
    expect(isSdkRootImport("../packages/core/src")).toBe(true);
    expect(isSdkRootImport("../../packages/core/src")).toBe(true);
    expect(isSdkRootImport("../../packages/core/src/index")).toBe(true);
  });

  it("excludes subpath imports that bypass the root barrel", () => {
    expect(isSdkRootImport("../../packages/core/src/simulation")).toBe(false);
  });

  it("excludes unrelated specifiers", () => {
    expect(isSdkRootImport("@stellar/stellar-sdk")).toBe(false);
  });
});

describe("extractDeclaredTypeNames", () => {
  it("collects names declared directly in the entry file", () => {
    const files: Record<string, string> = {
      "/dist/index.d.ts": "export interface Foo {}\nexport type Bar = string;\n",
    };
    const names = extractDeclaredTypeNames(
      "/dist/index.d.ts",
      (p) => files[p],
      (p) => p in files
    );
    expect(names).toEqual(expect.arrayContaining(["Foo", "Bar"]));
  });

  it("follows `export * from` into a sibling file (flat .d.ts form)", () => {
    const files: Record<string, string> = {
      "/dist/index.d.ts": 'export * from "./widgets";\n',
      "/dist/widgets.d.ts": "export interface Widget {}\n",
    };
    const names = extractDeclaredTypeNames(
      "/dist/index.d.ts",
      (p) => files[p],
      (p) => p in files
    );
    expect(names).toContain("Widget");
  });

  it("follows `export * from` into a directory's index.d.ts", () => {
    const files: Record<string, string> = {
      "/dist/index.d.ts": 'export * from "./widgets";\n',
      "/dist/widgets/index.d.ts": "export interface Widget {}\n",
    };
    const names = extractDeclaredTypeNames(
      "/dist/index.d.ts",
      (p) => files[p],
      (p) => p in files
    );
    expect(names).toContain("Widget");
  });

  it("follows chained wildcard re-exports transitively", () => {
    const files: Record<string, string> = {
      "/dist/index.d.ts": 'export * from "./mid";\n',
      "/dist/mid.d.ts": 'export * from "./leaf";\n',
      "/dist/leaf.d.ts": "export interface DeepType {}\n",
    };
    const names = extractDeclaredTypeNames(
      "/dist/index.d.ts",
      (p) => files[p],
      (p) => p in files
    );
    expect(names).toContain("DeepType");
  });

  it("collects names from named re-exports", () => {
    const files: Record<string, string> = {
      "/dist/index.d.ts": 'export { Foo, Bar as Baz } from "./x";\n',
    };
    const names = extractDeclaredTypeNames(
      "/dist/index.d.ts",
      (p) => files[p],
      (p) => p in files
    );
    expect(names).toEqual(expect.arrayContaining(["Foo", "Baz"]));
  });

  it("does not infinite-loop on a circular export * chain", () => {
    const files: Record<string, string> = {
      "/dist/index.d.ts": 'export * from "./a";\n',
      "/dist/a.d.ts": 'export interface A {}\nexport * from "./index";\n',
    };
    const names = extractDeclaredTypeNames(
      "/dist/index.d.ts",
      (p) => files[p],
      (p) => p in files
    );
    expect(names).toContain("A");
  });

  it("resolves against the real compiled dist output", () => {
    const path = require("path") as typeof import("path");
    const entry = path.join(__dirname, "..", "dist", "src", "index.d.ts");
    if (!require("fs").existsSync(entry)) {
      // Build hasn't run in this environment; skip rather than false-fail.
      return;
    }
    const names = extractDeclaredTypeNames(entry);
    // IProofGenerator and PaymentParams are only reachable via chained
    // `export * from` wildcards (crypto/IProofGenerator, types/index) —
    // this is the exact case that broke before the recursive resolver.
    expect(names).toContain("IProofGenerator");
    expect(names).toContain("PaymentParams");
    expect(names).toContain("ProofArtifactManifest");
  });
});

describe("findBrokenExampleImports", () => {
  it("flags a name missing from both runtime exports and declared types", () => {
    const files = { "example.ts": 'import { Ghost } from "@zk-payroll/core";' };
    const broken = findBrokenExampleImports(files, ["Real"], ["RealType"]);
    expect(broken).toEqual([
      { file: "example.ts", specifier: "@zk-payroll/core", missingNames: ["Ghost"] },
    ]);
  });

  it("resolves a name present only in declared types (a type-only export)", () => {
    const files = { "example.ts": 'import { OnlyType } from "@zk-payroll/core";' };
    const broken = findBrokenExampleImports(files, ["Real"], ["OnlyType"]);
    expect(broken).toEqual([]);
  });

  it("resolves a name present only in runtime exports (a value export)", () => {
    const files = { "example.ts": 'import { OnlyValue } from "@zk-payroll/core";' };
    const broken = findBrokenExampleImports(files, ["OnlyValue"], []);
    expect(broken).toEqual([]);
  });

  it("ignores imports from specifiers outside the SDK root barrel", () => {
    const files = { "example.ts": 'import { Server } from "@stellar/stellar-sdk";' };
    const broken = findBrokenExampleImports(files, [], []);
    expect(broken).toEqual([]);
  });
});

describe("checkClientConstruction", () => {
  it("constructs PayrollService against a mock RPC server without throwing", () => {
    const result = checkClientConstruction();
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("never performs real network I/O (construction alone, no RPC call)", async () => {
    const start = Date.now();
    const result = checkClientConstruction("https://smoke-test.invalid/soroban/rpc");
    expect(result.ok).toBe(true);
    // A real network attempt against an unreachable host would take
    // well over a second (DNS/connect timeout); construction should
    // return effectively instantly.
    expect(Date.now() - start).toBeLessThan(500);
  });
});
