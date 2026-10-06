import * as fs from "fs";
import * as path from "path";
import { webcrypto } from "crypto";
import { Worker } from "worker_threads";

/**
 * Runtime compatibility guard for the documented support matrix.
 *
 * `docs/SUPPORT_MATRIX.md` is the promise the SDK makes about the runtimes it supports, and the
 * `engines` range in `package.json` / `packages/core/package.json` records that promise for
 * consumers. This suite keeps the documentation, the manifests, the CI workflow and the runtime
 * actually executing the tests in agreement, so drift (for example "the docs claim a Node
 * 20/22/24 matrix but CI only runs Node 24") fails loudly instead of shipping.
 *
 * Only Node built-ins are used — the workspace already depends on `jest`/`ts-jest`.
 */

const DOC_PATH = path.join("docs", "SUPPORT_MATRIX.md");
const DOCUMENTED_NODE_MAJORS = [20, 22, 24];

type Version = [number, number, number];

function findRepoRoot(): string {
  const starts: string[] = [process.cwd()];
  if (typeof __dirname === "string") {
    starts.push(__dirname);
  }

  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 6; depth += 1) {
      if (fs.existsSync(path.join(dir, DOC_PATH))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  throw new Error(
    `Unable to locate ${DOC_PATH}. Run the suite through \`npm test\` from the repository root ` +
      "or from the packages/core workspace."
  );
}

const REPO_ROOT = findRepoRoot();
const supportMatrix = fs.readFileSync(path.join(REPO_ROOT, DOC_PATH), "utf8");

// ── Documented support matrix ────────────────────────────────────────────

/** Extracts the Node.js majors the support matrix marks as fully supported. */
function parseDocumentedNodeMajors(markdown: string): number[] {
  const majors = new Set<number>();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|") || !line.includes("✅")) {
      continue;
    }
    const match = /\|\s*(\d{1,2})\.x\b/.exec(line);
    if (match) {
      majors.add(Number(match[1]));
    }
  }
  return Array.from(majors).sort((a, b) => a - b);
}

// ── CI workflow matrix ───────────────────────────────────────────────────

function readWorkflowSources(): string {
  const workflowsDir = path.join(REPO_ROOT, ".github", "workflows");
  return fs
    .readdirSync(workflowsDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => fs.readFileSync(path.join(workflowsDir, file), "utf8"))
    .join("\n");
}

/** Collects the entries of every `node: [...]` matrix dimension in the workflows. */
function parseCiNodeMatrixVersions(source: string): string[] {
  const versions: string[] = [];
  const matrixList = /node:\s*\[([^\]]*)\]/g;
  let match = matrixList.exec(source);
  while (match !== null) {
    for (const entry of match[1].split(",")) {
      const token = entry.trim().replace(/^["']|["']$/g, "");
      if (token.length > 0) {
        versions.push(token);
      }
    }
    match = matrixList.exec(source);
  }
  return versions;
}

function majorOf(versionLabel: string): number | null {
  const match = /^(\d+)/.exec(versionLabel);
  return match ? Number(match[1]) : null;
}

// ── Manifests and lockfile ───────────────────────────────────────────────

interface PackageManifest {
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  packageManager?: string;
}

function readManifest(relativePath: string): PackageManifest {
  const contents = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  return JSON.parse(contents) as PackageManifest;
}

const rootManifest = readManifest("package.json");
const coreManifest = readManifest(path.join("packages", "core", "package.json"));

// ── Minimal semver range support (no dependency on the `semver` package) ──

function parseVersion(raw: string): Version {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(raw.trim());
  if (!match) {
    throw new Error(`Unsupported version string: ${raw}`);
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1;
    }
  }
  return 0;
}

function tokenSatisfied(version: Version, token: string): boolean {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(token.trim());
  if (!match) {
    throw new Error(`Unsupported range token: ${token}`);
  }
  const operator = match[1] ?? "=";
  const target = parseVersion(match[2]);

  switch (operator) {
    case ">":
      return compareVersions(version, target) > 0;
    case ">=":
      return compareVersions(version, target) >= 0;
    case "<":
      return compareVersions(version, target) < 0;
    case "<=":
      return compareVersions(version, target) <= 0;
    case "^":
      return version[0] === target[0] && compareVersions(version, target) >= 0;
    case "~":
      return (
        version[0] === target[0] &&
        version[1] === target[1] &&
        compareVersions(version, target) >= 0
      );
    default:
      return compareVersions(version, target) === 0;
  }
}

