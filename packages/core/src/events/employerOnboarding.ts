/**
 * Employer Onboarding Event Decoder
 *
 * Decodes `employer_onboarded` contract events into a typed
 * `EmployerOnboardedEvent`. Event decoders like this let indexers and
 * dashboards consume onboarding activity safely, without each consumer
 * re-implementing ScVal parsing.
 */

import type { RawContractEvent } from "../event-parser";
import { decodeEventName, decodeAddress, decodeDataMap, decodeU64AsNumber } from "../event-parser";
import { EventDecodingError } from "./types";

/** Emitted when an employer completes onboarding on the contract. */
export interface EmployerOnboardedEvent {
  type: "employer_onboarded";
  /** Stellar address of the newly onboarded employer. */
  employer: string;
  /** Address of the admin/operator who approved onboarding, if recorded. */
  onboardedBy?: string;
  /** Optional human-readable company/organization name. */
  companyName?: string;
  /** Unix seconds when onboarding completed, as recorded on-chain. */
  onboardedAt: number;
  contractId?: string;
  ledger?: number;
  timestamp?: string;
}

const EVENT_NAME = "employer_onboarded";

/**
 * Decode a single raw `employer_onboarded` contract event.
 *
 * @param event - A raw event from Soroban RPC or an indexed data source
 * @returns The typed `EmployerOnboardedEvent`
 * @throws EventDecodingError if the event is not an `employer_onboarded`
 * event, or is missing the required employer topic
 *
 * @example
 * ```ts
 * import { decodeEmployerOnboardingEvent } from "@zk-payroll/core";
 *
 * const event = decodeEmployerOnboardingEvent(rawEvent);
 * console.log(event.employer, event.companyName);
 * ```
 */
export function decodeEmployerOnboardingEvent(event: RawContractEvent): EmployerOnboardedEvent {
  if (!event.topics || event.topics.length === 0) {
    throw new EventDecodingError("Event has no topics", event);
  }

  const eventName = decodeEventName(event.topics[0]);
  if (eventName !== EVENT_NAME) {
    throw new EventDecodingError(
      `Expected "${EVENT_NAME}" event, got "${eventName || "unknown"}"`,
      event
    );
  }

  const employer = decodeAddress(event.topics[1]);
  if (!employer) {
    throw new EventDecodingError(
      "Missing required employer topic in employer_onboarded event",
      event
    );
  }

  const data = decodeDataMap(event.data);

  return {
    type: "employer_onboarded",
    employer,
    onboardedBy: data.onboarded_by ? decodeAddress(data.onboarded_by) || undefined : undefined,
    companyName: data.company_name?.str()?.toString(),
    onboardedAt: decodeU64AsNumber(data.onboarded_at),
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.ledgerClosedAt,
  };
}

/**
 * Decode multiple raw `employer_onboarded` events.
 *
 * @param events - Array of raw events
 * @returns Array of decoded `EmployerOnboardedEvent` objects
 * @throws EventDecodingError if any event fails to decode
 */
export function decodeEmployerOnboardingEvents(
  events: RawContractEvent[]
): EmployerOnboardedEvent[] {
  return events.map(decodeEmployerOnboardingEvent);
}

/**
 * Check whether a raw event is an `employer_onboarded` event, without
 * throwing. Useful for filtering a mixed event stream before decoding.
 */
export function isEmployerOnboardingEvent(event: RawContractEvent): boolean {
  if (!event.topics || event.topics.length === 0) return false;
  return decodeEventName(event.topics[0]) === EVENT_NAME;
}
