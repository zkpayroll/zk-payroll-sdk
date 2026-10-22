import {
  APPROVED_PAYROLL_REVISION_STATUSES,
  assertLatestApprovedRevision,
  LatestApprovedRevisionError,
  readLatestApprovedRevision,
} from "../src/payroll/latestApprovedRevisionReader";
import type { PayrollRevisionRecordInput } from "../src/payroll/latestApprovedRevisionReader";

const SECRET_AMOUNT = "987654321";
const SECRET_RECIPIENT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SECRET_EMPLOYEE = "emp-confidential-42";

describe("readLatestApprovedRevision — success", () => {
  it("returns the highest approved revision regardless of input order", () => {
    const result = readLatestApprovedRevision([
      { revision: 4, status: "draft" },
      {
        revision: 1,
        status: "approved",
        approvedAt: "2026-01-01T00:00:00.000Z",
        approvedBy: "GADMINALICE",
      },
      {
        revision: 3,
        status: "authorized",
        approvedAt: 1_700_000_000_000,
        approvedBy: "operator-bob",
        effectiveAt: "2026-02-01T00:00:00.000Z",
      },
      { revision: 2, status: "rejected" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.revision.revision).toBe(3);
    expect(result.revision.status).toBe("approved");
    expect(result.revision.approvedAt).toBe(1_700_000_000_000);
    expect(result.revision.approvedBy).toBe("operator-bob");
    expect(result.revision.redactedApprovedBy).toBe("ope***bob");
    expect(result.revision.effectiveAt).toBe(Date.parse("2026-02-01T00:00:00.000Z"));
    expect(result.totalRevisions).toBe(4);
    expect(result.approvedRevisionCount).toBe(2);
    expect(result.latestRevisionOverall).toBe(4);
    expect(result.newerUnapprovedRevisions).toEqual([4]);
    expect(result.summary).toContain("Latest approved revision is 3");
  });

  it("accepts a single approved revision without approval metadata", () => {
    const result = readLatestApprovedRevision([
      { revision: 1, status: "applied", contentDigest: "a".repeat(64) },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.revision.revision).toBe(1);
    expect(result.revision.status).toBe("applied");
    expect(result.revision.approvedAt).toBeUndefined();
    expect(result.revision.contentDigest).toBe("a".repeat(64));
    expect(result.newerUnapprovedRevisions).toEqual([]);
    expect(result.summary).not.toContain("newer unapproved");
  });

  it("handles the maximum safe revision number (boundary)", () => {
    const result = readLatestApprovedRevision([
      { revision: Number.MAX_SAFE_INTEGER, status: "approved" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.revision.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.latestRevisionOverall).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("supports approved metadata when explicitly required", () => {
    const result = readLatestApprovedRevision(
      [
        {
          revision: 2,
          status: "approved",
          approvedAt: 1_700_000_000_000,
          approvedBy: "operator",
        },
      ],
      { requireApprovalMetadata: true }
    );

    expect(result.ok).toBe(true);
  });
});

describe("readLatestApprovedRevision — rejection", () => {
  it("rejects a list with no approved revision", () => {
    const result = readLatestApprovedRevision([
      { revision: 1, status: "draft" },
      { revision: 2, status: "rejected" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("NO_APPROVED_REVISION");
    expect(result.suggestedAction).toContain("Approve a revision");
    expect(result.latestRevisionOverall).toBe(2);
  });

  it("rejects duplicate revision numbers as ambiguous", () => {
    const result = readLatestApprovedRevision([
      { revision: 2, status: "approved" },
      { revision: 2, status: "draft" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("DUPLICATE_REVISION");
    expect(result.issues[0].revision).toBe(2);
  });

  it("rejects zero and non-integer revision numbers", () => {
    for (const revision of [0, -1, 1.5, "not-a-number"]) {
      const result = readLatestApprovedRevision([{ revision, status: "approved" }]);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_REVISION");
    }
  });

  it("rejects an unrecognized revision status", () => {
    const result = readLatestApprovedRevision([{ revision: 1, status: "almost-approved" }]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("INVALID_REVISION_STATUS");
  });

  it("rejects an invalid timestamp instead of silently dropping it", () => {
    const result = readLatestApprovedRevision([
      { revision: 1, status: "approved", approvedAt: "not-a-date" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("INVALID_TIMESTAMP");
    expect(result.issues[0].field).toBe("revisions[0].approvedAt");
  });

  it("rejects missing approval metadata when required", () => {
    const result = readLatestApprovedRevision([{ revision: 1, status: "approved" }], {
      requireApprovalMetadata: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("MISSING_APPROVAL_METADATA");
    expect(result.issues.some((issue) => issue.field === "revisions[0].approvedAt")).toBe(true);
  });

  it("rejects a newer unapproved revision in strict mode", () => {
    const result = readLatestApprovedRevision(
      [
        { revision: 1, status: "approved" },
        { revision: 2, status: "pending_approval" },
      ],
      { requireLatestRevisionApproved: true }
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("NEWER_REVISION_NOT_APPROVED");
    expect(result.latestRevisionOverall).toBe(2);
  });

  it("rejects non-array input and malformed records", () => {
    const nonArray = readLatestApprovedRevision(
      null as unknown as readonly PayrollRevisionRecordInput[]
    );
    expect(nonArray.ok).toBe(false);
    if (!nonArray.ok) expect(nonArray.code).toBe("INVALID_REVISION_LIST");

    const malformed = readLatestApprovedRevision([null as unknown as PayrollRevisionRecordInput]);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe("INVALID_REVISION_RECORD");
  });

  it("throws a typed error through the assertion helper", () => {
    expect(() => assertLatestApprovedRevision([{ revision: 1, status: "draft" }])).toThrow(
      LatestApprovedRevisionError
    );

    try {
      assertLatestApprovedRevision([{ revision: 1, status: "draft" }]);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LatestApprovedRevisionError);
      expect((error as LatestApprovedRevisionError).code).toBe("NO_APPROVED_REVISION");
    }
  });
});

describe("latest approved revision privacy", () => {
  it("ignores and never exposes salary, recipient, or employee fields", () => {
    const records = [
      {
        revision: 1,
        status: "approved",
        approvedAt: 1_700_000_000_000,
        approvedBy: "operator",
        amount: BigInt(SECRET_AMOUNT),
        recipient: SECRET_RECIPIENT,
        employeeId: SECRET_EMPLOYEE,
        note: "private salary note",
      },
    ] as unknown as PayrollRevisionRecordInput[];

    const success = readLatestApprovedRevision(records);
    expect(success.ok).toBe(true);

    const failure = readLatestApprovedRevision([
      {
        revision: 0,
        status: "approved",
        amount: BigInt(SECRET_AMOUNT),
        recipient: SECRET_RECIPIENT,
        employeeId: SECRET_EMPLOYEE,
      },
    ] as unknown as PayrollRevisionRecordInput[]);

    const errorMessage = (() => {
      try {
        assertLatestApprovedRevision(records.concat([{ revision: 1, status: "approved" }]));
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();

    for (const output of [JSON.stringify(success), JSON.stringify(failure), errorMessage]) {
      expect(output).not.toContain(SECRET_AMOUNT);
      expect(output).not.toContain(SECRET_RECIPIENT);
      expect(output).not.toContain(SECRET_EMPLOYEE);
      expect(output).not.toContain("private salary note");
    }
  });

  it("documents the approved statuses exposed to consumers", () => {
    expect(APPROVED_PAYROLL_REVISION_STATUSES).toEqual(["approved", "applied"]);
  });
});
