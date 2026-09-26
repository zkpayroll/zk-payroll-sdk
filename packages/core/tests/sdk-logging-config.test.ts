import {
  createHookLogger,
  createNullLogger,
  createConsoleLogger,
  normalizeSdkLogger,
  setSdkLogger,
  getSdkLogger,
  resetSdkLogger,
  LogEvent,
} from "../src/logging/SdkLogger";

describe("configurable SDK logging interface (Issue #476)", () => {
  beforeEach(() => {
    resetSdkLogger();
  });

  afterEach(() => {
    resetSdkLogger();
  });

  describe("default logger", () => {
    it("provides a silent logger before any configuration", () => {
      const logger = getSdkLogger();
      expect(() => {
        logger.info("boot");
        logger.warn("boot_warn");
        logger.error("boot_error");
      }).not.toThrow();
    });
  });

  describe("setSdkLogger with a hook function", () => {
    it("routes entries to the host hook", () => {
      const entries: LogEvent[] = [];
      setSdkLogger((entry) => entries.push(entry));

      getSdkLogger().info("payment_start", { txHash: "0xabc" });

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ event: "payment_start", level: "info" });
      expect(typeof entries[0].timestamp).toBe("string");
    });

    it("never exposes sensitive payroll values to the host logger", () => {
      const entries: LogEvent[] = [];
      setSdkLogger((entry) => entries.push(entry));

      getSdkLogger().info("payment_start", {
        recipient: "GABC123",
        amount: 1000n,
        privateKey: "secret",
        txHash: "0xabc",
      });

      expect(entries[0].context).toMatchObject({
        recipient: "[redacted]",
        amount: "[redacted]",
        privateKey: "[redacted]",
        txHash: "0xabc",
      });
    });
  });

  describe("setSdkLogger with logger objects", () => {
    it("accepts a full SdkLogger", () => {
      const entries: LogEvent[] = [];
      const inner = createHookLogger((e) => entries.push(e));

      setSdkLogger(inner);
      getSdkLogger().warn("slow_rpc", { latencyMs: 1200 });

      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe("slow_rpc");
    });

    it("accepts a bare { info, warn, error } object", () => {
      const calls: Array<{ event: string; context?: Record<string, unknown> }> = [];
      const bareLogger: { info: (event: string, context?: Record<string, unknown>) => void; warn: (event: string, context?: Record<string, unknown>) => void; error: (event: string, context?: Record<string, unknown>) => void } = {
        info: (event, context) => calls.push({ event, context }),
        warn: (event, context) => calls.push({ event, context }),
        error: (event, context) => calls.push({ event, context }),
      };
      setSdkLogger(bareLogger);

      getSdkLogger().error("payment_failed", { recipient: "GABC", code: "X" });

      expect(calls).toHaveLength(1);
      expect(calls[0].context?.recipient).toBe("[redacted]");
      expect(calls[0].context?.code).toBe("X");
    });

    it("throws a TypeError for invalid input", () => {
      expect(() => setSdkLogger(undefined as never)).toThrow(TypeError);
      expect(() => setSdkLogger("logger" as never)).toThrow(TypeError);
      expect(() => setSdkLogger({} as never)).toThrow(TypeError);
      expect(() => normalizeSdkLogger(42 as never)).toThrow(TypeError);
    });
  });

  describe("resetSdkLogger", () => {
    it("restores the silent default so tests do not leak global state", () => {
      const entries: LogEvent[] = [];
      setSdkLogger((entry) => entries.push(entry));
      resetSdkLogger();

      getSdkLogger().info("after_reset");
      expect(entries).toHaveLength(0);
    });
  });

  describe("createNullLogger", () => {
    it("discards every entry without throwing", () => {
      const logger = createNullLogger();
      expect(() => {
        logger.info("a", { recipient: "G" });
        logger.warn("b");
        logger.error("c", { amount: 1n });
      }).not.toThrow();
    });
  });

  describe("createConsoleLogger", () => {
    it("forwards redacted entries to the console target", () => {
      const infos: unknown[][] = [];
      const warns: unknown[][] = [];
      const errors: unknown[][] = [];
      const logger = createConsoleLogger({
        info: (...args: unknown[]) => infos.push(args),
        warn: (...args: unknown[]) => warns.push(args),
        error: (...args: unknown[]) => errors.push(args),
      });

      logger.info("payment_start", { recipient: "GABC123", txHash: "0x1" });
      logger.warn("slow_rpc");
      logger.error("payment_failed", { amount: 500n });

      expect(infos).toHaveLength(1);
      expect(String(infos[0][0])).toContain("payment_start");
      expect(infos[0][1]).toMatchObject({ recipient: "[redacted]", txHash: "0x1" });
      expect(warns).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0][1]).toMatchObject({ amount: "[redacted]" });
    });
  });

  describe("createHookLogger redaction (Issue #476 edge case)", () => {
    it("redacts sensitive context before invoking the hook", () => {
      const entries: LogEvent[] = [];
      const logger = createHookLogger((e) => entries.push(e));

      logger.info("evt", { witness: { a: 1 }, method: "private_pay" });

      expect(entries[0].context).toMatchObject({
        witness: "[redacted]",
        method: "private_pay",
      });
    });

    it("still emits on the EventEmitter interface", () => {
      const logger = createHookLogger(() => undefined);
      const seen: LogEvent[] = [];
      logger.on("log", (entry: LogEvent) => seen.push(entry));

      logger.info("evt");
      expect(seen).toHaveLength(1);
    });
  });
});
