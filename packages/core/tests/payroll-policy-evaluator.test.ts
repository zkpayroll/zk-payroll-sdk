import {
  assertPayrollPolicies,
  evaluatePayrollPolicies,
  formatPayrollPolicySummary,
  getPayrollPolicyReasonMetadata,
  PayrollPolicyEvaluator,
  PayrollPolicyReasonCode,
  PayrollPolicyViolationError,
  toSafePolicyLog,
} from "../src/policies";
import type { PayrollPolicyEvaluationInput, PayrollPolicyRules } from "../src/policies";

const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const NETWORK = {
  network: "testnet",
  ready: true,
  paused: false,
  capabilities: ["fetch", "rpc_call"],
};

function input(
  overrides: Partial<PayrollPolicyEvaluationInput> = {}
): PayrollPolicyEvaluationInput {
  return {
    entries: [{ employeeId: "emp_1", recipient: RECIPIENT, amount: 500n, asset: "native" }],
    employees: [{ employeeId: "emp_1", status: "active", complianceStatus: "passed" }],
    network: NETWORK,
    ...overrides,
  };
}

const RULES: PayrollPolicyRules = {
  amount: { minAmount: 100n, maxAmount: 1_000n, maxTotalAmount: 5_000n },
  employeeStatus: { requireEmployeeRecord: true },
  asset: { allowedAssets: ["native"] },
  network: {
    requiredNetwork: "testnet",
    requireReady: true,
    requireCapabilities: ["fetch"],
  },
};

describe("evaluatePayrollPolicies — passing outcome", () => {
  it("passes a clean request with no issues", () => {
    const result = evaluatePayrollPolicies(input(), RULES, { referenceTime: 1_700_000_000_000 });

    expect(result.outcome).toBe("pass");
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.reasonCodes).toEqual([]);
    expect(result.evaluatedAt).toBe(1_700_000_000_000);
    expect(result.summary.totalEntries).toBe(1);
  });

  it("passes an empty request", () => {
    const result = evaluatePayrollPolicies(input({ entries: [] }), RULES);
    expect(result.outcome).toBe("pass");
    expect(result.summary.totalEntries).toBe(0);
  });
});

describe("evaluatePayrollPolicies — warning outcome", () => {
  it("warns when a payment is near the per-payment maximum without blocking", () => {
    const result = evaluatePayrollPolicies(
      input({ entries: [{ employeeId: "emp_1", amount: 950n, asset: "native" }] }),
      RULES
    );

    expect(result.outcome).toBe("warning");
    expect(result.passed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toContain(
      PayrollPolicyReasonCode.AMOUNT_NEAR_MAXIMUM
    );
  });

  it("warns for a locked employee and a pending compliance review", () => {
    const result = evaluatePayrollPolicies(
      input({
        employees: [
          {
            employeeId: "emp_1",
            status: "active",
            isLocked: true,
            complianceStatus: "pending",
          },
        ],
      }),
      RULES
    );

    expect(result.outcome).toBe("warning");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        PayrollPolicyReasonCode.EMPLOYEE_LOCKED,
        PayrollPolicyReasonCode.EMPLOYEE_COMPLIANCE_PENDING,
      ])
    );
  });
});

describe("evaluatePayrollPolicies — blocking outcome", () => {
  it("blocks an amount above the per-payment maximum", () => {
    const result = evaluatePayrollPolicies(
      input({ entries: [{ employeeId: "emp_1", amount: 1_001n, asset: "native" }] }),
      RULES
    );

    expect(result.outcome).toBe("block");
    expect(result.passed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reasonCodes).toContain(PayrollPolicyReasonCode.AMOUNT_EXCEEDS_MAXIMUM);
  });

  it("blocks an aggregate total above the run maximum", () => {
    const result = evaluatePayrollPolicies(
      input({
        entries: [
          { employeeId: "emp_1", amount: 900n, asset: "native" },
          { employeeId: "emp_1", amount: 900n, asset: "native" },
          { employeeId: "emp_1", amount: 900n, asset: "native" },
          { employeeId: "emp_1", amount: 900n, asset: "native" },
          { employeeId: "emp_1", amount: 900n, asset: "native" },
          { employeeId: "emp_1", amount: 900n, asset: "native" },
        ],
      }),
      RULES
    );

    expect(result.blocked).toBe(true);
    expect(result.reasonCodes).toContain(PayrollPolicyReasonCode.TOTAL_EXCEEDS_MAXIMUM);
  });

  it("blocks an inactive, suspended, or terminated employee", () => {
    for (const [status, code] of [
      ["inactive", PayrollPolicyReasonCode.EMPLOYEE_INACTIVE],
      ["suspended", PayrollPolicyReasonCode.EMPLOYEE_SUSPENDED],
      ["terminated", PayrollPolicyReasonCode.EMPLOYEE_TERMINATED],
    ] as const) {
      const result = evaluatePayrollPolicies(
        input({ employees: [{ employeeId: "emp_1", status }] }),
        RULES
      );
      expect(result.outcome).toBe("block");
      expect(result.reasonCodes).toContain(code);
    }
  });

  it("blocks a non-allowlisted asset", () => {
    const result = evaluatePayrollPolicies(
      input({
        entries: [
          {
            employeeId: "emp_1",
            amount: 500n,
            asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          },
        ],
      }),
      RULES
    );

    expect(result.blocked).toBe(true);
    expect(result.reasonCodes).toContain(PayrollPolicyReasonCode.ASSET_NOT_ALLOWED);
  });

  it("blocks a network mismatch, unready network, and paused contract", () => {
    const result = evaluatePayrollPolicies(
      input({ network: { network: "mainnet", ready: false, paused: true } }),
      RULES
    );

    expect(result.blocked).toBe(true);
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        PayrollPolicyReasonCode.NETWORK_MISMATCH,
        PayrollPolicyReasonCode.NETWORK_NOT_READY,
        PayrollPolicyReasonCode.NETWORK_PAUSED,
      ])
    );
  });

  it("blocks when required employee records are missing", () => {
    const result = evaluatePayrollPolicies(input({ employees: [] }), {
      employeeStatus: { requireEmployeeRecord: true },
    });

    expect(result.blocked).toBe(true);
    expect(result.reasonCodes).toContain(PayrollPolicyReasonCode.EMPLOYEE_NOT_FOUND);
  });
});

