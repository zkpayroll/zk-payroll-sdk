import { StaleApprovalError, StaleApprovalErrorCode } from "./staleApprovalErrors";

/** A store must implement compare-and-set atomically, not as a read then write. */
export interface ApprovalStateVersionStore<T> {
  compareAndSet(
    expectedVersion: number,
    nextVersion: number,
    nextState: T
  ): Promise<boolean>;
}

/**
 * Persist an approval transition only if the stored version is still current.
 * The store's compareAndSet operation must be atomic (for example, a database
 * update constrained by `WHERE version = expectedVersion`).
 *
 * @returns The committed version.
 * @throws StaleApprovalError when the version is invalid, stale, or the store
 * cannot apply the conditional write. Error messages never include state data.
 */
export async function updateApprovalStateIfCurrent<T>(
  store: ApprovalStateVersionStore<T>,
  expectedVersion: number,
  nextState: T
): Promise<number> {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    expectedVersion >= Number.MAX_SAFE_INTEGER
  ) {
    throw new StaleApprovalError(
      "The payroll approval version is invalid. Fetch the latest approval state before updating.",
      StaleApprovalErrorCode.APPROVAL_VERSION_INVALID
    );
  }

  let committed: boolean;
  try {
    committed = await store.compareAndSet(expectedVersion, expectedVersion + 1, nextState);
  } catch (cause) {
    throw new StaleApprovalError(
      "The payroll approval update could not be saved. Check the approval store and retry.",
      StaleApprovalErrorCode.APPROVAL_STATE_WRITE_FAILED,
      {},
      cause
    );
  }

  if (!committed) {
    throw new StaleApprovalError(
      "The payroll approval changed before this update was saved. Fetch the latest state and retry.",
      StaleApprovalErrorCode.APPROVAL_CONCURRENT_MODIFICATION
    );
  }

  return expectedVersion + 1;
}