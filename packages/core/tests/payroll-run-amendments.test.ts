import {
  createPayrollRunAmendment,
  inspectPayrollRunAmendment,
  validatePayrollRunAmendment,
  authorizePayrollRunAmendment,
  PayrollRunCommitment,
  CreatePayrollRunAmendmentInput,
} from "../src/amendments/runAmendment";

describe("Payroll Run Amendments Helper (#506)", () => {
  const AUTHORIZER = "GD6W57ZD55776SGYO5UXI5CYF334XCO45Z5L6ZOHU5X3L7UXE33B76EA";
  const BASE_COMMITMENTS: PayrollRunCommitment[] = [
    { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5000n, asset: "USDC" },
    { recipient: "G_BOB_ADDR_22222222222222222222222222222222222222222222222", amount: 4000n, asset: "USDC" },
    { recipient: "G_CHARLIE_ADDR_3333333333333333333333333333333333333333333", amount: 3500n, asset: "XLM" },
  ];

  describe("createPayrollRunAmendment", () => {
    it("creates a canonical amendment record with calculated diffs and inspection summary", () => {
      const proposedCommitments: PayrollRunCommitment[] = [
        // Alice: modified amount
        { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5500n, asset: "USDC" },
        // Bob: unchanged
        { recipient: "G_BOB_ADDR_22222222222222222222222222222222222222222222222", amount: 4000n, asset: "USDC" },
        // Charlie: removed
        // David: added
        { recipient: "G_DAVID_ADDR_444444444444444444444444444444444444444444444", amount: 2000n, asset: "USDC" },
      ];

      const input: CreatePayrollRunAmendmentInput = {
        payrollId: "pay-2026-09-run",
        revision: 2,
        authorizer: AUTHORIZER,
        reason: "retroactive_adjustment",
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments,
      };

      const amendment = createPayrollRunAmendment(input, { now: 1700000000000 });

      expect(amendment.id).toContain("amend-pay-2026-09-run-2");
      expect(amendment.payrollId).toBe("pay-2026-09-run");
      expect(amendment.revision).toBe(2);
      expect(amendment.authorizer).toBe(AUTHORIZER);
      expect(amendment.redactedAuthorizer).toBe("GD6...6EA");
      expect(amendment.reason).toBe("retroactive_adjustment");
      expect(amendment.status).toBe("pending_authorization");
      expect(amendment.createdAt).toBe(1700000000000);

      // Diff checks
      expect(amendment.diffs).toHaveLength(3);
      expect(amendment.summary.totalDiffs).toBe(3);
      expect(amendment.summary.addedCount).toBe(1);
      expect(amendment.summary.modifiedCount).toBe(1);
      expect(amendment.summary.removedCount).toBe(1);
      expect(amendment.summary.affectedAssets).toEqual(["USDC", "XLM"]);
      expect(amendment.summary.approvalRequired).toBe(true);
      expect(amendment.summary.redactedDescription).toContain("Amendment (rev 2) for payroll");
      expect(amendment.summary.redactedDescription).not.toContain("5500");
    });

    it("rejects empty or whitespace-only payroll IDs", () => {
      expect(() =>
        createPayrollRunAmendment({
          payrollId: "   ",
          revision: 1,
          authorizer: AUTHORIZER,
          currentCommitments: BASE_COMMITMENTS,
          proposedCommitments: [],
        })
      ).toThrow("Invalid payroll identifier provided for amendment.");
    });

    it("rejects invalid revision numbers", () => {
      expect(() =>
        createPayrollRunAmendment({
          payrollId: "pay-1",
          revision: 0,
          authorizer: AUTHORIZER,
          currentCommitments: BASE_COMMITMENTS,
          proposedCommitments: [],
        })
      ).toThrow("Amendment revision must be a positive integer.");
    });

    it("rejects free-text reasons that might contain unredacted PII or salary values", () => {
      expect(() =>
        createPayrollRunAmendment({
          payrollId: "pay-1",
          revision: 1,
          authorizer: AUTHORIZER,
          reason: "Paying extra $500 bonus to Alice Smith",
          currentCommitments: BASE_COMMITMENTS,
          proposedCommitments: [],
        })
      ).toThrow("Amendment reason must be a lowercase operational code without free-text details.");
    });

    it("rejects identical commitment sets when allowZeroDiff is false", () => {
      expect(() =>
        createPayrollRunAmendment({
          payrollId: "pay-1",
          revision: 1,
          authorizer: AUTHORIZER,
          currentCommitments: BASE_COMMITMENTS,
          proposedCommitments: BASE_COMMITMENTS,
        })
      ).toThrow("No commitment differences detected between current and proposed payroll runs.");
    });

    it("allows identical commitment sets when allowZeroDiff is true", () => {
      const amendment = createPayrollRunAmendment({
        payrollId: "pay-1",
        revision: 1,
        authorizer: AUTHORIZER,
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments: BASE_COMMITMENTS,
        allowZeroDiff: true,
      });

      expect(amendment.diffs).toHaveLength(0);
      expect(amendment.summary.totalDiffs).toBe(0);
      expect(amendment.summary.approvalRequired).toBe(false);
    });
  });

  describe("inspectPayrollRunAmendment", () => {
    it("evaluates risk level and generates privacy-safe aggregate warnings", () => {
      const summary = inspectPayrollRunAmendment({
        payrollId: "payroll-secure-batch-99",
        revision: 3,
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments: [
          { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5000n, asset: "USDC" },
        ],
      });

      expect(summary.totalDiffs).toBe(2); // Charlie and Bob removed
      expect(summary.removedCount).toBe(2);
      expect(summary.riskLevel).toBe("medium");
      expect(summary.warnings).toContain("Amendment includes recipient removals from the active payroll run.");
      expect(summary.redactedDescription).toContain("payroll pay...-99");
      expect(summary.redactedDescription).not.toContain("G_CHARLIE");
    });
  });

  describe("validatePayrollRunAmendment", () => {
    it("validates a compliant amendment input successfully", () => {
      const result = validatePayrollRunAmendment({
        payrollId: "pay-batch-101",
        revision: 1,
        authorizer: AUTHORIZER,
        reason: "annual_merit_increase",
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments: [
          { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5200n, asset: "USDC" },
          { recipient: "G_BOB_ADDR_22222222222222222222222222222222222222222222222", amount: 4000n, asset: "USDC" },
          { recipient: "G_CHARLIE_ADDR_3333333333333333333333333333333333333333333", amount: 3500n, asset: "XLM" },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.amendment.payrollId).toBe("pay-batch-101");
      expect(result.amendment.summary.modifiedCount).toBe(1);
    });

    it("rejects duplicate recipients in proposed commitments without echoing private details", () => {
      const result = validatePayrollRunAmendment({
        payrollId: "pay-batch-101",
        revision: 1,
        authorizer: AUTHORIZER,
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments: [
          { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5000n, asset: "USDC" },
          { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 1000n, asset: "USDC" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("DUPLICATE_RECIPIENTS");
      expect(result.message).toBe("Duplicate recipient detected in proposed payroll commitments.");
      expect(result.message).not.toContain("G_ALICE");
    });

    it("rejects unauthorized authorizers when an allowed list is configured", () => {
      const result = validatePayrollRunAmendment(
        {
          payrollId: "pay-batch-101",
          revision: 1,
          authorizer: "G_SOME_OTHER_SIGNER_999999999999999999999999999999999999999",
          currentCommitments: BASE_COMMITMENTS,
          proposedCommitments: [],
        },
        {
          allowedAuthorizers: [AUTHORIZER],
        }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("AMENDMENT_UNAUTHORIZED");
      expect(result.message).toContain("The specified authorizer is not permitted");
    });

    it("rejects amendments targeted at terminal payroll run statuses", () => {
      const result = validatePayrollRunAmendment(
        {
          payrollId: "pay-batch-101",
          revision: 1,
          authorizer: AUTHORIZER,
          currentCommitments: BASE_COMMITMENTS,
          proposedCommitments: [],
        },
        {
          currentPayrollStatus: "settled",
        }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("UNSUPPORTED_STATUS");
      expect(result.message).toBe("Payroll run in terminal state cannot be amended.");
    });
  });

  describe("authorizePayrollRunAmendment", () => {
    it("transitions amendment to authorized status when authorizer matches", () => {
      const amendment = createPayrollRunAmendment({
        payrollId: "pay-batch-101",
        revision: 1,
        authorizer: AUTHORIZER,
        reason: "policy_update",
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments: [
          { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5500n, asset: "USDC" },
        ],
      });

      expect(amendment.status).toBe("pending_authorization");

      const authorized = authorizePayrollRunAmendment(amendment, AUTHORIZER);
      expect(authorized.status).toBe("authorized");
    });

    it("rejects authorization when authorizer address does not match", () => {
      const amendment = createPayrollRunAmendment({
        payrollId: "pay-batch-101",
        revision: 1,
        authorizer: AUTHORIZER,
        currentCommitments: BASE_COMMITMENTS,
        proposedCommitments: [
          { recipient: "G_ALICE_ADDR_111111111111111111111111111111111111111111111", amount: 5500n, asset: "USDC" },
        ],
      });

      expect(() =>
        authorizePayrollRunAmendment(amendment, "G_WRONG_AUTHORIZER_12345678901234567890123456789012345678901234")
      ).toThrow("Authorizer mismatch: only the designated authorizer can approve this amendment.");
    });
  });
});
