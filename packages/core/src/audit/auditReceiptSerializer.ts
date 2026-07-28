export interface AuditReceipt {
  receiptId: string;
  payrollId: string;
  timestamp: string;
  totalAmount: string;
  currency: string;
  recipientCount: number;
  viewKeyId?: string;
  complianceHash: string;
  redacted: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuditReceiptSerializeOptions {
  redactPII?: boolean;
  pretty?: boolean;
}

/**
 * Validate that an unknown object conforms to the AuditReceipt interface shape.
 */
export function validateAuditReceiptShape(data: unknown): data is AuditReceipt {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  return (
    typeof obj.receiptId === "string" &&
    typeof obj.payrollId === "string" &&
    typeof obj.timestamp === "string" &&
    typeof obj.totalAmount === "string" &&
    typeof obj.currency === "string" &&
    typeof obj.recipientCount === "number" &&
    typeof obj.complianceHash === "string" &&
    typeof obj.redacted === "boolean"
  );
}

/**
 * Serialize an AuditReceipt into a canonical JSON string for audit/compliance storage.
 */
export function serializeAuditReceipt(
  receipt: AuditReceipt,
  options: AuditReceiptSerializeOptions = {}
): string {
  if (!validateAuditReceiptShape(receipt)) {
    throw new Error("Invalid AuditReceipt shape provided for serialization");
  }

  const copy: AuditReceipt = { ...receipt };

  if (options.redactPII) {
    copy.redacted = true;
    if (copy.metadata) {
      const sanitizedMeta: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(copy.metadata)) {
        if (!/name|email|ssn|address|pii/i.test(key)) {
          sanitizedMeta[key] = value;
        } else {
          sanitizedMeta[key] = "[REDACTED]";
        }
      }
      copy.metadata = sanitizedMeta;
    }
  }

  return options.pretty ? JSON.stringify(copy, null, 2) : JSON.stringify(copy);
}

/**
 * Deserialize a JSON string into a validated AuditReceipt.
 */
export function deserializeAuditReceipt(serialized: string): AuditReceipt {
  try {
    const parsed = JSON.parse(serialized);
    if (!validateAuditReceiptShape(parsed)) {
      throw new Error("Parsed JSON does not match required AuditReceipt schema");
    }
    return parsed;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("AuditReceipt schema")) {
      throw err;
    }
    throw new Error(`Failed to deserialize AuditReceipt: ${(err as Error).message}`);
  }
}
