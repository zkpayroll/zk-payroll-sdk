# SDK Error Handling

The ZK Payroll SDK normalizes all underlying network, contract, wallet, and proof generation failures into a unified, stable public error hierarchy. This allows integrators to build resilient user experiences and implement predictable recovery patterns.

## Error Hierarchy

All SDK errors inherit from the base `ZkPayrollError` class.

- `ZkPayrollError` (Base — includes `cause?: unknown` for underlying error preservation)
  - `WalletError` - Wallet interaction failures
    - `WalletRejectionError` - User explicitly declined a connection or signing request in their wallet
  - `ContractExecutionError` - On-chain simulation failures, reverts, insufficient fees, or rejected submissions.
    - `RpcTimeoutError` - RPC request or transaction submission didn't resolve in time (`RPC_TIMEOUT` or `TRANSACTION_TIMEOUT`)
    - `InvalidResponseError` - RPC returned malformed or unexpected payload structure (`INVALID_RESPONSE`)
  - `NetworkError` - Connection failures and unexpected HTTP responses.
  - `ProofGenerationError` - Failures related to circuit artifact downloading, caching, or witness calculation.
  - `SerializationError` - Failures during importing or exporting of payroll drafts.
  - `ValidationError` - Client-side validation errors.

*(Note: `PayrollError` is deprecated and acts as a backward-compatibility alias for `ZkPayrollError`)*

## Stable Error Code Reference

Every `ZkPayrollError` exposes:
1. `message`: A human-readable description of the failure.
2. `code`: A stable string code classifying the failure (e.g., `RPC_TIMEOUT`, `WALLET_SIGNING_REJECTED`).
3. `context`: A key-value record containing metadata relevant to the failure (e.g., `requestId`, transaction hash, or failing parameter).
4. `cause`: The underlying raw error, `AxiosError`, or wallet exception that caused the SDK error.

### Error Code Registry

The SDK maintains a centralized registry (`ERROR_CODE_REGISTRY`) that maps every stable error code to its category, meaning, whether it is retryable, and a suggested user-facing message. Integrators can use the registry programmatically:

```typescript
import { ERROR_CODE_REGISTRY, isRetryableErrorCode, getErrorCategory } from "@zk-payroll/core";

// Look up metadata for any code
const entry = ERROR_CODE_REGISTRY["RPC_TIMEOUT"];
console.log(entry.category);       // "rpc"
console.log(entry.retryable);      // true
console.log(entry.suggestedMessage); // "The request to the RPC endpoint timed out..."

// Check retryability without importing the registry
if (isRetryableErrorCode(error.code)) {
  showRetryButton();
}
```

