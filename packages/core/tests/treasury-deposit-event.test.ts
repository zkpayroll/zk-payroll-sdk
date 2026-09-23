import { xdr, nativeToScVal, Address, StrKey, Keypair } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../src/event-parser";
import { EventDecodingError } from "../src/events/types";
import {
  parseTreasuryDepositEvent,
  parseTreasuryDepositEvents,
  isTreasuryDepositEvent,
  formatTreasuryDepositSummary,
  redactAddress,
  TreasuryDepositEvent,
} from "../src/events/treasuryDeposit";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 5));
const TEST_DEPOSITOR = Keypair.random().publicKey();
const TEST_TOKEN_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));

function makeEventScValMap(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val,
        })
    )
  );
}

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function symbolScVal(name: string): xdr.ScVal {
  return nativeToScVal(name, { type: "symbol" });
}

function i128ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

function u64ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

describe("Treasury Deposit Event Parser", () => {
  describe("redactAddress", () => {
    it("redacts addresses to preserve privacy in logs", () => {
      expect(redactAddress(TEST_DEPOSITOR)).toBe(
        `${TEST_DEPOSITOR.slice(0, 3)}***${TEST_DEPOSITOR.slice(-3)}`
      );
      expect(redactAddress("short")).toBe("[REDACTED_ADDRESS]");
      expect(redactAddress("")).toBe("[ANONYMOUS]");
      expect(redactAddress(undefined)).toBe("[ANONYMOUS]");
    });
  });

  describe("parseTreasuryDepositEvent — success paths", () => {
    it("decodes a complete treasury_deposited event", () => {
      const raw: RawContractEvent = {
        topics: [
          symbolScVal("treasury_deposited"),
          addressScVal(TEST_DEPOSITOR),
          addressScVal(TEST_TOKEN_CONTRACT),
        ],
        data: makeEventScValMap({
          amount: i128ScVal(500_000_000n),
          memo: nativeToScVal("Q1_payroll_topup", { type: "string" }),
          deposited_at: u64ScVal(1700000500n),
        }),
        contractId: TEST_CONTRACT_ID,
        ledger: 104230,
        ledgerClosedAt: "2025-04-01T12:00:00Z",
      };

      const event = parseTreasuryDepositEvent(raw);
      expect(event.type).toBe("treasury_deposit");
      expect(event.depositor).toBe(TEST_DEPOSITOR);
      expect(event.asset).toBe(TEST_TOKEN_CONTRACT);
      expect(event.amount).toBe(500_000_000n);
      expect(event.memo).toBe("Q1_payroll_topup");
      expect(event.depositedAt).toBe(1700000500);
      expect(event.contractId).toBe(TEST_CONTRACT_ID);
      expect(event.ledger).toBe(104230);
      expect(event.timestamp).toBe("2025-04-01T12:00:00Z");
    });

    it("decodes treasury_deposit alias event name", () => {
      const raw: RawContractEvent = {
        topics: [symbolScVal("treasury_deposit"), addressScVal(TEST_DEPOSITOR)],
        data: makeEventScValMap({
          amount: i128ScVal(100_000_000n),
          deposited_at: u64ScVal(1700000600n),
        }),
      };

      const event = parseTreasuryDepositEvent(raw);
      expect(event.type).toBe("treasury_deposit");
      expect(event.depositor).toBe(TEST_DEPOSITOR);
      expect(event.asset).toBe("native");
      expect(event.amount).toBe(100_000_000n);
      expect(event.depositedAt).toBe(1700000600);
    });

    it("extracts depositor and asset from data map if omitted in topics", () => {
      const raw: RawContractEvent = {
        topics: [symbolScVal("treasury_deposited")],
        data: makeEventScValMap({
          depositor: addressScVal(TEST_DEPOSITOR),
          asset: addressScVal(TEST_TOKEN_CONTRACT),
          amount: i128ScVal(25_000_000n),
        }),
      };

      const event = parseTreasuryDepositEvent(raw);
      expect(event.depositor).toBe(TEST_DEPOSITOR);
      expect(event.asset).toBe(TEST_TOKEN_CONTRACT);
      expect(event.amount).toBe(25_000_000n);
    });
  });

  describe("parseTreasuryDepositEvent — error handling", () => {
    it("throws EventDecodingError for empty topics", () => {
      expect(() => parseTreasuryDepositEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toThrow(
        EventDecodingError
      );
    });

    it("throws EventDecodingError for unrecognized event name", () => {
      const raw: RawContractEvent = {
        topics: [symbolScVal("payment_executed")],
        data: xdr.ScVal.scvVoid(),
      };
      expect(() => parseTreasuryDepositEvent(raw)).toThrow(/expected "treasury_deposited"/i);
    });

    it("throws EventDecodingError when depositor address cannot be resolved", () => {
      const raw: RawContractEvent = {
        topics: [symbolScVal("treasury_deposited")],
        data: makeEventScValMap({
          amount: i128ScVal(100n),
        }),
      };
      expect(() => parseTreasuryDepositEvent(raw)).toThrow(/missing required depositor/i);
    });
  });

  describe("batch & helper functions", () => {
    it("isTreasuryDepositEvent returns true for deposit events, false otherwise", () => {
      const valid1: RawContractEvent = {
        topics: [symbolScVal("treasury_deposited")],
        data: xdr.ScVal.scvVoid(),
      };
      const valid2: RawContractEvent = {
        topics: [symbolScVal("treasury_deposit")],
        data: xdr.ScVal.scvVoid(),
      };
      const invalid: RawContractEvent = {
        topics: [symbolScVal("other_event")],
        data: xdr.ScVal.scvVoid(),
      };

      expect(isTreasuryDepositEvent(valid1)).toBe(true);
      expect(isTreasuryDepositEvent(valid2)).toBe(true);
      expect(isTreasuryDepositEvent(invalid)).toBe(false);
      expect(isTreasuryDepositEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
    });

    it("parseTreasuryDepositEvents parses multiple events", () => {
      const raw1: RawContractEvent = {
        topics: [symbolScVal("treasury_deposited"), addressScVal(TEST_DEPOSITOR)],
        data: makeEventScValMap({ amount: i128ScVal(1_000n) }),
      };
      const raw2: RawContractEvent = {
        topics: [symbolScVal("treasury_deposit"), addressScVal(TEST_DEPOSITOR)],
        data: makeEventScValMap({ amount: i128ScVal(2_000n) }),
      };

      const events = parseTreasuryDepositEvents([raw1, raw2]);
      expect(events).toHaveLength(2);
      expect(events[0].amount).toBe(1_000n);
      expect(events[1].amount).toBe(2_000n);
    });

    it("formatTreasuryDepositSummary produces formatted string with redaction options", () => {
      const event: TreasuryDepositEvent = {
        type: "treasury_deposit",
        depositor: TEST_DEPOSITOR,
        asset: "native",
        amount: 10_000_000n,
        memo: "payroll_funding",
        depositedAt: 1700000500,
        ledger: 54321,
      };

      const unredacted = formatTreasuryDepositSummary(event);
      expect(unredacted).toContain(TEST_DEPOSITOR);
      expect(unredacted).toContain("10000000 XLM");
      expect(unredacted).toContain("ledger 54321");
      expect(unredacted).toContain("memo: payroll_funding");

      const redacted = formatTreasuryDepositSummary(event, { redactDepositor: true });
      expect(redacted).not.toContain(TEST_DEPOSITOR);
      expect(redacted).toContain("***");
    });
  });
});
