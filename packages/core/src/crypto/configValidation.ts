import { ProofGeneratorConfig } from "./IProofGenerator";
import { ValidationError } from "../errors";

/**
 * Validates a ProofGeneratorConfig object to ensure proof artifacts (WASM, ZKEY)
 * are properly configured. Throws a ValidationError if a configuration is missing
 * or malformed.
 *
 * @param config The ProofGeneratorConfig to validate
 */
export function validateProofConfig(config: ProofGeneratorConfig): void {
  const wasmUrl = config.wasmSource
    ? config.wasmSource.type === "local"
      ? config.wasmSource.path
      : config.wasmSource.url
    : config.wasmUrl;

  const zkeyUrl = config.zkeySource
    ? config.zkeySource.type === "local"
      ? config.zkeySource.path
      : config.zkeySource.url
    : config.zkeyUrl;

  if (!wasmUrl || typeof wasmUrl !== "string" || wasmUrl.trim() === "") {
    throw new ValidationError("Missing or empty WASM configuration", "wasmUrl");
  }

  if (!zkeyUrl || typeof zkeyUrl !== "string" || zkeyUrl.trim() === "") {
    throw new ValidationError("Missing or empty ZKEY configuration", "zkeyUrl");
  }

  const validateFormat = (url: string, fieldName: string) => {
    // If it's a remote URL, ensure it is fully parseable
    if (/^https?:\/\//i.test(url)) {
      try {
        new URL(url);
      } catch {
        throw new ValidationError(
          `Malformed ${fieldName.replace("Url", "").toUpperCase()} URL`,
          fieldName
        );
      }
    }
    // Note: Local paths are kept flexible to allow relative or absolute file paths.
  };

  validateFormat(wasmUrl, "wasmUrl");
  validateFormat(zkeyUrl, "zkeyUrl");
}
