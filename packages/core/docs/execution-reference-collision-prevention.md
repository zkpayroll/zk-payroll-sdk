# Execution Reference Collision Prevention (#705)

The `ExecutionReferenceCollisionGuard` provides pre-flight collision prevention for execution references in the ZK Payroll SDK.

## Features

- **Deterministic Reference Tracking**: Guards against duplicate or overlapping payroll executions.
- **State Lifecycle**: Tracks references across `pending`, `in_flight`, `executed`, `failed`, and `cancelled` states.
- **Structured Error Handling**: Throws `ExecutionReferenceCollisionError` with detailed collision context.
- **Batch Verification**: Includes `validateBatchExecutionReferences` for checking reference uniqueness across multi-instruction batches.
