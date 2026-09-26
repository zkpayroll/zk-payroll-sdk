/**
 * Employee lifecycle client API.
 *
 * Provides a coherent interface for managing employee lifecycle operations:
 * create, suspend, reactivate, and offboard.
 *
 * These are high-level wrappers around the underlying contract calls that
 * handle authorization, validation, and clear failure handling. Every method
 * returns an explicit, discriminated result (#483) instead of throwing, so
 * asynchronous failures always carry a stable error code, a sanitized message,
 * retryability classification, and actionable remediation guidance — without
 * ever exposing sensitive payroll values such as salaries, amounts, or keys.
 *
 * @example
 * ```typescript
 * import { EmployeeLifecycleClient } from "@zk-payroll/core/employees";
 *
 * const client = new EmployeeLifecycleClient(server, contractId);
 *
 * const result = await client.create(adminKeypair, employeePublicKey);
 * if (result.ok) {
 *   console.log("Employee created", result.correlationId);
 * } else {
 *   // Sanitized, actionable failure — safe to log or display.
 *   console.error(result.error.code, result.error.message);
 *   console.error(result.error.remediation.action);
 * }
 * ```
 */

import { rpc, Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { mapRpcError, SDK_OPERATION_VALIDATION_ERROR_CODE } from "../core/errors";
import { classifyError } from "../core/retry";
import type { SdkOperationErrorDetail } from "../core/operationResult";
import { buildSdkOperationValidationFailure } from "../core/operationResult";
import { redactError } from "../redaction/RedactionEngine";
import { mapErrorToRemediation } from "../remediation/mapper";
import { RemediationAudience } from "../remediation/types";
import { RunIdentifier } from "../core/run-identifier";
import { validatePayoutDestination } from "./payoutDestination";

/** Status of an employee in the payroll system */
export type EmployeeStatus = "active" | "suspended" | "offboarded";

/** Supported employee lifecycle operations. */
export type EmployeeLifecycleOperation = "create" | "suspend" | "reactivate" | "offboard";

/** Discriminated success result of an employee lifecycle operation. */
export interface EmployeeLifecycleSuccess {
  /** Discriminant — always `true` for success results. */
  readonly ok: true;
  /**
   * Backward-compatible boolean flag (always `true`).
   * Prefer narrowing with `ok` or {@link isEmployeeLifecycleSuccess}.
   */
  readonly success: true;
  /** The employee's public key. */
  readonly employeeAddress: string;
  /** The operation performed. */
  readonly operation: EmployeeLifecycleOperation;
  /** Correlation ID shared with the underlying contract invocation. */
  readonly correlationId: string;
  /** Transaction hash if submitted. */
  readonly txHash?: string;
}

/**
 * Discriminated failure result of an employee lifecycle operation.
 *
 * `error.message` is sanitized through the SDK redaction engine and never
 * contains sensitive payroll values. Rejected input values (including invalid
 * addresses) are never echoed back into the failure result.
 */
export interface EmployeeLifecycleFailure {
  /** Discriminant — always `false` for failure results. */
  readonly ok: false;
  /**
   * Backward-compatible boolean flag (always `false`).
   * Prefer narrowing with `ok` or {@link isEmployeeLifecycleFailure}.
   */
  readonly success: false;
  /** The operation performed. */
  readonly operation: EmployeeLifecycleOperation;
  /** Correlation ID shared with the underlying contract invocation. */
  readonly correlationId: string;
  /** Structured, sanitized failure detail with actionable guidance. */
  readonly error: SdkOperationErrorDetail;
}

/** Result of an employee lifecycle operation. Narrow with `ok` or the type guards. */
export type EmployeeLifecycleResult = EmployeeLifecycleSuccess | EmployeeLifecycleFailure;

/** Narrows a lifecycle result to its success variant. */
export function isEmployeeLifecycleSuccess(
  result: EmployeeLifecycleResult
): result is EmployeeLifecycleSuccess {
  return result.ok === true;
}

/** Narrows a lifecycle result to its failure variant. */
export function isEmployeeLifecycleFailure(
  result: EmployeeLifecycleResult
): result is EmployeeLifecycleFailure {
  return result.ok === false;
}

/**
 * Converts a thrown value into a sanitized, actionable lifecycle failure
 * detail. The raw thrown value is never reflected into the result.
 */
function toLifecycleErrorDetail(err: unknown): SdkOperationErrorDetail {
  const mapped = mapRpcError(err);
  const sanitized = redactError(mapped);
  const decision = classifyError(mapped);
  const remediation = mapErrorToRemediation(mapped.code, RemediationAudience.SDK_USER);
  return {
    code: mapped.code,
    message: sanitized.message,
    attempted: true,
    retryable: decision.retryable,
    retryReason: decision.reason,
    remediation: {
      summary: remediation.summary,
      action: remediation.guidance.action,
      selfServiceable: remediation.guidance.selfServiceable,
    },
  };
}

/**
 * Employee lifecycle client for managing employee state transitions.
 *
 * All methods return discriminated {@link EmployeeLifecycleResult} values and
 * never throw for expected operation failures.
 */
export class EmployeeLifecycleClient extends BaseContractWrapper {
  constructor(server: rpc.Server, contractId: string) {
    super(server, contractId);
  }

  /**
   * Shared implementation for the four lifecycle operations.
   *
   * Validates the destination address locally (never reflecting the rejected
   * value in the failure), invokes the contract with a deterministic request
   * ID for correlation, and converts any failure into a sanitized,
   * actionable result.
   */
  private async runLifecycleOperation(
    operation: EmployeeLifecycleOperation,
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    const method = `${operation === "create" ? "create" : operation}_employee`;
    const correlationId = RunIdentifier.generateRequestId(`employee_${operation}`);

    const destination = validatePayoutDestination(employeeAddress);
    if (!destination.ok) {
      return {
        ok: false,
        success: false,
        operation,
        correlationId,
        error: buildSdkOperationValidationFailure(
          destination.message,
          SDK_OPERATION_VALIDATION_ERROR_CODE
        ),
      };
    }

    try {
      await this.invoke(
        method,
        [nativeToScVal(employeeAddress, { type: "address" })],
        signer,
        network,
        correlationId
      );

      return {
        ok: true,
        success: true,
        employeeAddress,
        operation,
        correlationId,
      };
    } catch (err) {
      return {
        ok: false,
        success: false,
        operation,
        correlationId,
        error: toLifecycleErrorDetail(err),
      };
    }
  }

  /**
   * Create a new employee in the payroll system.
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Discriminated lifecycle result with success/failure detail
   */
  async create(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    return this.runLifecycleOperation("create", signer, employeeAddress, network);
  }

  /**
   * Suspend an active employee.
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Discriminated lifecycle result with success/failure detail
   */
  async suspend(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    return this.runLifecycleOperation("suspend", signer, employeeAddress, network);
  }

  /**
   * Reactivate a suspended employee.
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Discriminated lifecycle result with success/failure detail
   */
  async reactivate(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    return this.runLifecycleOperation("reactivate", signer, employeeAddress, network);
  }

  /**
   * Offboard an employee (permanent removal).
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Discriminated lifecycle result with success/failure detail
   */
  async offboard(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    return this.runLifecycleOperation("offboard", signer, employeeAddress, network);
  }
}
