// Generates docs/ERROR_CODES.md from the compiled error registry, and
// fails the process if any declared *ErrorCode value has no registry
// entry. Named distinctly from the existing hand-written docs/ERRORS.md
// (same directory, case-insensitive filesystems can't tell "errors.md"
// and "ERRORS.md" apart — they're literally the same file on disk).
// Run: npm run build && npm run docs:errors
const fs = require("fs");
const path = require("path");

// NOTE: tsconfig.json has no `rootDir`, so tsc infers it as the common
// ancestor of `src` and `tests` (this package's own root) and emits to
// `dist/src/...` rather than `dist/...` — a pre-existing mismatch with
// package.json's `main: "dist/index.js"` (confirmed present on
// upstream/dev, unrelated to this change). Point at the real emit path.
const distIndex = path.join(__dirname, "..", "dist", "src", "index.js");

if (!fs.existsSync(distIndex)) {
  console.error(`${distIndex} not found — run \`npm run build\` first`);
  process.exit(1);
}

const { findUndocumentedErrorCodes, renderErrorDocsMarkdown } = require(distIndex);

const undocumented = findUndocumentedErrorCodes();
if (undocumented.length > 0) {
  console.error("Undocumented error codes found (no ERROR_CODE_REGISTRY entry):");
  undocumented.forEach((code) => console.error(`  - ${code}`));
  console.error("\nAdd an entry to ERROR_CODE_REGISTRY in src/core/error-codes.ts.");
  process.exit(1);
}

const markdown = renderErrorDocsMarkdown();
const outPath = path.join(__dirname, "..", "..", "..", "docs", "ERROR_CODES.md");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, markdown, "utf8");

console.log(`Wrote ${outPath}`);
