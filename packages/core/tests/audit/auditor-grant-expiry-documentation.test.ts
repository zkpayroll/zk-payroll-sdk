import { readFileSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

describe("Auditor grant expiry documentation (#907)", () => {
  it("links both new behavior documents from the README", () => {
    const readme = read("README.md");

    expect(readme).toContain("## Auditor grant expiry validation");
    expect(readme).toContain("./docs/auditor-grant-expiry.md");
    expect(readme).toContain("## Payout batch retry errors");
    expect(readme).toContain("./docs/payout-batch-retry-errors.md");
    expect(readme).toContain("redacted auditor identifier and the bounded");
  });

  it("documents every operator-visible expiry status and purge boundary", () => {
    const doc = read("docs/auditor-grant-expiry.md");

    for (const status of ["`active`", "`expiring_soon`", "`expired`", "`unknown`", "`revoked`"]) {
      expect(doc).toContain(status);
    }
    expect(doc).toContain("DEFAULT_ACCESS_EXPIRING_SOON_THRESHOLD_MS");
    expect(doc).toContain("DEFAULT_AUDIT_ACCESS_RETENTION_WINDOW_MS");
    expect(doc).toContain("referenceTime - expiresAt > retentionWindowMs");
    expect(doc).toContain("strict");
    expect(doc).toContain("never enter a revision");
  });

  it("documents public safe-error helpers and retry diagnostics", () => {
    const auditDoc = read("docs/auditor-grant-expiry.md");
    const retryDoc = read("docs/payout-batch-retry-errors.md");

    expect(auditDoc).toContain("getAuditorGrantExpiryErrorMessage");
    expect(auditDoc).toContain("formatAuditorGrantExpiryError");
    expect(retryDoc).toContain("getPayoutBatchRetryStateErrorMessage");
    expect(retryDoc).toContain("formatPayoutBatchRetryStateError");
    expect(retryDoc).toContain("Integrity check failed: hash link broken at revision");
    expect(retryDoc).toContain("never echoed");
  });

  it("exposes every new API from the public barrels", () => {
    const coreIndex = read("packages/core/src/index.ts");
    const auditIndex = read("packages/core/src/audit/index.ts");

    expect(auditIndex).toContain('export * from "./grantExpiryState";');
    for (const modulePath of [
      "./audit/accessExpiry",
      "./audit/grantExpiryErrors",
      "./audit/grantExpiryValidation",
      "./audit/grantExpiryState",
      "./batches/retryState",
      "./batches/retryValidation",
    ]) {
      expect(coreIndex).toContain(`export * from "${modulePath}";`);
    }
  });
});
