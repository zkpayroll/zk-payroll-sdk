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

describe("detectDuplicateClusters — exact duplicates", () => {
  beforeEach(() => {
    sequence = 0;
  });

  it("returns no clusters for an empty batch", () => {
    const result = detectDuplicateClusters([]);
    expect(result.hasDuplicates).toBe(false);
    expect(result.clusters).toHaveLength(0);
    expect(result.totalRecords).toBe(0);
    expect(result.duplicateRowCount).toBe(0);
  });

  it("clusters two rows sharing an exact employee id", () => {
    const records = [
      record({ employeeId: "EMP-SHARED" }),
      record(),
      record({ employeeId: "EMP-SHARED", name: "Alicia Smith", salary: 5_000_000n }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.hasDuplicates).toBe(true);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].memberIndices).toEqual([0, 2]);
    expect(result.clusters[0].confidence).toBe("exact");
    expect(result.clusters[0].reasons).toEqual(["exact_employee_id"]);
    expect(result.duplicateRowCount).toBe(2);
  });

  it("clusters rows sharing an exact wallet address even with different ids", () => {
    const sharedWallet = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const records = [
      record({ walletAddress: sharedWallet }),
      record(),
      record({ walletAddress: sharedWallet, name: "Bob Jones", salary: 42n }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters[0].memberIndices).toEqual([0, 2]);
    expect(result.clusters[0].confidence).toBe("exact");
    expect(result.clusters[0].reasons).toContain("exact_wallet_address");
  });

  it("clusters rows sharing an exact email hash", () => {
    const hash = "deadbeefdeadbeef01";
    const records = [
      record({ emailHash: hash }),
      record(),
      record({ emailHash: hash, name: "Carol White", salary: 7n }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters[0].memberIndices).toEqual([0, 2]);
    expect(result.clusters[0].reasons).toContain("exact_email_hash");
  });

  it("clusters rows sharing an exact external id", () => {
    const records = [
      record({ externalId: "EXT-777" }),
      record(),
      record({ externalId: "EXT-777", name: "Dan Brown", salary: 9n }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters[0].memberIndices).toEqual([0, 2]);
    expect(result.clusters[0].reasons).toContain("exact_external_id");
  });

  it("merges transitively related rows into one cluster (union-find)", () => {
    const bridgeWallet = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    const records = [
      record({ employeeId: "EMP-BRIDGE" }),
      record({ employeeId: "EMP-BRIDGE", walletAddress: bridgeWallet }),
      record({ walletAddress: bridgeWallet, name: "Eve Adams", salary: 3n }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters).toHaveLength(1);
    // Row 0 links to row 1 via employee id; row 1 links to row 2 via wallet.
    expect(result.clusters[0].memberIndices).toEqual([0, 1, 2]);
    expect(result.duplicateRowCount).toBe(3);
  });

  it("reports multiple independent clusters in first-member order", () => {
    const sharedOne = "GDDDDDDDDDDDDDDDDDDDD";
    const records = [
      record({ employeeId: "DUP-ONE" }),
      record(),
      record({ employeeId: "DUP-ONE", salary: 55n }),
      record(),
      record({ walletAddress: sharedOne }),
      record({ walletAddress: sharedOne, name: "Frank Ocean", salary: 77n }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.map((c) => c.memberIndices)).toEqual([
      [0, 2],
      [4, 5],
    ]);
    expect(result.clusters.map((c) => c.id)).toEqual(["dup-001", "dup-002"]);
    expect(result.duplicateRowCount).toBe(4);
  });

  it("ignores empty and missing identity fields", () => {
    const records = [
      record({
        employeeId: "EMP-SAME",
        walletAddress: "",
        emailHash: "",
        externalId: "",
      }),
      record({
        employeeId: "EMP-SAME",
        walletAddress: "",
        emailHash: "",
        externalId: "",
        name: "Zoe Blank",
      }),
    ];
    // Only one identity signal (employee id), still detected.
    const sameId = detectDuplicateClusters(records);
    expect(sameId.hasDuplicates).toBe(true);

    const differentIds = detectDuplicateClusters([
      { ...records[0], employeeId: "EMP-Q1" },
      { ...records[1], employeeId: "EMP-Q2" },
    ]);
    expect(differentIds.hasDuplicates).toBe(false);
  });
});
