import { PayrollRevisionGuard } from "../../src/revision/PayrollRevisionGuard";
import {
  RevisionAlreadyApprovedError,
  RevisionEditBlockedError,
  RevisionValidationError,
} from "../../src/revision/errors";
import { RevisionStatus } from "../../src/revision/types";
import { createDraft } from "../../src/draft/DraftSerializer";
import type { PayrollDraft } from "../../src/draft/types";

const seedDraft = (): PayrollDraft => {
  const draft = createDraft("September payroll");
  draft.entries.push({ recipientId: "GABC1234567890", amount: "1000", asset: "native" });
  return draft;
};

describe("PayrollRevisionGuard", () => {
  describe("draft state — freely editable", () => {
    it("starts in DRAFT status and accepts edits", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-1", seedDraft());

      expect(guard.getStatus()).toBe(RevisionStatus.DRAFT);
      expect(guard.isApproved).toBe(false);
      expect(guard.getVersion()).toBe(1);

      const updated = guard.edit((builder) =>
        builder.add({ recipientId: "GDEF0987654321", amount: "500", asset: "native" })
      );

      expect(updated.entries).toHaveLength(2);
      expect(guard.getVersion()).toBe(2);
    });

    it("allows multiple edits before approval", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-2", seedDraft());

      guard.edit((b) =>
        b.update(0, { recipientId: "GABC1234567890", amount: "2000", asset: "native" })
      );
      guard.replaceDraft(seedDraft());

      expect(guard.getVersion()).toBe(3);
      expect(guard.getDraft().entries[0].amount).toBe("1000");
    });

    it("returns defensive copies from getDraft()", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-3", seedDraft());
      const draft = guard.getDraft();
      (draft.entries[0] as { amount: string }).amount = "999999";

      expect(guard.getDraft().entries[0].amount).toBe("1000");
    });
  });

  describe("approve() — successful transition", () => {
    it("transitions to APPROVED and records approver + timestamp", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-4", seedDraft());
      const before = Date.now();

      const approval = guard.approve("GAPPROVER00000001");

      expect(guard.getStatus()).toBe(RevisionStatus.APPROVED);
      expect(guard.isApproved).toBe(true);
      expect(approval.approverId).toBe("GAPPROVER00000001");
      expect(approval.approvedAt).toBeGreaterThanOrEqual(before);
      expect(guard.getApproval()).toEqual(approval);
    });
  });

  describe("blocked edits on an approved revision", () => {
    it("rejects edit() once approved, naming the approver", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-5", seedDraft());
      guard.approve("GAPPROVER00000001");

      expect(() =>
        guard.edit((b) => b.add({ recipientId: "GNEW", amount: "10", asset: "native" }))
      ).toThrow(RevisionEditBlockedError);

      try {
        guard.edit((b) => b.add({ recipientId: "GNEW", amount: "10", asset: "native" }));
      } catch (e) {
        const err = e as RevisionEditBlockedError;
        expect(err.code).toBe("REVISION_APPROVED_EDIT_BLOCKED");
        expect(err.approvedBy).toBe("GAPPROVER00000001");
        expect(err.message).toContain("GAPPROVER00000001");
        expect(err.message).toContain("new revision");
      }
    });

    it("rejects replaceDraft() once approved", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-6", seedDraft());
      guard.approve("GAPPROVER00000001");

      expect(() => guard.replaceDraft(seedDraft())).toThrow(RevisionEditBlockedError);
    });
  });

  describe("invalid input", () => {
    it("throws RevisionValidationError for a missing payroll run ID", () => {
      expect(() => new PayrollRevisionGuard("", "REV-7", seedDraft())).toThrow(
        RevisionValidationError
      );
    });

    it("throws RevisionValidationError for a missing revision ID", () => {
      expect(() => new PayrollRevisionGuard("RUN-2026-09", "  ", seedDraft())).toThrow(
        RevisionValidationError
      );
    });

    it("throws RevisionValidationError when approving without an approver ID", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-8", seedDraft());
      expect(() => guard.approve("")).toThrow(RevisionValidationError);
      expect(guard.isApproved).toBe(false);
    });
  });

  describe("re-approval edge case", () => {
    it("rejects re-approval by default", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-9", seedDraft());
      guard.approve("GAPPROVER00000001");

      expect(() => guard.approve("GAPPROVER00000002")).toThrow(RevisionAlreadyApprovedError);
      // Original approval is preserved.
      expect(guard.getApproval()?.approverId).toBe("GAPPROVER00000001");
    });

    it("allows re-approval when explicitly requested", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-10", seedDraft());
      guard.approve("GAPPROVER00000001");

      const reApproval = guard.approve("GAPPROVER00000002", { allowReapproval: true });

      expect(reApproval.approverId).toBe("GAPPROVER00000002");
      expect(guard.getApproval()?.approverId).toBe("GAPPROVER00000002");
    });
  });

  describe("toSnapshot()", () => {
    it("reflects current status, version, and approval", () => {
      const guard = PayrollRevisionGuard.fromDraft("RUN-2026-09", "REV-11", seedDraft());
      guard.edit((b) => b.add({ recipientId: "GNEW", amount: "10", asset: "native" }));
      guard.approve("GAPPROVER00000001");

      const snapshot = guard.toSnapshot();
      expect(snapshot.status).toBe(RevisionStatus.APPROVED);
      expect(snapshot.version).toBe(2);
      expect(snapshot.draft.entries).toHaveLength(2);
      expect(snapshot.approval?.approverId).toBe("GAPPROVER00000001");
    });
  });
});
