import { BinaryWriter } from "./BinaryWriter";
import { BinaryReader } from "./BinaryReader";
import { SerializationError } from "./errors";
import { PayloadTypeTag, SERIALIZATION_FORMAT_VERSION } from "./proofSerialization";
import type {
  PayrollRequest,
  PayrollRequestEntry,
  SubmissionContext,
} from "../request/types";

function writeHeader(writer: BinaryWriter, tag: number): void {
  writer.writeUint8(SERIALIZATION_FORMAT_VERSION).writeUint8(tag);
}

function readHeader(reader: BinaryReader, expectedTag: number): void {
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

/**
 * Validates a payroll command entry against the contract's expectations.
 *
 * Mirrors `PayrollRequestBuilder` validation (non-empty recipient, positive
 * amount, non-empty asset) so invalid payloads fail at encode time with a
 * clear error instead of being rejected opaquely on-chain.
 */
function assertValidCommandEntry(entry: PayrollRequestEntry, where: string): void {
  if (entry === null || typeof entry !== "object") {
    throw new SerializationError(
      `${where} must be a payroll command entry object.`,
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  if (typeof entry.recipient !== "string" || entry.recipient.trim() === "") {
    throw new SerializationError(
      `${where} has an invalid recipient: a non-empty address string is required.`,
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  if (typeof entry.amount !== "bigint" || entry.amount <= 0n) {
    throw new SerializationError(
      `${where} has an invalid amount: a positive bigint is required.`,
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  if (typeof entry.asset !== "string" || entry.asset.trim() === "") {
    throw new SerializationError(
      `${where} has an invalid asset: a non-empty asset identifier is required.`,
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  if (entry.memo !== undefined && typeof entry.memo !== "string") {
    throw new SerializationError(
      `${where} has an invalid memo: expected a string.`,
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
}

function writeEntryFields(writer: BinaryWriter, entry: PayrollRequestEntry): void {
  writer.writeString(entry.recipient).writeBigInt(entry.amount).writeString(entry.asset);
  if (entry.memo === undefined) {
    writer.writeBool(false);
  } else {
    writer.writeBool(true).writeString(entry.memo);
  }
}

function readEntryFields(reader: BinaryReader): PayrollRequestEntry {
  const recipient = reader.readString();
  const amount = reader.readBigInt();
  const asset = reader.readString();
  const hasMemo = reader.readBool();
  const memo = hasMemo ? reader.readString() : undefined;
  const entry: PayrollRequestEntry =
    memo === undefined ? { recipient, amount, asset } : { recipient, amount, asset, memo };
  return entry;
}

function writeOptionalString(writer: BinaryWriter, value: string | undefined): void {
  if (value === undefined) {
    writer.writeBool(false);
  } else {
    writer.writeBool(true).writeString(value);
  }
}

function readOptionalString(reader: BinaryReader): string | undefined {
  return reader.readBool() ? reader.readString() : undefined;
}

/**
 * Encodes a single {@link PayrollRequestEntry} (a payroll command payload)
 * into a binary-safe buffer.
 *
 * @throws {SerializationError} when the entry violates contract expectations
 *   (empty recipient, non-positive amount, missing asset).
 */
export function encodePayrollCommandEntry(entry: PayrollRequestEntry): Uint8Array {
  assertValidCommandEntry(entry, "Payroll command entry");
  const writer = new BinaryWriter();
  writeHeader(writer, PayloadTypeTag.PAYROLL_COMMAND_ENTRY);
  writeEntryFields(writer, entry);
  return writer.toBytes();
}

/**
 * Decodes a buffer produced by {@link encodePayrollCommandEntry}.
 *
 * Structural problems (truncation, version/tag mismatch, trailing bytes)
 * and contract violations (empty recipient, non-positive amount, missing
 * asset) all throw {@link SerializationError}.
 */
export function decodePayrollCommandEntry(bytes: Uint8Array): PayrollRequestEntry {
  const reader = new BinaryReader(bytes);
  readHeader(reader, PayloadTypeTag.PAYROLL_COMMAND_ENTRY);
  const entry = readEntryFields(reader);
  reader.assertExhausted();
  assertValidCommandEntry(entry, "Decoded payroll command entry");
  return entry;
}

/**
 * Encodes a full {@link PayrollRequest} (entries, idempotency keys, and
 * submission context) into a binary-safe buffer.
 *
 * @throws {SerializationError} when the request is empty, entries violate
 *   contract expectations, or idempotency keys do not line up with entries.
 */
export function encodePayrollRequest(request: PayrollRequest): Uint8Array {
  if (request === null || typeof request !== "object") {
    throw new SerializationError(
      "Payroll request must be an object with entries, idempotencyKeys, and context.",
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  if (!Array.isArray(request.entries) || request.entries.length === 0) {
    throw new SerializationError(
      "Payroll request must contain at least one payment entry.",
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  if (!Array.isArray(request.idempotencyKeys) || request.idempotencyKeys.length !== request.entries.length) {
    throw new SerializationError(
      "Payroll request idempotencyKeys must line up one-to-one with entries.",
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  request.entries.forEach((entry, i) => assertValidCommandEntry(entry, `Entry ${i}`));

  const context: SubmissionContext = request.context ?? {};
  for (const [field, value] of Object.entries(context) as Array<[string, unknown]>) {
    if (value !== undefined && typeof value !== "string") {
      throw new SerializationError(
        `Payroll request context.${field} must be a string when present.`,
        "SERIALIZATION_VALIDATION_FAILED"
      );
    }
  }

  const writer = new BinaryWriter();
  writeHeader(writer, PayloadTypeTag.PAYROLL_REQUEST);
  writer.writeUint32(request.entries.length);
  for (const entry of request.entries) {
    writeEntryFields(writer, entry);
  }
  writeOptionalString(writer, context.network);
  writeOptionalString(writer, context.contractId);
  writeOptionalString(writer, context.nonce);
  writer.writeStringArray(request.idempotencyKeys);
  return writer.toBytes();
}

/**
 * Decodes a buffer produced by {@link encodePayrollRequest}.
 *
 * @throws {SerializationError} on structural problems or when the decoded
 *   payload violates contract expectations.
 */
export function decodePayrollRequest(bytes: Uint8Array): PayrollRequest {
  const reader = new BinaryReader(bytes);
  readHeader(reader, PayloadTypeTag.PAYROLL_REQUEST);
  const count = reader.readUint32();
  if (count === 0) {
    throw new SerializationError(
      "Decoded payroll request must contain at least one payment entry.",
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  const entries: PayrollRequestEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(readEntryFields(reader));
  }
  const network = readOptionalString(reader);
  const contractId = readOptionalString(reader);
  const nonce = readOptionalString(reader);
  const idempotencyKeys = reader.readStringArray();
  reader.assertExhausted();

  const context: SubmissionContext = {};
  if (network !== undefined) context.network = network;
  if (contractId !== undefined) context.contractId = contractId;
  if (nonce !== undefined) context.nonce = nonce;
  const request: PayrollRequest = { entries, idempotencyKeys, context };

  if (idempotencyKeys.length !== entries.length) {
    throw new SerializationError(
      "Decoded payroll request idempotencyKeys must line up one-to-one with entries.",
      "SERIALIZATION_VALIDATION_FAILED"
    );
  }
  entries.forEach((entry, i) => assertValidCommandEntry(entry, `Decoded entry ${i}`));
  return request;
}
