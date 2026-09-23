// Release smoke check: validates the built package before publishing.
//
//   1. dist/ actually built and is loadable, with .d.ts alongside it.
//   2. Every named import each examples/*.ts file pulls from the SDK's
//      root barrel (via "@zk-payroll/core" or "packages/core/src")
//      resolves to a real export of the built package.
//   3. PayrollService — the SDK's main entry point — can be constructed
//      end-to-end against a mock RPC server without throwing.
//
// Run: npm run build && npm run release:smoke
// (also runs in CI post-build — see release-smoke.test.ts for the
// unit-level coverage of the underlying check functions)
const fs = require("fs");
const path = require("path");

// See generate-error-docs.js for why this is dist/src/index.js and not
// dist/index.js: tsconfig.json has no rootDir, so tsc infers it as the
// common ancestor of `src`/`tests` and emits under dist/src.
const distIndex = path.join(__dirname, "..", "dist", "src", "index.js");
const distTypes = path.join(__dirname, "..", "dist", "src", "index.d.ts");
const examplesDir = path.join(__dirname, "..", "..", "..", "examples");

if (!fs.existsSync(distIndex)) {
  console.error(`${distIndex} not found — run \`npm run build\` first`);
  process.exit(1);
}

const {
  checkBuildArtifacts,
  checkClientConstruction,
  extractDeclaredTypeNames,
  findBrokenExampleImports,
} = require(distIndex);

let failed = false;

// ── 1. Build artifacts ───────────────────────────────────────────────────
const buildResult = checkBuildArtifacts(distIndex, distTypes);
if (!buildResult.ok) {
  failed = true;
  console.error("[build] FAILED");
  buildResult.errors.forEach((e) => console.error(`  - ${e}`));
} else {
  console.log("[build] OK — entry point and type declarations present");
}

// ── 2. Example imports ───────────────────────────────────────────────────
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

if (!fs.existsSync(examplesDir)) {
  console.error(`[examples] FAILED — examples directory not found at ${examplesDir}`);
  failed = true;
} else {
  const exampleFiles = walk(examplesDir).filter((f) => f.endsWith(".ts"));
  const sources = {};
  for (const file of exampleFiles) {
    sources[path.relative(examplesDir, file)] = fs.readFileSync(file, "utf8");
  }

  const sdkExports = Object.keys(require(distIndex));
  const declaredTypeNames = extractDeclaredTypeNames(distTypes);
  const broken = findBrokenExampleImports(sources, sdkExports, declaredTypeNames);

  if (broken.length > 0) {
    failed = true;
    console.error(`[examples] FAILED — ${broken.length} broken import(s)`);
    broken.forEach(({ file, specifier, missingNames }) => {
      console.error(`  - ${file}: "${specifier}" is missing ${missingNames.join(", ")}`);
    });
  } else {
    console.log(`[examples] OK — checked ${exampleFiles.length} example file(s)`);
  }
}

// ── 3. Client construction ───────────────────────────────────────────────
const clientResult = checkClientConstruction();
if (!clientResult.ok) {
  failed = true;
  console.error(`[client] FAILED — ${clientResult.error}`);
} else {
  console.log("[client] OK — PayrollService constructed against a mock RPC server");
}

if (failed) {
  console.error("\nRelease smoke check FAILED — do not publish.");
  process.exit(1);
}

console.log("\nRelease smoke check passed.");
