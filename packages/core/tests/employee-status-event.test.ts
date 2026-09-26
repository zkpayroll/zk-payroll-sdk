/**
 * Tests for Employee Status Event Decoding (#475).
 */

import { xdr, Address, Keypair } from "@stellar/stellar-sdk";
import {
  decodeEmployeeStatusUpdatedEvent,
  decodeEmployeeStatusUpdatedEvents,
  isEmployeeStatusUpdatedEvent,
  EmployeeStatusUpdatedEvent,
} from "../src/events/employeeStatus";
import { parseContractEvent } from "../src/event-parser";
import { EventDecodingError } from "../src/events/types";
import type { RawContractEvent } from "../src/event-parser";

function makeRawEvent(
  eventName: string,
  employeeAddress: string,
  employerAddress?: string,
  dataMap: Record<string, xdr.ScVal> = {},
  overrides: Partial<RawContractEvent> = {}
): RawContractEvent {
  const topics: xdr.ScVal[] = [
    xdr.ScVal.scvSymbol(eventName),
    Address.fromString(employeeAddress).toScVal(),
  ];

  if (employerAddress) {
    topics.push(Address.fromString(employerAddress).toScVal());
  }

  const mapEntries: xdr.ScMapEntry[] = Object.entries(dataMap).map(([k, v]) => {
    return new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(k),
      val: v,
    });
  });

  return {
    topics,
    data: xdr.ScVal.scvMap(mapEntries),
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    ledger: 123456,
    ledgerClosedAt: "2026-09-26T06:00:00Z",
    ...overrides,
  };
}

