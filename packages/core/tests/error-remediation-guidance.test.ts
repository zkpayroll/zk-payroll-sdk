/**
 * Tests for attaching remediation guidance to user-friendly errors
 * (Issue: contract error remediation hints for application users).
 */

import { toUserFriendlyErrorWithGuidance } from "../src/remediation/guidance";
import { RemediationAudience, RemediationCategory } from "../src/remediation/types";
import { ContractErrorCode, ContractExecutionError } from "../src/core/errors";

describe("toUserFriendlyErrorWithGuidance", () => {
  it("attaches an actionable, self-serviceable next step for a known contract error", () => {
    const error = new ContractExecutionError(
      "Fee too low for network conditions",
      ContractErrorCode.INSUFFICIENT_FEE
    );

    const result = toUserFriendlyErrorWithGuidance(error);

    expect(result.code).toBe(ContractErrorCode.INSUFFICIENT_FEE);
    expect(result.friendlyMessage).toBeTruthy();
    expect(result.remediation.known).toBe(true);
    expect(result.remediation.category).toBe(RemediationCategory.TREASURY);
    expect(result.remediation.action).toMatch(/fee/i);
    // Default audience is sdk-user: the fee itself is fixed by an admin, not the app user.
    expect(result.remediation.selfServiceable).toBe(false);
  });

  it("tailors guidance to the requested audience for the same error", () => {
    const error = new ContractExecutionError(
      "Contract call reverted",
      ContractErrorCode.CONTRACT_REVERT
    );

    const forSdkUser = toUserFriendlyErrorWithGuidance(error, RemediationAudience.SDK_USER);
    const forAdmin = toUserFriendlyErrorWithGuidance(error, RemediationAudience.ADMIN);

    expect(forSdkUser.remediation.selfServiceable).toBe(false);
    expect(forSdkUser.remediation.action).toMatch(/contact your payroll administrator/i);

    expect(forAdmin.remediation.selfServiceable).toBe(true);
    expect(forAdmin.remediation.action).toMatch(/role/i);
  });

  it("defaults to sdk-user (application-facing) guidance when no audience is given", () => {
    const error = { code: ContractErrorCode.RPC_TIMEOUT };
    const result = toUserFriendlyErrorWithGuidance(error);
    const explicit = toUserFriendlyErrorWithGuidance(error, RemediationAudience.SDK_USER);

    expect(result.remediation.action).toBe(explicit.remediation.action);
  });

  it("edge case: falls back to safe generic guidance for an unrecognized error code without throwing", () => {
    const result = toUserFriendlyErrorWithGuidance({ code: "SOME_UNMAPPED_FUTURE_CODE" });

    expect(result.remediation.known).toBe(false);
    expect(result.remediation.category).toBe(RemediationCategory.UNKNOWN);
    expect(result.remediation.action).toBeTruthy();
  });

  it("never echoes recipient or amount values embedded in the underlying error message", () => {
    const sensitiveError = new Error(
      "Contract call failed for recipient: GABC1234567890 with amount: 999999999"
    );
    (sensitiveError as unknown as { code: string }).code = ContractErrorCode.CONTRACT_REVERT;

    const result = toUserFriendlyErrorWithGuidance(sensitiveError);

    expect(result.remediation.action).not.toMatch(/GABC1234567890/);
    expect(result.remediation.action).not.toMatch(/999999999/);
    expect(result.friendlyMessage).not.toMatch(/GABC1234567890/);
    expect(result.friendlyMessage).not.toMatch(/999999999/);
  });

  it("preserves the original friendly-error fields alongside the new remediation field", () => {
    const baseline = toUserFriendlyErrorWithGuidance({
      code: ContractErrorCode.TRANSACTION_TIMEOUT,
    });

    expect(baseline).toEqual(
      expect.objectContaining({
        friendlyMessage: expect.any(String),
        code: ContractErrorCode.TRANSACTION_TIMEOUT,
        context: expect.any(Object),
        remediation: expect.objectContaining({
          action: expect.any(String),
          selfServiceable: expect.any(Boolean),
          category: expect.any(String),
          known: expect.any(Boolean),
        }),
      })
    );
  });
});
