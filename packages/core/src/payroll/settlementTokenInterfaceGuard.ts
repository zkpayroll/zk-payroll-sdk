/**
 * Settlement helper guard that rejects unsupported token interfaces (#777).
 *
 * Payroll operators submit settlement instructions that name a token by its
 * interface (e.g. SEP-41 Soroban token, native Stellar asset). Before a
 * settlement helper routes to an interface-specific submitter it must prove
 * the interface is one the SDK understands, otherwise the call risks
 * invoking methods that do not exist on the underlying contract.
 *
 * The guard is a thin, structured layer on top of
 * {@link checkTokenInterfaceSupport} so payroll call sites never have to
 * assemble their own rejection shape.
 */

import {
  SupportedTokenInterface,
  TokenInterfaceErrorCode,
  checkTokenInterfaceSupport,
} from "../assets/tokenInterface";

export type SettlementTokenInterfaceDecision =
  | { ok: true; interface: SupportedTokenInterface }
  | {
      ok: false;
      code: TokenInterfaceErrorCode;
      message: string;
      /** Field name that failed, for structured preflight surfaces. */
      field: "tokenInterface";
    };

export interface SettlementTokenInterfaceGuardOptions {
  /** Narrow the set of interfaces accepted on a particular settlement path. */
  allowed?: readonly SupportedTokenInterface[];
}

/**
 * Settlement-side wrapper around the asset-layer check. Adds the `field`
 * discriminator that payroll preflight surfaces already emit for other
 * rejected inputs, and leaves the raw candidate value out of the result.
 */
export function guardSettlementTokenInterface(
  value: unknown,
  options: SettlementTokenInterfaceGuardOptions = {}
): SettlementTokenInterfaceDecision {
  const result = checkTokenInterfaceSupport(value, options);
  if (result.ok) return result;
  return {
    ok: false,
    code: result.code,
    message: result.message,
    field: "tokenInterface",
  };
}

/**
 * Throwing form for helpers that treat an unsupported interface as fatal.
 * The thrown error carries the stable code but never the raw candidate.
 */
export class UnsupportedTokenInterfaceError extends Error {
  readonly code: TokenInterfaceErrorCode;
  constructor(message: string, code: TokenInterfaceErrorCode) {
    super(message);
    this.name = "UnsupportedTokenInterfaceError";
    this.code = code;
  }
}

export function assertSupportedTokenInterface(
  value: unknown,
  options: SettlementTokenInterfaceGuardOptions = {}
): SupportedTokenInterface {
  const decision = guardSettlementTokenInterface(value, options);
  if (decision.ok) return decision.interface;
  throw new UnsupportedTokenInterfaceError(decision.message, decision.code);
}