describe("Issue #475 - Employee Status Event Decoding", () => {
  const employeeKey = Keypair.random().publicKey();
  const employerKey = Keypair.random().publicKey();
  const adminKey = Keypair.random().publicKey();

  describe("decodeEmployeeStatusUpdatedEvent", () => {
    it("decodes a standard employee_status_updated event with full metadata", () => {
      const raw = makeRawEvent("employee_status_updated", employeeKey, employerKey, {
        new_status: xdr.ScVal.scvSymbol("suspended"),
        previous_status: xdr.ScVal.scvSymbol("active"),
        updated_by: Address.fromString(adminKey).toScVal(),
        reason: xdr.ScVal.scvString("compliance_review"),
        updated_at: xdr.ScVal.scvU64(new xdr.Uint64(1700000000)),
        effective_date: xdr.ScVal.scvU64(new xdr.Uint64(1700003600)),
      });

      const decoded: EmployeeStatusUpdatedEvent = decodeEmployeeStatusUpdatedEvent(raw);

      expect(decoded.type).toBe("employee_status_updated");
      expect(decoded.employee).toBe(employeeKey);
      expect(decoded.employer).toBe(employerKey);
      expect(decoded.newStatus).toBe("suspended");
      expect(decoded.previousStatus).toBe("active");
      expect(decoded.updatedBy).toBe(adminKey);
      expect(decoded.reason).toBe("compliance_review");
      expect(decoded.updatedAt).toBe(1700000000);
      expect(decoded.effectiveDate).toBe(1700003600);
      expect(decoded.contractId).toBe("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
      expect(decoded.ledger).toBe(123456);
      expect(decoded.timestamp).toBe("2026-09-26T06:00:00Z");
    });

    it("infers new status from specific event names", () => {
      const suspendedRaw = makeRawEvent("employee_suspended", employeeKey);
      expect(decodeEmployeeStatusUpdatedEvent(suspendedRaw).newStatus).toBe("suspended");

      const reactivatedRaw = makeRawEvent("employee_reactivated", employeeKey);
      expect(decodeEmployeeStatusUpdatedEvent(reactivatedRaw).newStatus).toBe("active");

      const offboardedRaw = makeRawEvent("employee_offboarded", employeeKey);
      expect(decodeEmployeeStatusUpdatedEvent(offboardedRaw).newStatus).toBe("offboarded");

      const createdRaw = makeRawEvent("employee_created", employeeKey);
      expect(decodeEmployeeStatusUpdatedEvent(createdRaw).newStatus).toBe("active");
    });

    it("throws EventDecodingError when event has no topics", () => {
      const emptyRaw: RawContractEvent = {
        topics: [],
        data: xdr.ScVal.scvVoid(),
      };

      expect(() => decodeEmployeeStatusUpdatedEvent(emptyRaw)).toThrow(EventDecodingError);
      expect(() => decodeEmployeeStatusUpdatedEvent(emptyRaw)).toThrow(/no topics/i);
    });

    it("throws EventDecodingError for unrecognized event names", () => {
      const invalidRaw = makeRawEvent("random_other_event", employeeKey);

      expect(() => decodeEmployeeStatusUpdatedEvent(invalidRaw)).toThrow(EventDecodingError);
      expect(() => decodeEmployeeStatusUpdatedEvent(invalidRaw)).toThrow(
        /expected employee status event/i
      );
    });

    it("throws EventDecodingError when employee address topic is missing or invalid", () => {
      const rawWithBadTopic: RawContractEvent = {
        topics: [xdr.ScVal.scvSymbol("employee_status_updated"), xdr.ScVal.scvU32(123)],
        data: xdr.ScVal.scvVoid(),
      };

      expect(() => decodeEmployeeStatusUpdatedEvent(rawWithBadTopic)).toThrow(EventDecodingError);
      expect(() => decodeEmployeeStatusUpdatedEvent(rawWithBadTopic)).toThrow(
        /missing required employee/i
      );
    });

    it("failure states do not expose sensitive payroll values", () => {
      const raw = makeRawEvent("unknown_event", employeeKey);
      expect(() => decodeEmployeeStatusUpdatedEvent(raw)).toThrow();
      const message = (() => {
        try {
          decodeEmployeeStatusUpdatedEvent(raw);
          return "";
        } catch (err: unknown) {
          return (err as Error).message;
        }
      })();
      // Verify no sensitive tokens, amounts, or private keys in the error message
      expect(message).not.toMatch(/salary|witness|amount|balance/i);
    });
  });

  describe("decodeEmployeeStatusUpdatedEvents batch parser", () => {
    it("decodes an array of events", () => {
      const emp1 = Keypair.random().publicKey();
      const emp2 = Keypair.random().publicKey();
      const events = [
        makeRawEvent("employee_suspended", emp1),
        makeRawEvent("employee_reactivated", emp2),
      ];

      const decodedList = decodeEmployeeStatusUpdatedEvents(events);
      expect(decodedList).toHaveLength(2);
      expect(decodedList[0].employee).toBe(emp1);
      expect(decodedList[0].newStatus).toBe("suspended");
      expect(decodedList[1].employee).toBe(emp2);
      expect(decodedList[1].newStatus).toBe("active");
    });
  });

  describe("isEmployeeStatusUpdatedEvent predicate", () => {
    it("returns true for matching event names and false otherwise", () => {
      expect(
        isEmployeeStatusUpdatedEvent(makeRawEvent("employee_status_updated", employeeKey))
      ).toBe(true);
      expect(isEmployeeStatusUpdatedEvent(makeRawEvent("employee_suspended", employeeKey))).toBe(
        true
      );
      expect(isEmployeeStatusUpdatedEvent(makeRawEvent("employee_offboarded", employeeKey))).toBe(
        true
      );
      expect(isEmployeeStatusUpdatedEvent(makeRawEvent("unrelated_event", employeeKey))).toBe(
        false
      );
      expect(isEmployeeStatusUpdatedEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
    });
  });

  describe("parseContractEvent integration", () => {
    it("parses employee status events via universal parser", () => {
      const raw = makeRawEvent("employee_status_updated", employeeKey, employerKey, {
        new_status: xdr.ScVal.scvSymbol("active"),
      });

      const parsed = parseContractEvent(raw);
      expect(parsed.type).toBe("employee_status_updated");
      if (parsed.type === "employee_status_updated") {
        expect(parsed.employee).toBe(employeeKey);
        expect(parsed.newStatus).toBe("active");
      }
    });
  });
});