function satisfiesRange(version: Version, range: string): boolean {
  return range.split("||").some((clause) =>
    clause
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => tokenSatisfied(version, token))
  );
}

/** Every major version referenced by a range, e.g. `>=20.0.0` → `[20]`. */
function referencedMajors(range: string): number[] {
  return (range.match(/(\d+)(?:\.\d+){0,2}/g) ?? []).map((token) => Number(token.split(".")[0]));
}

// ── Runtime feature detection ────────────────────────────────────────────

interface RuntimeVersion {
  node: string;
  npm: string;
}

interface FeatureCheck {
  name: string;
  detail: string;
  available: () => boolean;
}

const isBrowserLike =
  typeof (globalThis as unknown as Record<string, unknown>).window !== "undefined" &&
  typeof (globalThis as unknown as Record<string, unknown>).document !== "undefined";

function readRuntimeVersion(): RuntimeVersion {
  const npmMatch = /npm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? "");
  return {
    node: process.versions.node,
    npm: npmMatch ? npmMatch[1] : "unknown",
  };
}

const NODE_FEATURE_CHECKS: FeatureCheck[] = [
  {
    name: "BigInt",
    detail: "required for ZK witness arithmetic (ES2020)",
    available: () => typeof BigInt === "function",
  },
  {
    name: "BigInt64Array",
    detail: "required by snarkjs field and typed-array handling",
    available: () => typeof BigInt64Array === "function",
  },
  {
    name: "WebAssembly",
    detail: "required to execute Groth16 wasm circuits",
    available: () => typeof WebAssembly === "object",
  },
  {
    name: "global fetch",
    detail: "required to load circuit artifacts over HTTP",
    available: () => typeof (globalThis as unknown as Record<string, unknown>).fetch === "function",
  },
  {
    name: "AbortController",
    detail: "required for request cancellation and proof timeouts",
    available: () => typeof AbortController === "function",
  },
  {
    name: "TextEncoder/TextDecoder",
    detail: "required for payload serialization",
    available: () => typeof TextEncoder === "function" && typeof TextDecoder === "function",
  },
  {
    name: "structuredClone",
    detail: "required to move witness payloads across worker boundaries",
    available: () =>
      typeof (globalThis as unknown as Record<string, unknown>).structuredClone === "function",
  },
  {
    name: "WebCrypto subtle",
    detail: "required for sha256 digests in proof and receipt verification",
    available: () => typeof webcrypto.subtle === "object",
  },
  {
    name: "worker_threads",
    detail: "required for off-thread work in Node environments",
    available: () => typeof Worker === "function",
  },
];

function collectUnavailableFeatures(checks: FeatureCheck[]): FeatureCheck[] {
  return checks.filter((check) => !check.available());
}

/**
 * Renders an actionable report from static feature names and runtime version numbers only. It
 * never reads or echoes environment values, witness payloads or payroll data.
 */
