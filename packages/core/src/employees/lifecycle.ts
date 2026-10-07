/**
 * Employee lifecycle client API.
 *
 * Provides a coherent interface for managing employee lifecycle operations:
 * create, suspend, reactivate, and offboard.
 *
 * These are high-level wrappers around the underlying contract calls that
 * handle authorization, validation, and clear failure handling.
 */

import { rpc, Keypair, xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "../adapters/BaseContractWrapper";
import { ContractExecutionError, ContractErrorCode } from "../core/errors";
import { RunIdentifier } from "../core/run-identifier";

/** Status of an employee in the payroll system */
export type EmployeeStatus = "active" | "suspended" | "offboarded";

/** Result of an employee lifecycle operation */
export interface EmployeeLifecycleResult {
  /** The employee's public key */
  employeeAddress: string;
  /** The operation performed */
  operation: "create" | "suspend" | "reactivate" | "offboard";
  /** Whether the operation succeeded on-chain */
  success: boolean;
  /** Transaction hash if submitted */
  txHash?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Employee lifecycle client for managing employee state transitions.
 *
 * @example
 * ```typescript
 * import { EmployeeLifecycleClient } from "@zk-payroll/core/employees";
 *
 * const client = new EmployeeLifecycleClient(server, contractId);
 *
 * // Create an employee
 * const result = await client.create(adminKeypair, employeePublicKey);
 *
 * // Suspend an employee
 * await client.suspend(adminKeypair, employeePublicKey);
 *
 * // Reactivate an employee
 * await client.reactivate(adminKeypair, employeePublicKey);
 *
 * // Offboard an employee
 * await client.offboard(adminKeypair, employeePublicKey);
 * ```
 */
export class EmployeeLifecycleClient extends BaseContractWrapper {
  constructor(server: rpc.Server, contractId: string) {
    super(server, contractId);
  }

  /**
   * Create a new employee in the payroll system.
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Lifecycle result with success status
   */
  async create(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    const requestId = RunIdentifier.generateRequestId("employee_create");

    try {
      const args = [
        nativeToScVal(employeeAddress, { type: "address" }),
      ];

      await this.invoke("create_employee", args, signer, network, requestId);

      return {
        employeeAddress,
        operation: "create",
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        employeeAddress,
        operation: "create",
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Suspend an active employee.
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Lifecycle result with success status
   */
  async suspend(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    const requestId = RunIdentifier.generateRequestId("employee_suspend");

    try {
      const args = [
        nativeToScVal(employeeAddress, { type: "address" }),
      ];

      await this.invoke("suspend_employee", args, signer, network, requestId);

      return {
        employeeAddress,
        operation: "suspend",
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        employeeAddress,
        operation: "suspend",
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Reactivate a suspended employee.
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Lifecycle result with success status
   */
  async reactivate(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    const requestId = RunIdentifier.generateRequestId("employee_reactivate");

    try {
      const args = [
        nativeToScVal(employeeAddress, { type: "address" }),
      ];

      await this.invoke("reactivate_employee", args, signer, network, requestId);

      return {
        employeeAddress,
        operation: "reactivate",
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        employeeAddress,
        operation: "reactivate",
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Offboard an employee (permanent removal).
   *
   * @param signer - Admin keypair for authorization
   * @param employeeAddress - Stellar address of the employee
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Lifecycle result with success status
   */
  async offboard(
    signer: Keypair,
    employeeAddress: string,
    network?: string
  ): Promise<EmployeeLifecycleResult> {
    const requestId = RunIdentifier.generateRequestId("employee_offboard");

    try {
      const args = [
        nativeToScVal(employeeAddress, { type: "address" }),
      ];

      await this.invoke("offboard_employee", args, signer, network, requestId);

      return {
        employeeAddress,
        operation: "offboard",
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        employeeAddress,
        operation: "offboard",
        success: false,
        error: error.message,
      };
    }
  }
}
