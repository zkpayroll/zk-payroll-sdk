import {
  REVIEW_DECISION_OUTCOMES,
  ReviewDecisionIncompleteError,
  assertReviewDecisionCompleteness,
  validateReviewDecisionCompleteness,
  type ReviewDecisionOutcome,
  type ReviewDecisionRecord,
  type ReviewDecisionRequirements,
} from "../../src/payroll/reviewDecisionCompleteness";

describe("Payroll Review Decision Completeness Validation (#711)", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const HOUR = 60 * 60 * 1000;

  const approve = (
    reviewerId: string,
    overrides: Partial<ReviewDecisionRecord> = {}
  ): ReviewDecisionRecord => ({
    reviewerId,
    decision: "approve",
    decidedAt: NOW - HOUR,
    ...overrides,
  });

  describe("successful path", () => {
    it("reports a complete review when every required reviewer approved", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice"), approve("bob")],
        { requiredReviewers: ["alice", "bob"] },
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.outcome).toBe("approved");
      expect(result.validDecisions).toBe(2);
      expect(result.distinctReviewers).toEqual(["alice", "bob"]);
      expect(result.issues).toEqual([]);
      expect(result.missingReviewers).toEqual([]);
      expect(result.reason).toContain("complete");
    });

    it("counts abstentions as coverage without blocking an approval", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice"), { reviewerId: "bob", decision: "abstain", decidedAt: NOW - HOUR }],
        { requiredReviewers: ["alice", "bob"] },
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.outcome).toBe("approved");
    });

    it("accepts ISO strings, epoch ms, and Date timestamps", () => {
      const result = validateReviewDecisionCompleteness(
        [
          approve("alice", { decidedAt: new Date(NOW - HOUR) }),
          approve("bob", { decidedAt: NOW - HOUR }),
          approve("carol", { decidedAt: new Date(NOW - HOUR).toISOString() }),
        ],
        { minDecisions: 3 },
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.validDecisions).toBe(3);
    });

    it("satisfies a required role from any reviewer holding it", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice", { role: "compliance_reviewer" })],
        { requiredRoles: ["COMPLIANCE_REVIEWER"] },
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.missingRoles).toEqual([]);
    });
  });

  describe("failure path", () => {
    it("flags a required reviewer that has not responded", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice")],
        { requiredReviewers: ["alice", "bob"] },
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.outcome).toBe("incomplete");
      expect(result.missingReviewers).toEqual(["bob"]);
      expect(result.issues.map((issue) => issue.code)).toContain("MISSING_REVIEWER");
      expect(result.issues[0].message).toContain("bob");
      expect(result.reason).toContain("incomplete");
    });

    it("requires a written reason for a rejection", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice"), { reviewerId: "bob", decision: "reject", decidedAt: NOW - HOUR }],
        { requiredReviewers: ["alice", "bob"] },
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("REASON_REQUIRED");
      expect(result.issues.find((issue) => issue.code === "REASON_REQUIRED")?.reviewerId).toBe(
        "bob"
      );
    });

    it("requires a written reason when changes are requested", () => {
      const result = validateReviewDecisionCompleteness(
        [{ reviewerId: "alice", decision: "request_changes", decidedAt: NOW - HOUR }],
        {},
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "REASON_REQUIRED",
        "MIN_DECISIONS_NOT_MET",
      ]);
    });

    it("accepts a reasoned rejection and resolves the review as rejected", () => {
      const result = validateReviewDecisionCompleteness(
        [
          approve("alice"),
          {
            reviewerId: "bob",
            decision: "reject",
            decidedAt: NOW - HOUR,
            reason: "Salary changed after the reviewer's last lookup",
          },
        ],
        { requiredReviewers: ["alice", "bob"] },
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.outcome).toBe("rejected");
    });

    it("ranks changes_requested below a rejection", () => {
      const result = validateReviewDecisionCompleteness(
        [
          {
            reviewerId: "alice",
            decision: "request_changes",
            decidedAt: NOW - HOUR,
            reason: "Update the destination memo",
          },
          {
            reviewerId: "bob",
            decision: "reject",
            decidedAt: NOW - HOUR,
            reason: "Employee was deactivated",
          },
        ],
        {},
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.outcome).toBe("rejected");
    });

    it("throws ReviewDecisionIncompleteError with every issue attached", () => {
      expect(() =>
        assertReviewDecisionCompleteness([approve("alice")], { requiredReviewers: ["bob"] }, NOW)
      ).toThrow(ReviewDecisionIncompleteError);

      try {
        assertReviewDecisionCompleteness([approve("alice")], { requiredReviewers: ["bob"] }, NOW);
        fail("expected ReviewDecisionIncompleteError");
      } catch (error) {
        expect(error).toBeInstanceOf(ReviewDecisionIncompleteError);
        const typed = error as ReviewDecisionIncompleteError;
        expect(typed.name).toBe("ReviewDecisionIncompleteError");
        expect(typed.message).toContain("incomplete");
        expect(typed.issues.map((issue) => issue.code)).toContain("MISSING_REVIEWER");
      }
    });

    it("returns the result from the assert helper when the review is complete", () => {
      const result = assertReviewDecisionCompleteness(
        [approve("alice")],
        { requiredReviewers: ["alice"] },
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.outcome).toBe("approved");
    });
  });

  describe("edge cases", () => {
    it("treats an empty decision set as incomplete", () => {
      const result = validateReviewDecisionCompleteness([], {}, NOW);

      expect(result.isComplete).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual(["EMPTY_DECISION_SET"]);
      expect(result.validDecisions).toBe(0);
    });

    it("counts only the first decision from a duplicate reviewer, case-insensitively", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice"), approve("Alice", { decision: "reject", reason: "changed my mind" })],
        { requiredReviewers: ["alice"] },
        NOW
      );

      expect(result.validDecisions).toBe(1);
      expect(result.distinctReviewers).toEqual(["alice"]);
      expect(result.issues.map((issue) => issue.code)).toEqual(["DUPLICATE_REVIEWER"]);
    });

    it("rejects decisions timestamped in the future", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice", { decidedAt: NOW + 1 })],
        {},
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "DECISION_OUT_OF_WINDOW",
        "MIN_DECISIONS_NOT_MET",
      ]);
    });

    it("rejects stale decisions recorded before the review opened", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice", { decidedAt: NOW - HOUR })],
        { reviewOpenedAtMs: NOW - HOUR / 2 },
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "DECISION_OUT_OF_WINDOW",
        "MIN_DECISIONS_NOT_MET",
      ]);
      expect(result.issues[0].message).toContain("predates");
    });

    it("rejects unrecognized outcomes and missing reviewer ids", () => {
      const result = validateReviewDecisionCompleteness(
        [
          approve("alice", { decision: "maybe" as ReviewDecisionOutcome }),
          { reviewerId: "   ", decision: "approve", decidedAt: NOW - HOUR },
        ],
        {},
        NOW
      );

      expect(result.isComplete).toBe(false);
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toContain("INVALID_DECISION");
      expect(codes).toContain("INVALID_REVIEWER");
      expect(result.validDecisions).toBe(0);
    });

    it("rejects unparseable decision timestamps", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice", { decidedAt: "not-a-date" })],
        {},
        NOW
      );

      expect(result.issues.map((issue) => issue.code)).toEqual([
        "INVALID_TIMESTAMP",
        "MIN_DECISIONS_NOT_MET",
      ]);
    });

    it("blocks the author from reviewing their own payroll when self-review is disabled", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice")],
        { allowSelfReview: false, authorId: "Alice" },
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "SELF_REVIEW_NOT_PERMITTED",
        "MIN_DECISIONS_NOT_MET",
      ]);
    });

    it("allows self-review when it is not explicitly disabled", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice")],
        { authorId: "alice" },
        NOW
      );

      expect(result.isComplete).toBe(true);
    });

    it("reports a required role with no responding reviewer", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice", { role: "finance" })],
        { requiredRoles: ["compliance_reviewer"] },
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.missingRoles).toEqual(["compliance_reviewer"]);
      expect(result.issues.map((issue) => issue.code)).toContain("MISSING_ROLE");
    });

    it("enforces the minimum number of valid decisions", () => {
      const result = validateReviewDecisionCompleteness(
        [approve("alice"), approve("bob", { decidedAt: "garbage" })],
        { minDecisions: 2 },
        NOW
      );

      expect(result.isComplete).toBe(false);
      expect(result.validDecisions).toBe(1);
      expect(result.issues.map((issue) => issue.code)).toContain("MIN_DECISIONS_NOT_MET");
      expect(result.issues.map((issue) => issue.code)).toContain("INVALID_TIMESTAMP");
    });

    it("resolves a fully abstained review as abstained", () => {
      const result = validateReviewDecisionCompleteness(
        [
          { reviewerId: "alice", decision: "abstain", decidedAt: NOW - HOUR },
          { reviewerId: "bob", decision: "abstain", decidedAt: NOW - HOUR },
        ],
        {},
        NOW
      );

      expect(result.isComplete).toBe(true);
      expect(result.outcome).toBe("abstained");
    });

    it("exposes the recognized outcomes and rejects invalid inputs", () => {
      expect(REVIEW_DECISION_OUTCOMES).toEqual(["approve", "reject", "abstain", "request_changes"]);
      expect(() => validateReviewDecisionCompleteness(undefined as never, {}, NOW)).toThrow(
        TypeError
      );

      const requirements: ReviewDecisionRequirements = { minDecisions: 0 };
      expect(() => validateReviewDecisionCompleteness([], requirements, NOW)).toThrow(TypeError);
    });
  });
});
