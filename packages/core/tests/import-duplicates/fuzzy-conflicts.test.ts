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

describe("detectDuplicateClusters — fuzzy conflicts", () => {
  beforeEach(() => {
    sequence = 0;
  });

  it("reports case-insensitive employee ids with high confidence and a distinct reason", () => {
    const records = [record({ employeeId: "emp-0042" }), record({ employeeId: "EMP-0042" })];
    const result = detectDuplicateClusters(records);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].confidence).toBe("high");
    expect(result.clusters[0].reasons).toEqual(["case_insensitive_employee_id"]);
  });

  it("reports case-insensitive wallet matches with high confidence", () => {
    const wallet = "gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const records = [
      record({ walletAddress: wallet }),
      record({ walletAddress: wallet.toUpperCase() }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters[0].confidence).toBe("high");
    expect(result.clusters[0].reasons).toEqual(["case_insensitive_wallet_address"]);
  });

  it("can promote normalized matches to exact confidence via option", () => {
    const records = [record({ employeeId: "emp-0042" }), record({ employeeId: " EMP-0042 " })];
    const strict = detectDuplicateClusters(records);
    expect(strict.clusters[0].confidence).toBe("high");

    const promoted = detectDuplicateClusters(records, { treatNormalizedAsExact: true });
    expect(promoted.clusters[0].confidence).toBe("exact");
  });

  it("flags similar names in the same department as medium confidence", () => {
    const records = [
      record({ name: "Jon Smith", department: "Sales" }),
      record({ name: "John Smyth", department: "Sales" }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].confidence).toBe("medium");
    expect(result.clusters[0].reasons).toEqual(["similar_name_same_department"]);
  });

  it("flags similar names with matching salary+asset as medium confidence", () => {
    const records = [
      record({ name: "Ann Lee", salary: 750n, asset: "XLM" }),
      record({ name: "Anne Lee", salary: 750n, asset: "XLM" }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters[0].confidence).toBe("medium");
    expect(result.clusters[0].reasons).toEqual(["similar_name_same_salary_asset"]);
  });

  it("combines department and salary+asset corroboration into high confidence", () => {
    const records = [
      record({ name: "Maria Garcia", salary: 900n, asset: "USDC" }),
      record({ name: "Maria Garcias", salary: 900n, asset: "USDC" }),
    ];
    const result = detectDuplicateClusters(records);

    expect(result.clusters[0].confidence).toBe("medium");
    // Department differs, so only the salary+asset corroboration applies.
    expect(result.clusters[0].reasons).toContain("similar_name_same_salary_asset");

    const corroborated = detectDuplicateClusters([
      { ...records[0], department: "Ops" },
      { ...records[1], department: "Ops" },
    ]);
    expect(corroborated.clusters[0].confidence).toBe("high");
    expect(corroborated.clusters[0].reasons).toEqual(["same_name_department_salary_asset"]);
  });

  it("keeps name-only similarity at low confidence so reviewers can spot false positives", () => {
    const records = [record({ name: "Alex Turner" }), record({ name: "Alexis Turner" })];
    const result = detectDuplicateClusters(records);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].confidence).toBe("low");
    expect(result.clusters[0].reasons).toEqual(["similar_name_only"]);
  });

  it("honours a custom fuzzy name threshold", () => {
    const records = [record({ name: "Alexander" }), record({ name: "Alejandro" })];

    // Edit distance 3 — beyond the default threshold of 2.
    expect(detectDuplicateClusters(records).hasDuplicates).toBe(false);

    const loose = detectDuplicateClusters(records, { fuzzyNameThreshold: 4 });
    expect(loose.hasDuplicates).toBe(true);
    expect(loose.clusters[0].reasons).toEqual(["similar_name_only"]);
  });

  it("does not treat near-identical names as exact duplicates (weak signal)", () => {
    // Two different people can share a name; without corroborating fields
    // the pair lands in a low-confidence cluster rather than an error.
    const records = [record({ name: "Chris Park" }), record({ name: "Chris Parks" })];
    const result = detectDuplicateClusters(records);
    expect(result.clusters[0].confidence).toBe("low");
  });
});