| Code | Category | Meaning | Retryable | Suggested User Message |
|---|---|---|---|---|
| `VALIDATION_ERROR` | validation | Input validation failed. | No | The provided parameters failed validation. Please review your inputs and try again. |
| `WALLET_NOT_INSTALLED` | wallet | Wallet extension is not installed. | No | The wallet extension is not installed. Please install it and try again. |
| `WALLET_NOT_CONNECTED` | wallet | Wallet is installed but not connected to the dApp. | Yes | The wallet is not connected. Please connect your wallet and try again. |
| `WALLET_CONNECTION_REJECTED` | wallet | User explicitly rejected the connection request. | Yes | The wallet connection request was rejected. Please approve the connection in your wallet and try again. |
| `WALLET_SIGNING_REJECTED` | wallet | User explicitly rejected the signing request. | Yes | The transaction signing request was rejected. Please approve the signature in your wallet and try again. |
| `WALLET_NETWORK_MISMATCH` | wallet | Wallet is on a different network than expected. | Yes | The wallet is on the wrong network. Please switch to the correct network and try again. |
| `WALLET_INVALID_XDR` | wallet | Transaction envelope (XDR) is malformed. | No | The transaction data is invalid. This may indicate a software bug. |
| `WALLET_UNKNOWN_ERROR` | wallet | Unidentified wallet interaction error. | Yes | An unexpected wallet error occurred. Please try again. |
| `RPC_TIMEOUT` | rpc | RPC request did not complete in time. | Yes | The request to the RPC endpoint timed out. The network may be congested; please retry. |
| `INVALID_RESPONSE` | rpc | RPC returned malformed or unexpected data. | Yes | Received an invalid or malformed response from the RPC node. Please try again. |
| `PROOF_GENERATION_FAILED` | proof | ZK proof generation failed (witness, circuit, or artifact). | Yes | Zero-knowledge proof generation failed. This may be due to invalid inputs or insufficient system resources. |
| `SIMULATION_FAILED` | contract | Contract simulation failed before submission. | No | The transaction could not be simulated. Please verify your inputs and network connection and try again. |
| `TRANSACTION_SUBMISSION_FAILED` | contract | Signed transaction was rejected during submission. | Yes | The transaction was rejected by the network. Please check your connection and try again. |
| `TRANSACTION_TIMEOUT` | contract | Transaction did not confirm within the expected time. | Yes | The transaction did not confirm within the expected time. The network may be congested; please retry. |
| `INSUFFICIENT_FEE` | contract | Transaction fee was too low. | Yes | The transaction fee was too low. Try increasing the fee and submitting again. |
| `CONTRACT_REVERT` | contract | Smart contract logic rejected the transaction. | No | The smart contract rejected the transaction. This may indicate invalid parameters or insufficient permissions. |
| `UNKNOWN_RPC_ERROR` | contract | Unclassified contract execution error. | Yes | An unexpected error occurred while communicating with the blockchain network. Please try again. |
| `NETWORK_ERROR` | network | HTTP or network request failure. | Yes | A network error occurred. Please check your internet connection and try again. |
| `SERIALIZATION_FAILED` | serialization | Binary encoding or decoding failed. | No | Failed to serialize or deserialize data. The data may be corrupted. |
| `ARTIFACT_NOT_FOUND` | artifact | ZK circuit artifact not found at configured path. | Yes | A required proving artifact was not found. Please check your artifact URLs and try again. |
| `ARTIFACT_ACCESS_DENIED` | artifact | Access to artifact storage was denied. | No | Access to proving artifacts was denied. Please check your permissions and try again. |
| `ARTIFACT_CORRUPT` | artifact | Downloaded artifact has invalid checksum. | Yes | A proving artifact appears to be corrupt. The SDK will attempt to re-download it. |
| `ARTIFACT_FETCH_FAILED` | artifact | Artifact download failed due to network/server error. | Yes | Failed to download a proving artifact. Please check your network connection and try again. |
| `ARTIFACT_HASH_MISMATCH` | artifact | Artifact hash does not match expected value. | Yes | The downloaded proving artifact does not match its expected checksum. The SDK will retry. |
| `BATCH_VALIDATION_FAILED` | batch | Batch payload validation failed. | No | The batch payload contains invalid entries. Please review the validation errors and try again. |
| `DRAFT_VALIDATION_FAILED` | draft | Draft validation failed. | No | The payroll draft contains invalid data. Please review the errors and try again. |
| `RECONCILIATION_DIFF_FAILED` | reconciliation | Reconciliation diff generation failed. | No | Failed to generate reconciliation report. The input data may be inconsistent. |
| `RECONCILIATION_UNEXPECTED_ACTIVITY` | reconciliation | On-chain activity with no matching expected outcome. | No | Unexpected on-chain activity was detected. Review the reconciliation report for details. |

### Retry Guidance

- **Retryable errors** are typically transient (network timeouts, fee estimation, wallet user declines). The SDK's `withRetry` utility retries these automatically with exponential backoff.
- **Non-retryable errors** indicate invalid inputs, configuration problems, or contract logic failures. These require user or developer intervention before retrying.

## Recovery Classification

Use `classifyRecoverablePayrollError` when an application needs one stable decision for its retry, correction, and terminal states.

```typescript
import { classifyRecoverablePayrollError } from "@zk-payroll/core";

try {
  await payroll.processPayment(params);
} catch (error) {
  const classification = classifyRecoverablePayrollError(error);

  if (classification.category === "retryable") {
    retryWithBackoff();
  } else if (classification.category === "user-correctable") {
    showCorrectionFlow(classification.suggestedMessage);
  } else {
    showTerminalError(classification.suggestedMessage);
  }
}
```

The helper returns only the stable error code and registry message.
It does not return raw error messages, payroll values, or diagnostic context.

## User-Friendly UI Mapping

Use `toUserFriendlyError(error)` to map any SDK or unknown error into a clean, human-readable format suitable for UI toasts and diagnostic logs:

