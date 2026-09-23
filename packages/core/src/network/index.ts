/**
 * Network request timing instrumentation.
 *
 * Attaches timing metadata to SDK network responses (Soroban RPC calls via
 * `rpc.Server` and HTTP(S) artifact fetches via axios) for diagnostics,
 * without changing public response behavior.
 *
 * @module
 */

export { createTimedRpcServer, RPC_TIMING } from "./timedServer";
export type { TimedRpcServer, TimedRpcServerOptions } from "./timedServer";
export { timeAxiosRequest, installAxiosTiming, AXIOS_TIMING } from "./axiosTiming";
export type { InstallAxiosTimingOptions } from "./axiosTiming";
export { measure, now, epochMs, roundDuration, safeErrorMessage, computeStats } from "./timing";
export type {
  NetworkRequestTiming,
  NetworkRequestStatus,
  NetworkTimingListener,
  NetworkTimingOptions,
  NetworkTimingStats,
} from "./types";
