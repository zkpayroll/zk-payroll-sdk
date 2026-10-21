import type { xdr } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../event-parser";
import { EventDecodingError } from "./types";

/** Current schema version used by payroll lifecycle event decoders. */
export const PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION = 1 as const;

/** Schema version reported by a decoded payroll lifecycle event. */
export type PayrollLifecycleEventSchemaVersion =
  typeof PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION;

/**
 * Resolve the schema version of a payroll lifecycle event. Legacy events omit
 * `schema_version` and are interpreted as v1; unknown explicit versions fail
 * closed so callers never decode a changed payload with the wrong schema.
 */
export function decodePayrollLifecycleEventSchemaVersion(
  data: Record<string, xdr.ScVal>,
  eventName: string,
  event: RawContractEvent
): PayrollLifecycleEventSchemaVersion {
  const encodedVersion = data.schema_version;
  if (encodedVersion === undefined) return PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION;

  let version: number;
  try {
    const kind = encodedVersion.switch()?.name;
    if (kind === "scvU32") {
      version = encodedVersion.u32();
    } else if (kind === "scvU64") {
      const rawVersion = encodedVersion.u64().toString();
      version = rawVersion === "1" ? 1 : Number.NaN;
    } else {
      version = Number.NaN;
    }
  } catch {
    version = Number.NaN;
  }

  if (version !== PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION) {
    throw new EventDecodingError(
      `Unsupported or invalid schema_version in ${eventName} event data`,
      event
    );
  }

  return PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION;
}