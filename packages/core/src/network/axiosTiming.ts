/**
 * Timing metadata for HTTP(S) requests made through axios.
 *
 * The SDK uses axios to fetch ZK circuit artifacts (`.wasm`/`.zkey`) and to
 * probe artifact URLs during environment checks. These helpers attach
 * {@link NetworkRequestTiming} to those requests without changing response
 * data.
 *
 * Two opt-in entry points are provided:
 * - {@link timeAxiosRequest} wraps a single request and returns the response
 *   together with its timing — no global side effects.
 * - {@link installAxiosTiming} installs global axios interceptors and returns
 *   an uninstall function. Use this when you want every axios request in the
 *   app to be timed. It is never installed implicitly.
 *
 * Security: timing records contain only the HTTP method, URL, and duration —
 * never request/response bodies or private payroll values.
 *
 * @module
 */

import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { attachTiming, epochMs, now, roundDuration, safeErrorMessage } from "./timing";
import type { NetworkRequestTiming, NetworkTimingListener } from "./types";
import { REQUEST_ID_HEADER, normalizeRequestId, withRequestIdHeader } from "../core/request-id";

/** Symbol used to attach timing metadata to axios responses/errors. */
export const AXIOS_TIMING = Symbol("axios.network.timing");

/** Start-time marker stored on the axios config by the request interceptor. */
const AXIOS_START = Symbol("axios.network.timing.start");

interface AxiosStartMeta {
  /** Wall-clock epoch ms when the request started. */
  epoch: number;
  /** Monotonic clock ms when the request started. */
  monotonic: number;
}

type ConfigWithStart = AxiosRequestConfig & { [AXIOS_START]?: AxiosStartMeta };

/**
 * Reads a valid request id from an outgoing request's `X-Request-Id` header
 * (any casing). Invalid or absent values yield `undefined`; never throws.
 */
function requestIdFromConfig(config: AxiosRequestConfig | undefined): string | undefined {
  const headers = config?.headers as Record<string, unknown> | undefined;
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === REQUEST_ID_HEADER.toLowerCase());
  const value = key ? headers[key] : undefined;
  try {
    return typeof value === "string" ? normalizeRequestId(value) : undefined;
  } catch {
    return undefined;
  }
}

function operationFor(config: AxiosRequestConfig): string {
  const method = (config.method ?? "get").toUpperCase();
  return `${method} ${config.url ?? config.baseURL ?? "request"}`;
}

/**
 * Performs a single axios request and returns the response together with its
 * timing metadata.
 *
 * The response (or thrown error) is unchanged; the timing is additionally
 * attached to it as a non-enumerable symbol property.
 *
 * @param config - Axios request config.
 * @param onRequest - Optional listener invoked with the timing record.
 * @returns The axios response and its timing metadata.
 */
export async function timeAxiosRequest<T = unknown>(
  config: AxiosRequestConfig,
  onRequest?: NetworkTimingListener,
  requestId?: string
): Promise<{ response: AxiosResponse<T>; timing: NetworkRequestTiming }> {
  // Propagate the caller's request id as an X-Request-Id header and onto the
  // timing record so HTTP artifact fetches correlate with the payroll run.
  const id = normalizeRequestId(requestId);
  if (id) {
    config = {
      ...config,
      headers: withRequestIdHeader(
        config.headers as Record<string, unknown> | undefined,
        id
      ) as AxiosRequestConfig["headers"],
    };
  }
  const startedAt = epochMs();
  const startedAtMonotonic = now();
  const operation = operationFor(config);

  try {
    const response = await axios.request<T>(config);
    const timing: NetworkRequestTiming = {
      operation,
      endpoint: config.url,
      startedAt,
      durationMs: roundDuration(now() - startedAtMonotonic),
      status: "success",
      ...(id ? { requestId: id } : {}),
    };
    attachTiming(response, timing, { symbol: AXIOS_TIMING });
    onRequest?.(timing);
    return { response, timing };
  } catch (err) {
    const timing: NetworkRequestTiming = {
      operation,
      endpoint: config.url,
      startedAt,
      durationMs: roundDuration(now() - startedAtMonotonic),
      status: "error",
      error: safeErrorMessage(err),
      ...(id ? { requestId: id } : {}),
    };
    attachTiming(err, timing, { symbol: AXIOS_TIMING });
    onRequest?.(timing);
    throw err;
  }
}

/** Options for {@link installAxiosTiming}. */
export interface InstallAxiosTimingOptions {
  /** Listener invoked after every timed axios request completes. */
  onRequest?: NetworkTimingListener;
  /** Whether to attach timing metadata to responses/errors. Default: true. */
  attachToResponse?: boolean;
}

/**
 * Installs global axios interceptors that attach timing metadata to every
 * axios request in the current axios instance.
 *
 * This is opt-in and must be called explicitly; it is never installed
 * implicitly. The returned function removes the interceptors.
 *
 * @param options - Listener and attach behavior.
 * @returns A function that uninstalls the interceptors.
 */
export function installAxiosTiming(options: InstallAxiosTimingOptions = {}): () => void {
  const attachToResponse = options.attachToResponse ?? true;

  const requestInterceptorId = axios.interceptors.request.use((config) => {
    (config as ConfigWithStart)[AXIOS_START] = {
      epoch: epochMs(),
      monotonic: now(),
    };
    return config;
  });

  const responseInterceptorId = axios.interceptors.response.use(
    (response) => {
      const start = (response.config as ConfigWithStart)[AXIOS_START];
      const timing: NetworkRequestTiming = {
        operation: operationFor(response.config),
        endpoint: response.config.url,
        startedAt: start?.epoch ?? Date.now(),
        durationMs: roundDuration(now() - (start?.monotonic ?? now())),
        status: "success",
        requestId: requestIdFromConfig(response.config),
      };
      if (attachToResponse) {
        attachTiming(response, timing, { symbol: AXIOS_TIMING });
      }
      options.onRequest?.(timing);
      return response;
    },
    (error) => {
      const start = (error?.config as ConfigWithStart | undefined)?.[AXIOS_START];
      const timing: NetworkRequestTiming = {
        operation: operationFor(error?.config ?? {}),
        endpoint: error?.config?.url,
        startedAt: start?.epoch ?? Date.now(),
        durationMs: roundDuration(now() - (start?.monotonic ?? now())),
        status: "error",
        error: safeErrorMessage(error),
        requestId: requestIdFromConfig(error?.config),
      };
      if (attachToResponse) {
        attachTiming(error, timing, { symbol: AXIOS_TIMING });
      }
      options.onRequest?.(timing);
      return Promise.reject(error);
    }
  );

  return () => {
    axios.interceptors.request.eject(requestInterceptorId);
    axios.interceptors.response.eject(responseInterceptorId);
  };
}
