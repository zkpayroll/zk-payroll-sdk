import { BinaryWriter } from "./BinaryWriter";
import { BinaryReader } from "./BinaryReader";
import { SerializationError } from "./errors";
import { ProofPayload } from "../crypto/IProofGenerator";
import { ProofStruct } from "../clients/types";

/** Current binary wire-format version. Bump on breaking layout changes. */
export const SERIALIZATION_FORMAT_VERSION = 1;

/**
 * Single-byte tags identifying which payload shape follows the version
 * byte. Decoders verify the tag matches the type they were asked to
 * decode, so a buffer encoded as one payload kind can't silently be
 * misread as another.
 */
export const PayloadTypeTag = {
  PROOF_PAYLOAD: 0x01,
  PROOF_STRUCT: 0x02,
  COMMITMENT_ENTRY: 0x03,
  COMMIT_REQUEST: 0x04,
  PAYROLL_COMMAND_ENTRY: 0x05,
  PAYROLL_REQUEST: 0x06,
} as const;

export type PayloadTypeTagValue = (typeof PayloadTypeTag)[keyof typeof PayloadTypeTag];

function writeHeader(writer: BinaryWriter, tag: PayloadTypeTagValue): void {
  writer.writeUint8(SERIALIZATION_FORMAT_VERSION).writeUint8(tag);
}

function readHeader(reader: BinaryReader, expectedTag: PayloadTypeTagValue): void {
  const version = reader.readUint8();
  if (version !== SERIALIZATION_FORMAT_VERSION) {
    throw new SerializationError(
      `Unsupported serialization format version ${version} (expected ${SERIALIZATION_FORMAT_VERSION}).`,
      "SERIALIZATION_VERSION_MISMATCH"
    );
  }
  const tag = reader.readUint8();
  if (tag !== expectedTag) {
    throw new SerializationError(
      `Payload type tag mismatch: expected 0x${expectedTag.toString(16)}, got 0x${tag.toString(16)}.`,
      "SERIALIZATION_TYPE_MISMATCH"
    );
  }
}

/** Writes the shared Groth16 proof triple (pi_a, pi_b, pi_c) as field-element strings. */
function writeProofTriple(
  writer: BinaryWriter,
  pi_a: [string, string],
  pi_b: [[string, string], [string, string]],
  pi_c: [string, string]
): void {
  writer.writeString(pi_a[0]).writeString(pi_a[1]);
  writer.writeString(pi_b[0][0]).writeString(pi_b[0][1]);
  writer.writeString(pi_b[1][0]).writeString(pi_b[1][1]);
  writer.writeString(pi_c[0]).writeString(pi_c[1]);
}

function readProofTriple(reader: BinaryReader): {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
} {
  const pi_a: [string, string] = [reader.readString(), reader.readString()];
  const pi_b: [[string, string], [string, string]] = [
    [reader.readString(), reader.readString()],
    [reader.readString(), reader.readString()],
  ];
  const pi_c: [string, string] = [reader.readString(), reader.readString()];
  return { pi_a, pi_b, pi_c };
}

/**
 * Encodes a {@link ProofPayload} (the snarkjs-shaped proof, including
 * protocol/curve metadata) into a binary-safe buffer.
 */
export function encodeProofPayload(payload: ProofPayload): Uint8Array {
  const writer = new BinaryWriter();
  writeHeader(writer, PayloadTypeTag.PROOF_PAYLOAD);
  writeProofTriple(writer, payload.proof.pi_a, payload.proof.pi_b, payload.proof.pi_c);
  writer.writeString(payload.proof.protocol);
  writer.writeString(payload.proof.curve);
  writer.writeStringArray(payload.publicSignals);
  return writer.toBytes();
}

/** Decodes a buffer produced by {@link encodeProofPayload} back into a {@link ProofPayload}. */
export function decodeProofPayload(bytes: Uint8Array): ProofPayload {
  const reader = new BinaryReader(bytes);
  readHeader(reader, PayloadTypeTag.PROOF_PAYLOAD);
  const { pi_a, pi_b, pi_c } = readProofTriple(reader);
  const protocol = reader.readString();
  const curve = reader.readString();
  const publicSignals = reader.readStringArray();
  reader.assertExhausted();
  return { proof: { pi_a, pi_b, pi_c, protocol, curve }, publicSignals };
}

/**
 * Encodes a {@link ProofStruct} (the client/contract-level proof shape,
 * without protocol/curve metadata) into a binary-safe buffer.
 */
export function encodeProofStruct(struct: ProofStruct): Uint8Array {
  const writer = new BinaryWriter();
  writeHeader(writer, PayloadTypeTag.PROOF_STRUCT);
  writeProofTriple(writer, struct.pi_a, struct.pi_b, struct.pi_c);
  writer.writeStringArray(struct.publicSignals);
  return writer.toBytes();
}

/** Decodes a buffer produced by {@link encodeProofStruct} back into a {@link ProofStruct}. */
export function decodeProofStruct(bytes: Uint8Array): ProofStruct {
  const reader = new BinaryReader(bytes);
  readHeader(reader, PayloadTypeTag.PROOF_STRUCT);
  const { pi_a, pi_b, pi_c } = readProofTriple(reader);
  const publicSignals = reader.readStringArray();
  reader.assertExhausted();
  return { pi_a, pi_b, pi_c, publicSignals };
}
