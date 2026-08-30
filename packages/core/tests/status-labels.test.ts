import {
  getTransactionStatusLabel,
  getExecutionStatusLabel,
  getPayrollRunStatusLabel,
  getEmployeeStatusLabel,
  getArchivedStatusLabel,
  getStatusLabel,
  isTransactionStatusTerminal,
  isExecutionStatusTerminal,
  isPayrollRunStatusTerminal,
  isArchivedStatusTerminal,
  getKnownTransactionStatuses,
  getKnownExecutionStatuses,
  getKnownPayrollRunStatuses,
  getKnownEmployeeStatuses,
  getKnownArchivedStatuses,
} from "../src/status";
import { PayrollTransactionStatus } from "../src/transactions/types";
import { ExecutionStatus } from "../src/summary/types";
import { IndexedPayrollRunStatus, IndexedEmployeeStatus } from "../src/indexer/types";

describe("Payroll Status Label Helpers", () => {
  describe("getTransactionStatusLabel", () => {
    it("should return correct labels for all known transaction statuses", () => {
      const statuses: PayrollTransactionStatus[] = [
        "pending",
        "confirmed",
        "failed",
        "expired",
        "unknown",
        "retryable",
      ];

      for (const status of statuses) {
        const label = getTransactionStatusLabel(status);
        expect(label.label).toBeDefined();
        expect(label.description).toBeDefined();
        expect(["default", "success", "warning", "danger", "info"]).toContain(label.variant);
        expect(typeof label.isTerminal).toBe("boolean");
      }
    });

    it("should return fallback for unknown transaction status", () => {
      const label = getTransactionStatusLabel("invalid_status" as PayrollTransactionStatus);
      expect(label.label).toBe("Unknown");
      expect(label.variant).toBe("default");
      expect(label.isTerminal).toBe(false);
    });

    it("should mark confirmed, failed, expired as terminal", () => {
      expect(isTransactionStatusTerminal("confirmed")).toBe(true);
      expect(isTransactionStatusTerminal("failed")).toBe(true);
      expect(isTransactionStatusTerminal("expired")).toBe(true);
    });

    it("should mark pending, unknown, retryable as non-terminal", () => {
      expect(isTransactionStatusTerminal("pending")).toBe(false);
      expect(isTransactionStatusTerminal("unknown")).toBe(false);
      expect(isTransactionStatusTerminal("retryable")).toBe(false);
    });
  });

  describe("getExecutionStatusLabel", () => {
    it("should return correct labels for all known execution statuses", () => {
      const statuses: ExecutionStatus[] = ["success", "partial", "failure", "pending"];

      for (const status of statuses) {
        const label = getExecutionStatusLabel(status);
        expect(label.label).toBeDefined();
        expect(label.description).toBeDefined();
        expect(["default", "success", "warning", "danger", "info"]).toContain(label.variant);
        expect(typeof label.isTerminal).toBe("boolean");
      }
    });

    it("should return fallback for unknown execution status", () => {
      const label = getExecutionStatusLabel("invalid_status" as ExecutionStatus);
      expect(label.label).toBe("Unknown");
      expect(label.variant).toBe("default");
      expect(label.isTerminal).toBe(false);
    });

    it("should mark all execution statuses as terminal except pending", () => {
      expect(isExecutionStatusTerminal("success")).toBe(true);
      expect(isExecutionStatusTerminal("partial")).toBe(true);
      expect(isExecutionStatusTerminal("failure")).toBe(true);
      expect(isExecutionStatusTerminal("pending")).toBe(false);
    });
  });

  describe("getPayrollRunStatusLabel", () => {
    it("should return correct labels for all known payroll run statuses", () => {
      const statuses: IndexedPayrollRunStatus[] = [
        "draft",
        "scheduled",
        "executed",
        "cancelled",
        "failed",
      ];

      for (const status of statuses) {
        const label = getPayrollRunStatusLabel(status);
        expect(label.label).toBeDefined();
        expect(label.description).toBeDefined();
        expect(["default", "success", "warning", "danger", "info"]).toContain(label.variant);
        expect(typeof label.isTerminal).toBe("boolean");
      }
    });

    it("should return fallback for unknown payroll run status", () => {
      const label = getPayrollRunStatusLabel("invalid_status" as IndexedPayrollRunStatus);
      expect(label.label).toBe("Unknown");
      expect(label.variant).toBe("default");
      expect(label.isTerminal).toBe(false);
    });

    it("should mark executed, cancelled, failed as terminal", () => {
      expect(isPayrollRunStatusTerminal("executed")).toBe(true);
      expect(isPayrollRunStatusTerminal("cancelled")).toBe(true);
      expect(isPayrollRunStatusTerminal("failed")).toBe(true);
    });

    it("should mark draft, scheduled as non-terminal", () => {
      expect(isPayrollRunStatusTerminal("draft")).toBe(false);
      expect(isPayrollRunStatusTerminal("scheduled")).toBe(false);
    });
  });

  describe("getEmployeeStatusLabel", () => {
    it("should return correct labels for all known employee statuses", () => {
      const statuses: IndexedEmployeeStatus[] = ["active", "inactive"];

      for (const status of statuses) {
        const label = getEmployeeStatusLabel(status);
        expect(label.label).toBeDefined();
        expect(label.description).toBeDefined();
        expect(["default", "success", "warning", "danger", "info"]).toContain(label.variant);
      }
    });

    it("should return fallback for unknown employee status", () => {
      const label = getEmployeeStatusLabel("invalid_status" as IndexedEmployeeStatus);
      expect(label.label).toBe("Unknown");
      expect(label.variant).toBe("default");
    });
  });

  describe("getArchivedStatusLabel", () => {
    it("should return correct labels for all known archived statuses", () => {
      const statuses: ("completed" | "failed")[] = ["completed", "failed"];

      for (const status of statuses) {
        const label = getArchivedStatusLabel(status);
        expect(label.label).toBeDefined();
        expect(label.description).toBeDefined();
        expect(["default", "success", "warning", "danger", "info"]).toContain(label.variant);
        expect(label.isTerminal).toBe(true);
      }
    });

    it("should return fallback for unknown archived status", () => {
      const label = getArchivedStatusLabel("invalid_status" as "completed" | "failed");
      expect(label.label).toBe("Unknown");
      expect(label.variant).toBe("default");
      expect(label.isTerminal).toBe(false);
    });

    it("should mark all archived statuses as terminal", () => {
      expect(isArchivedStatusTerminal("completed")).toBe(true);
      expect(isArchivedStatusTerminal("failed")).toBe(true);
    });
  });

  describe("getStatusLabel (generic)", () => {
    it("should delegate to correct getter based on type", () => {
      const txLabel = getStatusLabel("confirmed", "transaction");
      expect(txLabel.label).toBe("Confirmed");

      const execLabel = getStatusLabel("success", "execution");
      expect(execLabel.label).toBe("Success");

      const runLabel = getStatusLabel("executed", "payrollRun");
      expect(runLabel.label).toBe("Executed");

      const empLabel = getStatusLabel("active", "employee");
      expect(empLabel.label).toBe("Active");

      const archLabel = getStatusLabel("completed", "archived");
      expect(archLabel.label).toBe("Completed");
    });

    it("should return fallback for unknown type", () => {
      const label = getStatusLabel("anything", "transaction");
      expect(label.label).toBe("Unknown");
    });
  });

  describe("getKnown*Statuses", () => {
    it("should return all known transaction statuses", () => {
      const statuses = getKnownTransactionStatuses();
      expect(statuses).toHaveLength(6);
      expect(statuses).toEqual([
        "pending",
        "confirmed",
        "failed",
        "expired",
        "unknown",
        "retryable",
      ]);
    });

    it("should return all known execution statuses", () => {
      const statuses = getKnownExecutionStatuses();
      expect(statuses).toHaveLength(4);
      expect(statuses).toEqual(["success", "partial", "failure", "pending"]);
    });

    it("should return all known payroll run statuses", () => {
      const statuses = getKnownPayrollRunStatuses();
      expect(statuses).toHaveLength(5);
      expect(statuses).toEqual(["draft", "scheduled", "executed", "cancelled", "failed"]);
    });

    it("should return all known employee statuses", () => {
      const statuses = getKnownEmployeeStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses).toEqual(["active", "inactive"]);
    });

    it("should return all known archived statuses", () => {
      const statuses = getKnownArchivedStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses).toEqual(["completed", "failed"]);
    });
  });

  describe("UI variant consistency", () => {
    it("should use success variant for positive terminal statuses", () => {
      expect(getTransactionStatusLabel("confirmed").variant).toBe("success");
      expect(getExecutionStatusLabel("success").variant).toBe("success");
      expect(getPayrollRunStatusLabel("executed").variant).toBe("success");
      expect(getEmployeeStatusLabel("active").variant).toBe("success");
      expect(getArchivedStatusLabel("completed").variant).toBe("success");
    });

    it("should use danger variant for negative terminal statuses", () => {
      expect(getTransactionStatusLabel("failed").variant).toBe("danger");
      expect(getTransactionStatusLabel("expired").variant).toBe("danger");
      expect(getExecutionStatusLabel("failure").variant).toBe("danger");
      expect(getPayrollRunStatusLabel("cancelled").variant).toBe("danger");
      expect(getPayrollRunStatusLabel("failed").variant).toBe("danger");
      expect(getArchivedStatusLabel("failed").variant).toBe("danger");
    });

    it("should use warning variant for pending/in-progress statuses", () => {
      expect(getTransactionStatusLabel("pending").variant).toBe("warning");
      expect(getExecutionStatusLabel("pending").variant).toBe("warning");
      expect(getExecutionStatusLabel("partial").variant).toBe("warning");
    });

    it("should use info variant for scheduled/retryable statuses", () => {
      expect(getTransactionStatusLabel("retryable").variant).toBe("info");
      expect(getPayrollRunStatusLabel("scheduled").variant).toBe("info");
    });

    it("should use default variant for neutral/unknown statuses", () => {
      expect(getTransactionStatusLabel("unknown").variant).toBe("default");
      expect(getPayrollRunStatusLabel("draft").variant).toBe("default");
      expect(getEmployeeStatusLabel("inactive").variant).toBe("default");
    });
  });
});
