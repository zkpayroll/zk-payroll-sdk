import { updateApprovalStateIfCurrent } from "../src/payroll/approvalStateConcurrency";
import { StaleApprovalError, StaleApprovalErrorCode } from "../src/payroll/staleApprovalErrors";

describe("updateApprovalStateIfCurrent", () => {
  it("commits the next state only at the expected version", async () => {
    const compareAndSet = jest.fn().mockResolvedValue(true);

    await expect(
      updateApprovalStateIfCurrent({ compareAndSet }, 4, { status: "approved" })
    ).resolves.toBe(5);
    expect(compareAndSet).toHaveBeenCalledWith(4, 5, { status: "approved" });
  });

  it("rejects a stale write with a safe conflict code", async () => {
    const compareAndSet = jest.fn().mockResolvedValue(false);

    await expect(
      updateApprovalStateIfCurrent({ compareAndSet }, 4, { salary: "private", status: "approved" })
    ).rejects.toMatchObject({
      name: "StaleApprovalError",
      code: StaleApprovalErrorCode.APPROVAL_CONCURRENT_MODIFICATION,
      message: expect.not.stringContaining("private"),
    });
  });

  it("rejects an unsafe boundary version before attempting a write", async () => {
    const compareAndSet = jest.fn();

    await expect(
      updateApprovalStateIfCurrent({ compareAndSet }, Number.MAX_SAFE_INTEGER, {})
    ).rejects.toBeInstanceOf(StaleApprovalError);
    expect(compareAndSet).not.toHaveBeenCalled();
  });
});