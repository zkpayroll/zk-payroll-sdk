import {
  evaluateArchiveEligibility,
  isRunEligibleForArchive,
  getArchiveEligibilityBadge,
  redactRunId,
} from "../src/archive";

describe("Archive Eligibility Helper", () => {
  describe("redactRunId", () => {
    it("redacts run IDs for audit reports and logs", () => {
      expect(redactRunId("run_2025_03_abc12345")).toBe("run***345");
      expect(redactRunId("short")).toBe("[REDACTED_RUN]");
      expect(redactRunId("")).toBe("[ANONYMOUS_RUN]");
      expect(redactRunId(undefined)).toBe("[ANONYMOUS_RUN]");
    });
  });

  describe("evaluateArchiveEligibility — ready state", () => {
    it("evaluates finalized run as ready to archive", () => {
      const res = evaluateArchiveEligibility({
        runId: "run_payroll_2025_01",
        status: "finalized",
      });

      expect(res.state).toBe("ready");
      expect(res.isEligible).toBe(true);
      expect(res.blockerCode).toBeUndefined();
      expect(res.reason).toContain("ready to be archived");
    });

    it("evaluates completed run as ready to archive", () => {
      const res = evaluateArchiveEligibility({
        id: "run_payroll_completed_02",
        status: "completed",
      });

      expect(res.state).toBe("ready");
      expect(res.isEligible).toBe(true);
    });
  });

  describe("evaluateArchiveEligibility — blocked states", () => {
    it("blocks disputed runs with DISPUTED_RUN code", () => {
      const resDisputedFlag = evaluateArchiveEligibility({
        runId: "run_disputed_01",
        status: "finalized",
        isDisputed: true,
      });
      expect(resDisputedFlag.state).toBe("blocked");
      expect(resDisputedFlag.isEligible).toBe(false);
      expect(resDisputedFlag.blockerCode).toBe("DISPUTED_RUN");
      expect(resDisputedFlag.suggestedFix).toContain("Resolve all active");

      const resDisputedStatus = evaluateArchiveEligibility({
        runId: "run_disputed_02",
        status: "disputed",
      });
      expect(resDisputedStatus.blockerCode).toBe("DISPUTED_RUN");
    });

    it("blocks held runs with HELD_RUN code", () => {
      const resHeldFlag = evaluateArchiveEligibility({
        runId: "run_held_01",
        status: "finalized",
        isHeld: true,
      });
      expect(resHeldFlag.state).toBe("blocked");
      expect(resHeldFlag.blockerCode).toBe("HELD_RUN");
      expect(resHeldFlag.suggestedFix).toContain("Release active compliance holds");

      const resHeldStatus = evaluateArchiveEligibility({
        runId: "run_held_02",
        status: "held",
      });
      expect(resHeldStatus.blockerCode).toBe("HELD_RUN");
    });

    it("blocks runs with incomplete lifecycle status with INCOMPLETE_STATUS code", () => {
      const resDraft = evaluateArchiveEligibility({
        runId: "run_draft_01",
        status: "draft",
      });
      expect(resDraft.state).toBe("blocked");
      expect(resDraft.blockerCode).toBe("INCOMPLETE_STATUS");
      expect(resDraft.reason).toContain("must be 'finalized' or 'completed'");

      const resActive = evaluateArchiveEligibility({
        runId: "run_active_01",
        status: "active",
      });
      expect(resActive.blockerCode).toBe("INCOMPLETE_STATUS");
    });

    it("blocks runs that are already archived with ALREADY_ARCHIVED code", () => {
      const res = evaluateArchiveEligibility({
        runId: "run_archived_01",
        status: "archived",
      });
      expect(res.state).toBe("blocked");
      expect(res.blockerCode).toBe("ALREADY_ARCHIVED");
      expect(res.reason).toContain("already been archived");
    });

    it("blocks runs missing runId or id with MISSING_RUN_ID code", () => {
      const res = evaluateArchiveEligibility({
        status: "finalized",
      });
      expect(res.state).toBe("blocked");
      expect(res.blockerCode).toBe("MISSING_RUN_ID");
    });
  });

  describe("isRunEligibleForArchive & getArchiveEligibilityBadge", () => {
    it("returns boolean eligibility correctly", () => {
      expect(isRunEligibleForArchive({ runId: "r1", status: "finalized" })).toBe(true);
      expect(isRunEligibleForArchive({ runId: "r2", status: "draft" })).toBe(false);
      expect(isRunEligibleForArchive({ runId: "r3", status: "finalized", isDisputed: true })).toBe(
        false
      );
    });

    it("returns correct UI badge descriptor", () => {
      const readyEval = evaluateArchiveEligibility({ runId: "r1", status: "finalized" });
      expect(getArchiveEligibilityBadge(readyEval)).toEqual({
        label: "Ready to Archive",
        variant: "ready",
      });

      const blockedEval = evaluateArchiveEligibility({ runId: "r2", status: "disputed" });
      expect(getArchiveEligibilityBadge(blockedEval)).toEqual({
        label: "Archive Blocked",
        variant: "blocked",
      });

      const archivedEval = evaluateArchiveEligibility({ runId: "r3", status: "archived" });
      expect(getArchiveEligibilityBadge(archivedEval)).toEqual({
        label: "Archived",
        variant: "archived",
      });
    });
  });
});
