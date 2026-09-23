/**
 * Disputes Module
 *
 * Provides utilities for parsing, formatting, and displaying payroll dispute
 * information. Includes privacy-safe messages for contributors and technical
 * details for maintainers.
 */

export { DisputeEventParser } from "./DisputeEventParser";
export { DisputeMessageFormatter } from "./DisputeMessageFormatter";
export { DisputeUIHelpers } from "./DisputeUIHelpers";
export type {
  DisputeStatus,
  DisputeSeverity,
  DisputeCategory,
  DisputeEvent,
  DisputeInfo,
  ContributorDisputeMessage,
  MaintainerDisputeMessage,
  DisputeBadge,
  DisputeActionPrompt,
  RawDisputeContractEvent,
  DisputeParsingResult,
  DisputeSummary,
} from "./types";
export { DisputeParsingError } from "./types";