describe("actionable reason codes", () => {
  it("exposes remediation metadata for every emitted built-in code", () => {
    const result = evaluatePayrollPolicies(
      input({ entries: [{ employeeId: "emp_1", amount: 2_000n, asset: "USDC:GABC" }] }),
      RULES
    );

    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      const metadata = getPayrollPolicyReasonMetadata(issue.code);
      expect(metadata).toBeDefined();
      expect(metadata?.suggestedAction.length).toBeGreaterThan(0);
      expect(issue.action).toBe(metadata?.suggestedAction);
    }
  });
});

describe("privacy-safe policy logging", () => {
  it("never exposes amounts, recipient addresses, or employee ids in results or logs", () => {
    const secretAmount = 9_876_543_210n;
    const secretEmployeeId = "emp-confidential-42";
    const secretRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    const result = evaluatePayrollPolicies(
      {
        entries: [
          {
            employeeId: secretEmployeeId,
            recipient: secretRecipient,
            amount: secretAmount,
            asset: "native",
          },
        ],
        employees: [{ employeeId: secretEmployeeId, status: "suspended" }],
        network: NETWORK,
      },
      RULES
    );

    const serialized = JSON.stringify(result);
    const safeLog = JSON.stringify(toSafePolicyLog(result));
    const summary = formatPayrollPolicySummary(result);
    const errorMessage = (() => {
      try {
        assertPayrollPolicies(
          {
            entries: [
              {
                employeeId: secretEmployeeId,
                recipient: secretRecipient,
                amount: secretAmount,
                asset: "native",
              },
            ],
            employees: [{ employeeId: secretEmployeeId, status: "suspended" }],
          },
          RULES
        );
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();

    for (const output of [serialized, safeLog, summary, errorMessage]) {
      expect(output).not.toContain(secretAmount.toString());
      expect(output).not.toContain(secretEmployeeId);
      expect(output).not.toContain(secretRecipient);
    }
  });
});

describe("custom rules and evaluator class", () => {
  it("supports custom warnings and blocks", () => {
    const result = evaluatePayrollPolicies(input(), {
      custom: [
        {
          id: "department-review",
          evaluate: (context) => ({
            outcome: "warning",
            code: "DEPARTMENT_REVIEW",
            message: `Review ${context.entries.length} entry before submission.`,
          }),
        },
        {
          id: "hard-stop",
          evaluate: () => ({
            outcome: "block",
            code: "HARD_STOP",
            message: "Submission is disabled by a custom rule.",
            action: "Ask an administrator to re-enable submissions.",
          }),
        },
      ],
    });

    expect(result.outcome).toBe("block");
    expect(result.reasonCodes).toEqual(["DEPARTMENT_REVIEW", "HARD_STOP"]);
    expect(result.blockers[0].action).toBe("Ask an administrator to re-enable submissions.");
  });

  it("evaluates through the reusable class and throws on blockers", () => {
    const evaluator = new PayrollPolicyEvaluator(RULES);

    expect(evaluator.evaluate(input()).outcome).toBe("pass");
    expect(() =>
      evaluator.evaluateOrThrow(
        input({ employees: [{ employeeId: "emp_1", status: "terminated" }] })
      )
    ).toThrow(PayrollPolicyViolationError);
  });

  it("honours the enabled policy subset and deterministic reference time", () => {
    const result = evaluatePayrollPolicies(
      input({ entries: [{ employeeId: "emp_1", amount: 0n, asset: "" }] }),
      RULES,
      { enabledPolicies: ["amount"], referenceTime: new Date("2025-01-01T00:00:00.000Z") }
    );

    expect(result.reasonCodes).toEqual([PayrollPolicyReasonCode.AMOUNT_NOT_POSITIVE]);
    expect(result.evaluatedAt).toBe(Date.parse("2025-01-01T00:00:00.000Z"));
  });
});
