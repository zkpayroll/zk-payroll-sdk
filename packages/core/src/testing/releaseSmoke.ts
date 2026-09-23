/**
 * Release Smoke Checks
 *
 * Validates, before publishing, that:
 *   1. the package's build output actually exists and is loadable,
 *   2. every named import an `examples/*.ts` file pulls from the SDK
 *      resolves to a real export of the built package (catches examples
 *      that silently drifted from a renamed/removed export), and
 *   3. a `PayrollService` can be constructed end-to-end against a mock
 *      RPC server without throwing (catches a broken constructor chain
 *      without needing a live Soroban network).
 *
 * Pure, side-effect-light functions so they're unit-testable with
 * ts-jest; `scripts/release-smoke.js` is the thin CLI wrapper that
 * runs these against the compiled `dist/` output and exits non-zero
 * on failure (see that file for why it must run post-build).
 */
import { existsSync, readFileSync } from "fs";
import { dirname, resolve as resolvePath, posix } from "path";
import { Keypair, Networks, rpc, StrKey } from "@stellar/stellar-sdk";
import { PayrollService } from "../payroll";
import { PayrollContractWrapper } from "../adapters/PayrollContractWrapper";
import type { IProofGenerator, ProofPayload } from "../crypto/IProofGenerator";

/** Result of checking that a build's entry point loads and exposes expected shape. */
export interface BuildCheckResult {
  ok: boolean;
  entryPath: string;
  typesPath: string;
  errors: string[];
}

/**
 * Verifies the compiled entry point (`dist/src/index.js` per this
 * package's actual — if non-standard — tsc output layout, see
 * `scripts/generate-error-docs.js` for the same caveat) exists, is
 * `require`-able, and that its declaration file exists alongside it.
 */
export function checkBuildArtifacts(
  entryPath: string,
  typesPath: string,
  requireFn: (path: string) => unknown = require
): BuildCheckResult {
  const errors: string[] = [];
  let moduleExports: unknown;

  try {
    moduleExports = requireFn(entryPath);
  } catch (err) {
    errors.push(`Failed to require ${entryPath}: ${(err as Error).message}`);
    return { ok: false, entryPath, typesPath, errors };
  }

  if (!moduleExports || typeof moduleExports !== "object") {
    errors.push(`${entryPath} did not export an object`);
  } else if (Object.keys(moduleExports).length === 0) {
    errors.push(`${entryPath} exports no members`);
  }

  try {
    readFileSync(typesPath, "utf8");
  } catch {
    errors.push(`Type declarations not found at ${typesPath} — did the build emit .d.ts files?`);
  }

  return { ok: errors.length === 0, entryPath, typesPath, errors };
}

/** A single named import statement extracted from an example file. */
export interface ExtractedImport {
  names: string[];
  specifier: string;
  isTypeOnly: boolean;
}

const IMPORT_STATEMENT_RE = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;

/**
 * Extracts named (non-default, non-namespace) import statements from a
 * TypeScript source string. Deliberately simple regex-based parsing —
 * examples are plain, unminified source, so a full AST parser is not
 * needed to catch the failure mode this guards against (a renamed or
 * removed export).
 */
export function extractNamedImports(source: string): ExtractedImport[] {
  const results: ExtractedImport[] = [];
  let match: RegExpExecArray | null;
  IMPORT_STATEMENT_RE.lastIndex = 0;

  while ((match = IMPORT_STATEMENT_RE.exec(source)) !== null) {
    const [, typeOnly, namesBlock, specifier] = match;
    const names = namesBlock
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .map((n) => n.split(/\s+as\s+/)[0].trim());

    results.push({ names, specifier, isTypeOnly: Boolean(typeOnly) });
  }

  return results;
}

/**
 * SDK-internal import specifiers this check should validate against
 * the built package's exports — i.e. anything that resolves to the
 * SDK's own root barrel, whether via the published package name or a
 * relative path into `packages/core/src`. Subpath imports (e.g.
 * `packages/core/src/simulation`) are intentionally excluded: they
 * bypass the root barrel by design and aren't part of its public
 * export surface.
 */
export function isSdkRootImport(specifier: string): boolean {
  if (specifier === "@zk-payroll/core") return true;
  const normalized = specifier.replace(/\/index$/, "").replace(/\/$/, "");
  return /(^|\/)packages\/core\/src$/.test(normalized);
}

/** A single example import that could not be resolved against the SDK's exports. */
export interface BrokenExampleImport {
  file: string;
  specifier: string;
  missingNames: string[];
}

/** Names declared or re-exported at the top level of a single `.d.ts` file's text. */
function extractLocalDeclaredNames(dtsSource: string): {
  names: string[];
  wildcardSpecifiers: string[];
} {
  const names = new Set<string>();
  const wildcardSpecifiers: string[] = [];

  const declRe =
    /^export\s+(?:declare\s+)?(?:interface|type|class|const|function|enum)\s+([A-Za-z0-9_$]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = declRe.exec(dtsSource)) !== null) {
    names.add(match[1]);
  }

  // `export { A, B as C } from "./x";` and `export type { A, B } from "./x";`
  const reExportRe = /^export\s+(?:type\s+)?\{([^}]+)\}/gm;
  while ((match = reExportRe.exec(dtsSource)) !== null) {
    for (const raw of match[1].split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }

  // `export * from "./x";` — no explicit names; must follow the target file.
  const wildcardRe = /^export\s+\*\s+from\s+["']([^"']+)["']/gm;
  while ((match = wildcardRe.exec(dtsSource)) !== null) {
    wildcardSpecifiers.push(match[1]);
  }

  return { names: Array.from(names), wildcardSpecifiers };
}

