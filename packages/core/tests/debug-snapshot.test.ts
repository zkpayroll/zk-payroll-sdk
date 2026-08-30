import {
  createDebugSnapshot,
  verifyDebugSnapshot,
  redactDebugData,
  buildDebugSensitiveKeys,
  DEBUG_SNAPSHOT_PLACEHOLDER,
  DEBUG_SNAPSHOT_CIRCULAR_MARKER,
} from "../src/debug";
import { ValidationError } from "../src/core/errors";
import { detectEnvironment } from "../src/env";

const SECRET = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RECIPIENT = "GDWZGV6WXZNDDPX3XKJFWQBJFNJ2GZJ2P7BXGY2YH7G4PY4QZ7NQOQZ4";

const PRIVATE_STATE = {
  networkUrl: "https://soroban-testnet.stellar.org",
  contractId: "CCONTRACTIDEXAMPLE123",
  balance: {
    recipient: RECIPIENT,
    amount: 100_000_000n,
    salaryAmount: 250_000_000n,
  },
  signer: {
    privateKey: SECRET,
    secretKey: SECRET,
  },
  payroll: {
    employer: "ACME Corp",
    employee: "Jane Doe",
    commitment: "0xabcd",
  },
};

describe("createDebugSnapshot", () => {
  it("captures config and state while redacting sensitive payroll fields", async () => {
    const { snapshot, redactedFieldCount, redactedKeys } = await createDebugSnapshot({
      config: { networkUrl: "https://soroban-testnet.stellar.org", contractId: "C123" },
      state: {
        privateKey: SECRET,
        amount: 500n,
        recipient: "G...",
        networkUrl: "https://soroban-testnet.stellar.org",
      },
    });

    expect(redactedFieldCount).toBeGreaterThanOrEqual(3);
    expect(redactedKeys).toEqual(expect.arrayContaining(["privateKey", "amount", "recipient"]));

    const configSection = snapshot.sections.find((s) => s.key === "config");
    const stateSection = snapshot.sections.find((s) => s.key === "state");

    expect(configSection!.data).toEqual({
      networkUrl: "https://soroban-testnet.stellar.org",
      contractId: "C123",
    });
    expect(stateSection!.data.privateKey).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(stateSection!.data.amount).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(stateSection!.data.recipient).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(stateSection!.data.networkUrl).toBe("https://soroban-testnet.stellar.org");
  });

  it("never leaks private payroll values when serialized", async () => {
    const { snapshot } = await createDebugSnapshot({
      config: { networkUrl: "https://soroban-testnet.stellar.org" },
      state: PRIVATE_STATE,
    });

    const json = JSON.stringify(snapshot);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(RECIPIENT);
    expect(json).not.toContain("ACME Corp");
    expect(json).not.toContain("Jane Doe");
    expect(json).not.toContain("100000000");
  });

  it("redacts nested and array values", async () => {
    const { snapshot } = await createDebugSnapshot({
      state: {
        employees: [
          { name: "Alice", salary: 300n, privateKey: SECRET },
          { name: "Bob", salary: 200n },
        ],
      },
    });

    const stateSection = snapshot.sections.find((s) => s.key === "state")!;
    expect(stateSection.data.employees).toEqual([
      { name: "Alice", salary: DEBUG_SNAPSHOT_PLACEHOLDER, privateKey: DEBUG_SNAPSHOT_PLACEHOLDER },
      { name: "Bob", salary: DEBUG_SNAPSHOT_PLACEHOLDER },
    ]);
    expect(snapshot.redaction.redactedFieldCount).toBe(3);
  });

  it("matches sensitive keys case-insensitively", async () => {
    const { snapshot } = await createDebugSnapshot({
      state: { PRIVATEKEY: SECRET, Amount: 5n, sAlArY: 10n },
    });
    const stateSection = snapshot.sections.find((s) => s.key === "state")!;
    expect(stateSection.data.PRIVATEKEY).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(stateSection.data.Amount).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(stateSection.data["sAlArY"]).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
  });

  it("honors additional sensitive keys", async () => {
    const { snapshot } = await createDebugSnapshot({
      state: { customerRef: "ACME-42", note: "hello" },
      additionalSensitiveKeys: ["customerRef"],
    });
    const stateSection = snapshot.sections.find((s) => s.key === "state")!;
    expect(stateSection.data.customerRef).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(stateSection.data.note).toBe("hello");
  });

  it("converts BigInt values to strings so the snapshot is JSON-safe", async () => {
    const { snapshot } = await createDebugSnapshot({
      state: { total: 250_000_000n, nested: { delta: -5n } },
    });
    const stateSection = snapshot.sections.find((s) => s.key === "state")!;
    expect(stateSection.data.total).toBe("250000000");
    expect((stateSection.data.nested as Record<string, unknown>).delta).toBe("-5");
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it("serializes dates, maps, sets, and typed arrays", async () => {
    const { snapshot } = await createDebugSnapshot({
      state: {
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        tags: new Set(["a", "b"]),
        meta: new Map([["k", "v"]]),
        raw: new Uint8Array([1, 2, 255]),
      },
    });
    const stateSection = snapshot.sections.find((s) => s.key === "state")!;
    expect(stateSection.data.createdAt).toBe("2026-01-02T03:04:05.000Z");
    expect(stateSection.data.tags).toEqual(["a", "b"]);
    expect(stateSection.data.meta).toEqual({ k: "v" });
    expect(stateSection.data.raw).toBe("0102ff");
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it("replaces circular references instead of recursing forever", async () => {
    const circular: Record<string, unknown> = { name: "node" };
    circular.self = circular;

    const { snapshot } = await createDebugSnapshot({ state: circular });
    const stateSection = snapshot.sections.find((s) => s.key === "state")!;
    expect(stateSection.data.self).toBe(DEBUG_SNAPSHOT_CIRCULAR_MARKER);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it("includes a runtime section by default", async () => {
    const { snapshot } = await createDebugSnapshot();
    const runtime = snapshot.sections.find((s) => s.key === "runtime")!;
    expect(runtime.status).toBe("success");
    expect(runtime.data.environment).toBe(detectEnvironment().environment);
    expect(runtime.data.capabilities).toContain("rpc_call");
    if (runtime.data.nodeVersion) {
      expect(runtime.data.nodeVersion).toMatch(/^v\d+/);
    }
  });

  it("omits the runtime section when includeEnvironment is false", async () => {
    const { snapshot } = await createDebugSnapshot({ includeEnvironment: false });
    expect(snapshot.sections.find((s) => s.key === "runtime")).toBeUndefined();
  });

  it("includes a memory section when requested (node runtime)", async () => {
    const { snapshot } = await createDebugSnapshot({ includeMemory: true });
    const memory = snapshot.sections.find((s) => s.key === "memory")!;
    expect(memory.status).toBe("success");
    expect(typeof memory.data.heapUsedMB).toBe("number");
    expect(typeof memory.data.rssMB).toBe("number");
  });

  it("adds warning sections when no state or config is supplied", async () => {
    const { snapshot } = await createDebugSnapshot({ includeEnvironment: false });
    const config = snapshot.sections.find((s) => s.key === "config")!;
    const state = snapshot.sections.find((s) => s.key === "state")!;
    expect(config.status).toBe("warning");
    expect(state.status).toBe("warning");
    expect(snapshot.redaction.redactedFieldCount).toBe(0);
  });

  it("uses the provided snapshotId and sdkVersion", async () => {
    const { snapshot } = await createDebugSnapshot({
      snapshotId: "run_custom",
      sdkVersion: "9.9.9",
      includeEnvironment: false,
    });
    expect(snapshot.snapshotId).toBe("run_custom");
    expect(snapshot.sdkVersion).toBe("9.9.9");
  });

  it("throws a ValidationError for non-plain-object state or config", async () => {
    await expect(createDebugSnapshot({ state: "oops" as never })).rejects.toThrow(ValidationError);
    await expect(createDebugSnapshot({ config: [1, 2] as never })).rejects.toThrow(ValidationError);
  });

  it("generates a 64-char hex integrity hash that verifies", async () => {
    const { snapshot } = await createDebugSnapshot({
      config: { networkUrl: "https://example.com" },
      state: { privateKey: SECRET },
    });
    expect(snapshot.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyDebugSnapshot(snapshot)).resolves.toBe(true);
  });

  it("detects tampering via the integrity hash", async () => {
    const { snapshot } = await createDebugSnapshot({ includeEnvironment: false });
    const tampered = {
      ...snapshot,
      sections: snapshot.sections.map((s) => ({ ...s })),
    };
    (tampered.sections[0].data as Record<string, unknown>).extra = "tampered";
    await expect(verifyDebugSnapshot(tampered)).resolves.toBe(false);
  });

  it("produces a different integrity hash when captured state differs", async () => {
    const a = await createDebugSnapshot({
      includeEnvironment: false,
      state: { note: "one" },
    });
    const b = await createDebugSnapshot({
      includeEnvironment: false,
      state: { note: "two" },
    });
    expect(a.snapshot.integrityHash).not.toBe(b.snapshot.integrityHash);
  });
});

describe("redactDebugData", () => {
  it("returns redacted data plus redaction summaries", () => {
    const { redactedData, redactedFieldCount, redactedKeys } = redactDebugData({
      recipient: "G...",
      amount: 123n,
    });
    expect(redactedData.recipient).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(redactedData.amount).toBe(DEBUG_SNAPSHOT_PLACEHOLDER);
    expect(redactedFieldCount).toBe(2);
    expect(redactedKeys.sort()).toEqual(["amount", "recipient"]);
  });

  it("leaves non-sensitive data untouched", () => {
    const { redactedData, redactedFieldCount, redactedKeys } = redactDebugData({
      networkUrl: "https://example.com",
      contractId: "C123",
    });
    expect(redactedData).toEqual({
      networkUrl: "https://example.com",
      contractId: "C123",
    });
    expect(redactedFieldCount).toBe(0);
    expect(redactedKeys).toEqual([]);
  });
});

describe("buildDebugSensitiveKeys", () => {
  it("includes built-in payroll defaults and merges additional keys", () => {
    const keys = buildDebugSensitiveKeys(["customerRef"]);
    expect(keys).toEqual(expect.arrayContaining(["privateKey", "salaryAmount", "customerRef"]));
    expect(keys).toEqual(expect.arrayContaining(["recipient", "amount", "witness"]));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
