# Network Request Timing Metadata

The SDK talks to the network through two paths:

1. **Soroban RPC** via `@stellar/stellar-sdk`'s `rpc.Server` (`getNetwork`, `getLedgerEntries`, `simulateTransaction`, `sendTransaction`, `getTransaction`, …).
2. **HTTP(S) artifact fetches** via `axios` (circuit `.wasm`/`.zkey` downloads and environment checks).

This module attaches **timing metadata** to those requests so integrators can
diagnose slow RPC or API paths during payroll operations — without changing any
existing response data or public behavior.

## Quick Start

### Timed RPC server (Soroban RPC)

Wrap your `rpc.Server` with `createTimedRpcServer` and pass it anywhere the SDK
accepts a server:

```typescript
import { rpc } from "@stellar/stellar-sdk";
import { createTimedRpcServer } from "@zk-payroll/sdk";

const server = createTimedRpcServer(new rpc.Server(rpcUrl));
// Pass `server` to the SDK wherever it accepts an rpc.Server.
// Existing behavior is unchanged.

// Diagnostics:
const stats = server.getNetworkTimingStats();
console.log(stats.byOperation.simulateTransaction);
// { count, totalDurationMs, avgDurationMs }

for (const timing of server.getNetworkTimings()) {
  console.log(`${timing.operation}: ${timing.durationMs}ms (${timing.status})`);
}
```

The timing metadata is also attached to each response (and error) as a
**non-enumerable symbol** (`RPC_TIMING`), so serialization and spread copies
are unaffected:

```typescript
import { RPC_TIMING } from "@zk-payroll/sdk";

const result = await server.getNetwork();
const timing = result[RPC_TIMING]; // NetworkRequestTiming | undefined
JSON.stringify(result); // unchanged — symbol is non-enumerable
```

### HTTP(S) requests (axios)

**Single request** — no global side effects:

```typescript
import { timeAxiosRequest } from "@zk-payroll/sdk";

const { response, timing } = await timeAxiosRequest({
  url: "https://cdn.example.com/payroll_circuit.wasm",
  method: "get",
  responseType: "arraybuffer",
});
console.log(timing); // { operation: "GET https://...", durationMs, status, ... }
```

**Global interceptors** — opt-in, must be installed explicitly:

```typescript
import { installAxiosTiming } from "@zk-payroll/sdk";

const uninstall = installAxiosTiming({
  onRequest: (timing) => console.log(`${timing.operation} took ${timing.durationMs}ms`),
});

// ... run app ...

uninstall(); // removes the interceptors
```

## Metadata Shape

```typescript
interface NetworkRequestTiming {
  operation: string;        // e.g. "simulateTransaction" or "GET https://cdn.example.com/circuit.wasm"
  endpoint?: string;        // RPC method name or HTTP URL
  startedAt: number;        // epoch ms
  durationMs: number;       // ms, rounded to 3 decimals
  status: "success" | "error";
  error?: string;           // error message (never a payload) on failure
  requestId?: string;       // optional correlation id
}
```

Timed servers also expose:

| Method | Description |
|--------|-------------|
| `getNetworkTimings()` | Copy of retained timing records (oldest first). |
| `clearNetworkTimings()` | Clears the retained records. |
| `getNetworkTimingStats()` | Aggregated `count`, `avg/min/max`, and a per-operation breakdown. |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `onRequest` | Listener invoked after every timed request (success or error). | — |
| `maxRecords` | Maximum timing records retained in memory. | `100` |
| `attachToResponse` | Attach timing to response/error objects as a non-enumerable symbol. | `true` |

## Privacy

Timing records contain only the operation name, endpoint, and duration — never
request/response payloads, transaction hashes, or private payroll values. The
result is safe to log, export, or emit to telemetry.