import {
  detectDuplicateClusters,
  levenshteinDistance,
  namesAreSimilar,
  normalizeIdentifier,
} from "../../src/import";
import { buildRedactedPreview } from "../../src/import/previewRedaction";
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

describe("determinism", () => {
  beforeEach(() => {
    sequence = 0;
  });

  const records = [
    record({ employeeId: "DUP-A", name: "Jane Doe" }),
    record(),
    record({ employeeId: "DUP-A", name: "Jayne Doe", department: "Engineering" }),
    record(),
  ];

  it("produces identical output across repeated runs", () => {
    const runOne = detectDuplicateClusters(records);
    sequence = 0;
    const runTwo = detectDuplicateClusters(records);
    expect(JSON.stringify(runOne)).toBe(JSON.stringify(runTwo));
  });

  it("is order-stable when rows are shuffled (cluster membership follows the rows)", () => {
    const shuffled = [records[2], records[3], records[0], records[1]];
    const result = detectDuplicateClusters(shuffled);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].memberIndices).toEqual([0, 2]);
    expect(result.clusters[0].id).toBe("dup-001");
  });

  it("assigns stable sequential cluster ids in first-member order", () => {
    const sharedOne = "GDDDDDDDDDDDDDDDDDDDD";
    const batch = [
      record({ walletAddress: sharedOne }),
      record({ employeeId: "B-TWO", salary: 11n }),
      record({ walletAddress: sharedOne, name: "Frank Ocean", salary: 12n }),
      record({ employeeId: "B-TWO", salary: 13n }),
      record({ externalId: "X-ONE" }),
      record({ externalId: "X-ONE", name: "Ivy Chen", salary: 15n }),
    ];
    const result = detectDuplicateClusters(batch);
    // Cluster containing row 0 sorts first regardless of internal key ordering.
    expect(result.clusters.map((c) => c.id)).toEqual(["dup-001", "dup-002", "dup-003"]);
    expect(result.clusters.map((c) => c.memberIndices)).toEqual([
      [0, 2],
      [1, 3],
      [4, 5],
    ]);
  });
});

describe("redacted previews", () => {
  beforeEach(() => {
    sequence = 0;
  });

  it("never exposes full wallets, hashes, names, or salaries", () => {
    const result = detectDuplicateClusters([
      record({}),
      record({ employeeId: "EMP-ID-01", salary: 2_500_000n, name: "Roberta Banks" }),
    ]);

    const preview = result.clusters[0].previews[0];
    expect(preview.walletAddress).toMatch(/^\*+|\*+/);
    expect(preview.walletAddress).not.toBe(record({}).walletAddress);
    expect(preview.emailHash.startsWith("hash01")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("1000");
    expect(JSON.stringify(result)).not.toContain("GWALLETADDRESS");
    expect(JSON.stringify(result)).not.toContain("Person 01");
    expect(JSON.stringify(result)).not.toContain("HR-EXT-01");
    expect(preview.fieldsRedacted).toEqual(
      expect.arrayContaining(["employeeId", "walletAddress", "emailHash", "name", "salary"])
    );
  });

  it("keeps non-sensitive fields readable for review", () => {
    const source = record({ department: "Ops", asset: "XLM" });
    const preview = buildRedactedPreview(source, 3);
    expect(preview.department).toBe("Ops");
    expect(preview.asset).toBe("XLM");
    expect(preview.index).toBe(3);
    expect(preview.rowNumber).toBe(source.rowNumber);
  });

  it("aligns previews with member indices", () => {
    const records = [
      record({ employeeId: "SHARED-ID" }),
      record(),
      record({ employeeId: "shared-id", salary: 99n }),
    ];
    const result = detectDuplicateClusters(records);
    expect(result.clusters[0].previews.map((p) => p.index)).toEqual(
      result.clusters[0].memberIndices
    );
  });

  it("supports a custom redaction placeholder for short email hashes", () => {
    const preview = buildRedactedPreview(record({ emailHash: "abc123" }), 0, "***hidden***");
    expect(preview.emailHash).toBe("***hidden***");
  });
});

describe("fuzzy matching helpers", () => {
  it("normalizes identifiers by trimming and lowercasing", () => {
    expect(normalizeIdentifier("  EMP-0042 ")).toBe("emp-0042");
    expect(normalizeIdentifier("A  B")).toBe("a b");
    expect(normalizeIdentifier("   ")).toBeNull();
    expect(normalizeIdentifier(undefined)).toBeNull();
  });

  it("computes Levenshtein distance correctly", () => {
    expect(levenshteinDistance("", "")).toBe(0);
    expect(levenshteinDistance("abc", "abc")).toBe(0);
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("flaw", "lawn")).toBe(2);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });

  it("detects similar names including containment", () => {
    expect(namesAreSimilar("John Smyth", "Jon Smith", 2)).toBe(true);
    expect(namesAreSimilar("Bob", "Bobby", 2)).toBe(true);
    expect(namesAreSimilar("Completely Different", "Other Name", 2)).toBe(false);
    expect(namesAreSimilar(undefined, "Someone", 2)).toBe(false);
  });
});