function buildCompatibilityReport(failures: FeatureCheck[], runtime: RuntimeVersion): string {
  if (failures.length === 0) {
    return `Runtime Node.js ${runtime.node} (npm ${runtime.npm}) satisfies the documented support matrix.`;
  }

  return [
    "The running runtime is outside the documented support matrix (see docs/SUPPORT_MATRIX.md):",
    `  Node.js: ${runtime.node}`,
    `  npm: ${runtime.npm}`,
    ...failures.map((failure) => `  - ${failure.name} unavailable: ${failure.detail}`),
    "Upgrade to a supported Node.js release and reinstall with `npm ci`.",
  ].join("\n");
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("runtime compatibility matrix", () => {
  const documentedMajors = parseDocumentedNodeMajors(supportMatrix);
  const nodeEngine = rootManifest.engines?.node ?? "";
  const npmEngine = rootManifest.engines?.npm ?? "";
  const coreNodeEngine = coreManifest.engines?.node ?? "";

  describe("documented support matrix", () => {
    it("lists the Node.js releases the SDK claims full support for", () => {
      expect(documentedMajors).toEqual(expect.arrayContaining(DOCUMENTED_NODE_MAJORS));
    });

    it("never documents a Node.js release below the declared engine floor", () => {
      expect(nodeEngine).not.toHaveLength(0);
      expect(documentedMajors.length).toBeGreaterThan(0);
      expect(Math.min(...referencedMajors(nodeEngine))).toBe(Math.min(...documentedMajors));
    });
  });

  describe("engine declarations", () => {
    it("declares the same Node.js engine range in the root and core manifests", () => {
      expect(nodeEngine).not.toHaveLength(0);
      expect(coreNodeEngine).toBe(nodeEngine);
    });

    it("declares an npm floor compatible with the version 3 lockfile workflow", () => {
      const lockfile = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8")
      ) as { lockfileVersion?: number };

      expect(lockfile.lockfileVersion).toBe(3);
      expect(rootManifest.packageManager).toMatch(/^npm@\d+/);
      expect(Math.min(...referencedMajors(npmEngine))).toBeGreaterThanOrEqual(9);
    });
  });

  describe("CI workflow coverage", () => {
    const workflowSource = readWorkflowSources();
    const matrixMajors = new Set(
      parseCiNodeMatrixVersions(workflowSource)
        .map(majorOf)
        .filter((major): major is number => major !== null)
    );

    it("exercises every documented Node.js release in the workflow matrix", () => {
      const uncovered = documentedMajors.filter((major) => !matrixMajors.has(major));
      expect(uncovered).toEqual([]);
    });

    it("installs from the committed lockfile and runs the compatibility guard", () => {
      expect(workflowSource).toMatch(/npm ci/);
      expect(workflowSource).toMatch(/test:compat/);
      expect(workflowSource).toMatch(/test:browser/);
    });

    it("runs a compatibility script that the repository actually defines", () => {
      expect(rootManifest.scripts?.["test:compat"]).toBeTruthy();

      const coreScript = coreManifest.scripts?.["test:compat"] ?? "";
      expect(coreScript).toContain("runtime-compatibility.test.ts");

      const configMatch = /--config\s+(\S+)/.exec(coreScript);
      expect(configMatch).not.toBeNull();
      if (configMatch) {
        const configPath = path.join(REPO_ROOT, "packages", "core", configMatch[1]);
        expect(fs.existsSync(configPath)).toBe(true);
      }
    });
  });

  const describeNodeRuntime = isBrowserLike ? describe.skip : describe;

  describeNodeRuntime("current Node.js runtime", () => {
    const runtime = readRuntimeVersion();
    const nodeVersion = parseVersion(runtime.node);

    it("is one of the documented Node.js releases", () => {
      expect(documentedMajors).toContain(nodeVersion[0]);
    });

    it("satisfies the declared engine range", () => {
      expect(satisfiesRange(nodeVersion, nodeEngine)).toBe(true);
    });

    it("satisfies the declared npm engine range when launched through npm", () => {
      if (runtime.npm === "unknown") {
        // Jest was not launched through npm (for example via npx); the lockfile check above
        // still pins the package-manager workflow.
        return;
      }
      expect(satisfiesRange(parseVersion(runtime.npm), npmEngine)).toBe(true);
    });

    it("exposes every Node.js built-in the SDK relies on", () => {
      const failures = collectUnavailableFeatures(NODE_FEATURE_CHECKS);
      expect(buildCompatibilityReport(failures, runtime)).toBe(
        `Runtime Node.js ${runtime.node} (npm ${runtime.npm}) satisfies the documented support matrix.`
      );
    });
  });

  describe("failure reporting", () => {
    it("names the missing feature without echoing environment values", () => {
      const sentinel = "do-not-leak-this-payroll-value";
      process.env.ZK_PAYROLL_COMPAT_SENTINEL = sentinel;
      try {
        const report = buildCompatibilityReport(
          [
            {
              name: "Synthetic feature",
              detail: "not observable in this runtime",
              available: () => false,
            },
          ],
          { node: "0.0.0", npm: "0.0.0" }
        );

        expect(report).toContain("Synthetic feature");
        expect(report).toContain("Node.js: 0.0.0");
        expect(report).not.toContain(sentinel);
      } finally {
        delete process.env.ZK_PAYROLL_COMPAT_SENTINEL;
      }
    });
  });
});
