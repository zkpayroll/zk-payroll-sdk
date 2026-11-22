# Payroll Period Boundaries Specification (#877)

## Overview
A payroll period defines the temporal bounding box for work accrual, compensation calculation, pre-flight verification, and final disbursement. Enforcing deterministic period boundaries guarantees accounting accuracy, prevents double-claiming of work intervals, and ensures audit reconcilability.

---

## Period Structure & Timing Model

```
|--- Period Start ---------------- Cutoff Date ---------------- Period End --- Settlement Date --->
     [Accrual Window]                [Review & Proofs]           [Disbursement]
```

### Key Milestones:
1. **Period Start (`start`)**: The exact timestamp (epoch ms) marking the start of the pay cycle.
2. **Cutoff Date (`cutoff`)**: The deadline after which employee hours, adjustments, and bonus allocations are frozen. Must satisfy: $\text{start} < \text{cutoff} \le \text{end}$.
3. **Period End (`end`)**: The formal close of the pay cycle. Must satisfy: $\text{start} < \text{end}$.
4. **Settlement Date (`settlementDate`)**: The scheduled execution date for on-chain fund transfer. Must satisfy: $\text{settlementDate} \ge \text{end}$.

---

## Validation & Boundary Guardrails

- **Duration Bounds**: Minimum duration is 1 hour (3,600,000 ms); maximum duration is 366 days (leap year bound).
- **Non-Overlap Invariant**: Sequential payroll periods for the same employer and asset class cannot overlap:
  $$\text{Period}_B.\text{start} \ge \text{Period}_A.\text{end}$$
- **Lifecycle Immutability**: Once a period reaches `CLOSED` or `ARCHIVED` status, it cannot be modified or reopened without explicit cryptographic override.
- **Privacy Model**: Period boundaries disclose only temporal and scheduling metadata. No individual employee compensation details or headcount volumes are exposed.
