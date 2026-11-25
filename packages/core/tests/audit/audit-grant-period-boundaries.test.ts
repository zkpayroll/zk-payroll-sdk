/**
 * Tests for audit grant adjacent period boundary validation (#832).
 *
 * Covers:
 *  - success: chronologically adjacent, non-overlapping grant periods
 *  - rejection: overlapping periods and invalid boundaries
 *  - boundary: an exact shared boundary is valid; a one-millisecond gap is not
 */

import {
  assertValidAuditGrantPeriodBoundaries,
  AuditGrantPeriodBoundaryError,
  AuditGrantPeriodBoundaryErrorCode,
  validateAuditGrantPeriodBoundaries,
  type AuditGrantPeriodBoundary,
} from "../../src/api/auditGrantPeriodBoundaries";

const GRANTEE = "GAUDITOR00000000000000000000000000000000000000000000";

function grant(periodStart: string, periodEnd: string): AuditGrantPeriodBoundary {
  return { grantee: GRANTEE, periodStart, periodEnd };
}

describe("audit grant period boundaries (#832)", () => {
  it("accepts adjacent periods regardless of input order", () => {
    const result = validateAuditGrantPeriodBoundaries([
      grant("2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    ]);

    expect(result.isValid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.orderedPositions).toEqual([1, 0]);
  });

  it("rejects overlapping periods with the involved positions", () => {
    const result = validateAuditGrantPeriodBoundaries([
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      grant("2026-01-31T23:59:59.999Z", "2026-03-01T00:00:00.000Z"),
    ]);

    expect(result.isValid).toBe(false);
    const overlap = result.issues.find(
      (issue) => issue.code === AuditGrantPeriodBoundaryErrorCode.OVERLAPPING_PERIODS
    );
    expect(overlap).toBeDefined();
    expect(overlap?.grantPositions).toEqual([0, 1]);
    expect(overlap?.message).not.toContain(GRANTEE);
  });

  it("rejects periods that are not adjacent by default", () => {
    const result = validateAuditGrantPeriodBoundaries([
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      grant("2026-02-01T00:00:00.001Z", "2026-03-01T00:00:00.000Z"),
    ]);

    expect(result.isValid).toBe(false);
    expect(result.issues[0]?.code).toBe(
      AuditGrantPeriodBoundaryErrorCode.NON_ADJACENT_PERIODS
    );
  });

  it("boundary: an exact shared boundary is valid, one millisecond later is a gap", () => {
    const adjacent = validateAuditGrantPeriodBoundaries([
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      grant("2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
    ]);
    expect(adjacent.isValid).toBe(true);

    const gap = validateAuditGrantPeriodBoundaries([
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      grant("2026-02-01T00:00:00.001Z", "2026-03-01T00:00:00.000Z"),
    ]);
    expect(gap.isValid).toBe(false);
  });

  it("allows gaps only when explicitly opted in", () => {
    const result = validateAuditGrantPeriodBoundaries(
      [
        grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
        grant("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"),
      ],
      { allowGaps: true }
    );

    expect(result.isValid).toBe(true);
  });

  it("rejects inverted and unparseable period boundaries without leaking the grantee", () => {
    const result = validateAuditGrantPeriodBoundaries([
      grant("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      { grantee: GRANTEE, periodStart: "not-a-date", periodEnd: "2026-03-01T00:00:00.000Z" },
    ]);

    expect(result.isValid).toBe(false);
    expect(result.issues).toHaveLength(2);
    for (const issue of result.issues) {
      expect(issue.code).toBe(AuditGrantPeriodBoundaryErrorCode.INVALID_PERIOD);
      expect(issue.message).not.toContain(GRANTEE);
      expect(issue.redactedGrantee).not.toBe(GRANTEE);
    }
  });

  it("reports identical periods as duplicates", () => {
    const result = validateAuditGrantPeriodBoundaries([
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    ]);

    expect(result.issues[0]?.code).toBe(AuditGrantPeriodBoundaryErrorCode.DUPLICATE_PERIOD);
  });

  it("assert helper throws a typed error and returns chronological grants when valid", () => {
    const grants = [
      grant("2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
      grant("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    ];

    expect(assertValidAuditGrantPeriodBoundaries(grants)).toEqual([grants[1], grants[0]]);

    expect(() =>
      assertValidAuditGrantPeriodBoundaries([
        grant("2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
        grant("2026-02-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"),
      ])
    ).toThrow(AuditGrantPeriodBoundaryError);
  });
});
