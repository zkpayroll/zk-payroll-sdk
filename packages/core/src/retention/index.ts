export {
  type SettlementStatus,
  type RetentionPurgeRecord,
  type RetentionPurgeOptions,
  type RetentionPurgeResult,
  RetentionPurgeBlockedError,
  isSettlementPending,
  assertRetentionPurgeAllowed,
  purgeRetentionRecords,
} from "./settlementRetentionGuard";
