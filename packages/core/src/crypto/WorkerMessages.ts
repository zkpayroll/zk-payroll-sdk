import type { ProofPayload, ProofGeneratorConfig } from "./IProofGenerator";
import type { PayrollProgressEvent } from "../progress";

/**
 * Stages emitted as proof generation progresses inside the worker.
 */
export type ProofProgressStage = "loading_wasm" | "loading_zkey" | "generating" | "done";

/**
 * Messages sent from the main thread to the proof worker.
 */
export type WorkerRequest =
  | {
      type: "GENERATE_PROOF";
      id: string;
      witness: Record<string, unknown>;
      config: ProofGeneratorConfig;
    }
  | {
      type: "PRELOAD_ARTIFACTS";
      id: string;
      config: ProofGeneratorConfig;
    }
  | {
      type: "CLEAR_CACHE";
      id: string;
    };

/**
 * Messages sent from the proof worker back to the main thread.
 */
export type WorkerResponse =
  | { type: "PROOF_RESULT"; id: string; payload: ProofPayload }
  | { type: "PROOF_ERROR"; id: string; message: string }
  | {
      type: "PROGRESS";
      id: string;
      stage?: ProofProgressStage;
      progress?: number;
      event?: PayrollProgressEvent;
    }
  | { type: "PRELOAD_DONE"; id: string }
  | { type: "CACHE_CLEARED"; id: string };
