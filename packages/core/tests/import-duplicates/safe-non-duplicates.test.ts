import { detectDuplicateClusters } from "../../src/import";
import { ImportEmployeeRecord } from "../../src/import/types";

let sequence = 0;

const NAME_POOL = [
  "Aurora Blythe",
  "Caspian Holt",
  "Delphine Okafor",
  "Emrys Calloway",
  "Fioralba Zuniga",
  "Gulliver Nash",
  "Halcyon Varga",
  "Isolde Mercer",
  "Jorah Whitlock",
  "Kerensa Dubois",
  "Lysander Poe",
  "Marisol Quintero",
];

/** Builds a record whose every field is unique unless explicitly overridden. */
function record(overrides: Partial<ImportEmployeeRecord> = {}): ImportEmployeeRecord {
  const n = ++sequence;
  const id = String(n).padStart(2, "0");
  return {
    employeeId: `EMP-ID-${id}`,
    walletAddress: `GWALLETADDRESS${id}${"X".repeat(30)}`,
    emailHash: `hash${id}${"f".repeat(12)}`,
    externalId: `HR-EXT-${id}`,
    name: NAME_POOL[n % NAME_POOL.length],
    department: `Dept ${id}`,
    salary: BigInt(n * 1000),
    asset: `AST-${id}`,
    rowNumber: n,
    ...overrides,
  };
}

describe("detectDuplicateClusters — safe non-duplicates", () => {
  beforeEach(() => {
    sequence = 0;
  });

  it("reports no clusters when every identity field is unique", () => {
    const records = [record(), record(), record()];
    const result = detectDuplicateClusters(records);

    expect(result.hasDuplicates).toBe(false);
    expect(result.clusters).toHaveLength(0);
    expect(result.duplicateRowCount).toBe(0);
    expect(result.totalRecords).toBe(3);
  });

  it("does not flag records that share only a department", () => {
    const records = [
      record({ name: "Alice Smith", department: "Engineering" }),
      record({ name: "Bob Jones", department: "Engineering" }),
    ];
    expect(detectDuplicateClusters(records).hasDuplicates).toBe(false);
  });

  it("does not flag records that share only salary and asset", () => {
    const records = [
      record({ name: "Unrelated One", salary: 500n, asset: "USDC" }),
      record({ name: "Unrelated Two", salary: 500n, asset: "USDC" }),
    ];
    expect(detectDuplicateClusters(records).hasDuplicates).toBe(false);
  });

  it("does not flag distinct names that are edit-distant beyond the threshold", () => {
    const records = [
      record({ name: "Quintina", department: "Ops" }),
      record({ name: "Bartholomew", department: "Ops" }),
    ];
    expect(detectDuplicateClusters(records).hasDuplicates).toBe(false);
  });

  it("does not flag a single record batch", () => {
    const result = detectDuplicateClusters([record()]);
    expect(result.hasDuplicates).toBe(false);
    expect(result.totalRecords).toBe(1);
  });

  it("treats different email hashes as unrelated even with similar names", () => {
    const records = [
      record({ emailHash: "aaaa1111aaaa1111", name: "Sam Taylor" }),
      record({ emailHash: "bbbb2222bbbb2222", name: "Sam Tailor" }),
    ];
    const result = detectDuplicateClusters(records);

    // Only the fuzzy-name signal fires, so confidence stays low.
    expect(result.clusters[0].confidence).toBe("low");
    expect(result.clusters[0].reasons).not.toContain("exact_email_hash");
  });
});