/**
 * Extracts every exported type/interface/class/const name reachable
 * from a `.d.ts` entry point — good enough to tell "this name is a
 * legitimate type export" from "this name doesn't exist anywhere",
 * without a full TS type-checker.
 *
 * Recursively follows `export * from "./relative"` re-exports (tsc
 * emits these for every `export * from` barrel in the source), since
 * a wildcard re-export carries no explicit name list to parse — the
 * only way to know what it exposes is to read the file it points to.
 *
 * @param entryPath - Absolute path to the root `.d.ts` file to start from.
 * @param readFileFn - Injectable for testing without real files on disk.
 */
export function extractDeclaredTypeNames(
  entryPath: string,
  readFileFn: (path: string) => string = (p) => readFileSync(p, "utf8"),
  existsFn: (path: string) => boolean = existsSync
): string[] {
  const names = new Set<string>();
  const visited = new Set<string>();

  function getDir(p: string): string {
    return p.startsWith("/") && !p.includes(":") ? posix.dirname(p) : dirname(p);
  }

  /** Mirrors Node/TS module resolution: try "<specifier>.d.ts", then "<specifier>/index.d.ts". */
  function resolveDtsPath(fromDir: string, specifier: string): string | undefined {
    const isMockPosix = fromDir.startsWith("/") && !fromDir.includes(":");
    const resolve = isMockPosix ? posix.resolve : resolvePath;
    const asFile = `${resolve(fromDir, specifier)}.d.ts`;
    if (existsFn(asFile)) return asFile;
    const asIndex = resolve(fromDir, specifier, "index.d.ts");
    if (existsFn(asIndex)) return asIndex;
    return undefined;
  }

  function visit(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);

    let source: string;
    try {
      source = readFileFn(path);
    } catch {
      return;
    }

    const { names: localNames, wildcardSpecifiers } = extractLocalDeclaredNames(source);
    localNames.forEach((n) => names.add(n));

    const dir = getDir(path);
    for (const specifier of wildcardSpecifiers) {
      const targetPath = resolveDtsPath(dir, specifier);
      if (targetPath) visit(targetPath);
    }
  }

  visit(entryPath);
  return Array.from(names);
}

/**
 * Checks every named import an example file pulls from the SDK's root
 * barrel against the names the built package actually exposes — at
 * runtime (`exportedNames`, from `require()`-ing the compiled entry
 * point) or in its type declarations (`declaredTypeNames`, from its
 * `.d.ts`). A name only needs to appear in one of the two: a
 * type-only export (interface, type alias) is legitimately absent
 * from the runtime module regardless of whether the importing example
 * used `import type` or a plain `import` for it.
 *
 * @param files - Map of example file path (for reporting) to its raw source text.
 * @param exportedNames - The real runtime export names from the built `dist` entry point.
 * @param declaredTypeNames - Type-level export names from the built `dist` `.d.ts`.
 */
export function findBrokenExampleImports(
  files: Record<string, string>,
  exportedNames: readonly string[],
  declaredTypeNames: readonly string[] = []
): BrokenExampleImport[] {
  const resolvable = new Set([...exportedNames, ...declaredTypeNames]);
  const broken: BrokenExampleImport[] = [];

  for (const [file, source] of Object.entries(files)) {
    for (const imp of extractNamedImports(source)) {
      if (!isSdkRootImport(imp.specifier)) continue;

      const missingNames = imp.names.filter((name) => !resolvable.has(name));
      if (missingNames.length > 0) {
        broken.push({ file, specifier: imp.specifier, missingNames });
      }
    }
  }

  return broken;
}

/** A no-op proof generator — never calls a real circuit, only satisfies the interface. */
const SMOKE_PROOF_GENERATOR: IProofGenerator = {
  async generateProof(): Promise<ProofPayload> {
    throw new Error("SMOKE_PROOF_GENERATOR.generateProof() should never be invoked");
  },
};

export interface ClientConstructionResult {
  ok: boolean;
  error?: string;
}

/**
 * Verifies that `PayrollService` — the SDK's main entry point — can be
 * constructed end-to-end (contract wrapper → RPC server → signer →
 * service) without throwing.
 *
 * Deliberately does not call any method on the resulting service: an
 * `rpc.Server` only performs network I/O when a request method is
 * invoked, so construction alone exercises the constructor chain
 * (catching e.g. a broken signer conversion or contract wrapper
 * constructor) without needing a live or even reachable RPC endpoint.
 *
 * @param rpcUrl - Any syntactically valid URL; never actually contacted.
 */
export function checkClientConstruction(
  rpcUrl: string = "https://smoke-test.invalid/soroban/rpc"
): ClientConstructionResult {
  try {
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const dummyContractId = StrKey.encodeContract(Buffer.alloc(32, 1));
    const contractWrapper = new PayrollContractWrapper(server, dummyContractId);
    const signer = Keypair.random();

    new PayrollService(contractWrapper, SMOKE_PROOF_GENERATOR, signer, Networks.TESTNET);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