```typescript
import { toUserFriendlyError } from "@zk-payroll/sdk";

try {
  await service.processPayment(params);
} catch (error) {
  const { userMessage, technicalDetail, code } = toUserFriendlyError(error);
  showToastNotification(userMessage); // e.g. "Wallet request declined."
  logDiagnostic(code, technicalDetail);
}
```

## Handling Errors and Recovery Patterns

### 1. Handling Contract Reverts (`ContractExecutionError`)

Contract errors are mapped intelligently from the Soroban RPC responses. You should check the error code to determine if it was a user error, a network error, or a timeout.

```typescript
import { ContractExecutionError, ContractErrorCode } from "@zk-payroll/sdk";

try {
  await sdk.processPayment("G...", 100n);
} catch (error) {
  if (error instanceof ContractExecutionError) {
    switch (error.code) {
      case ContractErrorCode.INSUFFICIENT_FEE:
        // Recovery: Prompt the user to increase their fee buffer or retry.
        console.error("Transaction fee was too low.");
        break;
      case ContractErrorCode.TRANSACTION_TIMEOUT:
        // Recovery: Check the chain manually or queue the transaction to be verified later.
        console.error("The network is congested, transaction timed out.");
        break;
      case ContractErrorCode.CONTRACT_REVERT:
        // Recovery: The logic failed (e.g. insufficient funds). Surface the message to the user.
        console.error("Contract logic reverted:", error.message);
        break;
      default:
        console.error("Unknown contract error:", error.message);
    }
  } else {
    throw error;
  }
}
```

### 2. Handling Wallet Interactions (`WalletError`)

Wallet interactions are highly dependent on user input. Always catch `WalletError` to handle user rejections gracefully without crashing the app.

```typescript
import { WalletError, WalletErrorCode } from "@zk-payroll/sdk";

try {
  await walletAdapter.signAndSubmitTransaction(xdr);
} catch (error) {
  if (error instanceof WalletError) {
    if (error.code === WalletErrorCode.SIGNING_REJECTED) {
      // Recovery: Gently inform the user that the transaction was canceled.
      showToast("Transaction signing was canceled by the user.");
    } else if (error.code === WalletErrorCode.NETWORK_MISMATCH) {
      // Recovery: Ask the user to switch networks in their wallet extension.
      showWarning("Please switch your wallet to the Testnet network.");
    } else {
      console.error(`Wallet Error [${error.code}]:`, error.message);
    }
  }
}
```

### 3. Handling Zero-Knowledge Proof Failures (`ProofGenerationError`)

Proof generation is computationally heavy and relies on downloaded circuit artifacts.

```typescript
import { ProofGenerationError } from "@zk-payroll/sdk";

try {
  const proof = await generator.generateProof(witness);
} catch (error) {
  if (error instanceof ProofGenerationError) {
    // Recovery: Proof generation failed. This could be due to a malformed witness, 
    // or an inability to download the .wasm/.zkey artifacts.
    // Ensure `config.wasmUrl` and `config.zkeyUrl` are reachable.
    console.error("ZK Proof generation failed:", error.message);
  }
}
```

### 4. Handling Draft Serialization Issues (`SerializationError`)

When importing exported drafts, the data might be corrupted, tampered with, or from an incompatible version.

```typescript
import { importDraft, SerializationError } from "@zk-payroll/sdk";

try {
  const { draft, warnings } = importDraft(rawData, expectedChecksum);
  if (warnings.length > 0) {
    console.warn("Draft imported with warnings:", warnings);
  }
} catch (error) {
  if (error instanceof SerializationError) {
    if (error.code === "CHECKSUM_MISMATCH") {
      // Recovery: Do not trust the payload. Abort the import.
      alert("The draft file is corrupted or has been modified externally.");
    } else {
      // Recovery: Tell the user the file format is invalid.
      alert(`Cannot load draft: ${error.message}`);
    }
  }
}
```

### 5. Client-Side Validation (`ValidationError`)

Thrown internally when invalid arguments are provided to the SDK methods before hitting the network or the wallet.

```typescript
import { ValidationError } from "@zk-payroll/sdk";

try {
  await sdk.processPayment("invalid_address", -10n);
} catch (error) {
  if (error instanceof ValidationError) {
    // Recovery: Highlight the specific form field in the UI.
    form.setError(error.field, error.message);
  }
}
```
