import { ProofGeneratorConfig } from "./IProofGenerator";
import { validateProofConfig } from "./configValidation";

export interface ProofConfigResolverOptions extends Partial<ProofGeneratorConfig> {
  /** Optional directory path containing default .wasm and .zkey files */
  artifactDir?: string;
}

/**
 * Resolves ProofGeneratorConfig from explicit overrides, environment variables,
 * or local file default paths, and validates the resulting configuration.
 *
 * Priority / Precedence order:
 * 1. Explicit overrides passed in `options` (wasmSource/zkeySource or wasmUrl/zkeyUrl)
 * 2. Environment variables:
 *    - `ZK_PAYROLL_WASM_PATH` / `ZK_PAYROLL_WASM_URL`
 *    - `ZK_PAYROLL_ZKEY_PATH` / `ZK_PAYROLL_ZKEY_URL`
 *    - `ZK_PAYROLL_EXPECTED_WASM_HASH`
 *    - `ZK_PAYROLL_EXPECTED_ZKEY_HASH`
 *    - `ZK_PAYROLL_ARTIFACT_DIR`
 * 3. Default fallback paths (`./circuits/payroll.wasm` and `./circuits/payroll.zkey`)
 *
 * @param options - Explicit configuration options or overrides
 * @param env - Environment variables dictionary (defaults to `process.env` in Node)
 * @returns A fully validated ProofGeneratorConfig object
 * @throws ValidationError if configuration is missing, empty, or malformed
 */
export function resolveProofConfig(
  options: ProofConfigResolverOptions = {},
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {},
): ProofGeneratorConfig {
  const artifactDir =
    options.artifactDir || env.ZK_PAYROLL_ARTIFACT_DIR || "./circuits";

  const wasmUrl =
    options.wasmUrl ||
    env.ZK_PAYROLL_WASM_PATH ||
    env.ZK_PAYROLL_WASM_URL ||
    `${artifactDir}/payroll.wasm`;

  const zkeyUrl =
    options.zkeyUrl ||
    env.ZK_PAYROLL_ZKEY_PATH ||
    env.ZK_PAYROLL_ZKEY_URL ||
    `${artifactDir}/payroll.zkey`;

  const expectedWasmHash =
    options.expectedWasmHash || env.ZK_PAYROLL_EXPECTED_WASM_HASH;
  const expectedZkeyHash =
    options.expectedZkeyHash || env.ZK_PAYROLL_EXPECTED_ZKEY_HASH;

  const resolvedConfig: ProofGeneratorConfig = {
    wasmUrl,
    zkeyUrl,
    ...(options.wasmSource ? { wasmSource: options.wasmSource } : {}),
    ...(options.zkeySource ? { zkeySource: options.zkeySource } : {}),
    ...(expectedWasmHash ? { expectedWasmHash } : {}),
    ...(expectedZkeyHash ? { expectedZkeyHash } : {}),
    ...(options.artifactCacheTTL !== undefined
      ? { artifactCacheTTL: options.artifactCacheTTL }
      : {}),
    ...(options.maxConcurrency !== undefined
      ? { maxConcurrency: options.maxConcurrency }
      : {}),
  };

  // Validate the resolved config to guarantee correctness before returning
  validateProofConfig(resolvedConfig);

  return resolvedConfig;
}

/**
 * Resolves proof configuration directly from environment variables.
 *
 * @param env - Environment variables dictionary
 * @returns Fully validated ProofGeneratorConfig object
 */
export function resolveProofConfigFromEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {},
): ProofGeneratorConfig {
  return resolveProofConfig({}, env);
}
