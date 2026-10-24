import {
  OrgConfigChangeLedger,
  OrgConfigChangeLedgerError,
  ORG_CONFIG_LEDGER_GENESIS_HASH,
  ORG_CONFIG_REDACTED,
  verifyOrgConfigChangeLedger,
  type OrgConfigChangeInput,
  type OrgConfigLedgerErrorCode,
} from "../src/audit/organizationConfigChangeLedger";

describe("Organization Configuration Change Ledger (#701)", () => {
  const t0 = 1700000000000;
  const make = () => new OrgConfigChangeLedger("org-1", () => t0);
  const change = (o: Partial<OrgConfigChangeInput> = {}): OrgConfigChangeInput => ({
    organizationId: "org-1",
    settingKey: "payroll.approvalThreshold",
    previousValue: 100,
    newValue: 200,
    actor: "admin-1",
    reason: "Raise threshold for Q4",
    ...o,
  });
  const codeOf = (fn: () => unknown): OrgConfigLedgerErrorCode | undefined => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(OrgConfigChangeLedgerError);
      return (e as OrgConfigChangeLedgerError).code;
    }
    return undefined;
  };

  describe("recording", () => {
    it("records a change with genesis link and default clock", () => {
      const e = make().record(change());
      expect(e.sequence).toBe(1);
      expect(e.changeId).toBe("cfg-1");
      expect(e.timestampMs).toBe(t0);
      expect(e.previousHash).toBe(ORG_CONFIG_LEDGER_GENESIS_HASH);
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.redacted).toBe(false);
    });

    it("chains entries and verifies", () => {
      const l = make();
      const a = l.record(change());
      const b = l.record(change({ previousValue: 200, newValue: 300 }));
      expect(b.previousHash).toBe(a.hash);
      expect(l.verify()).toEqual({ valid: true });
      expect(l.size).toBe(2);
    });

    it("supports creation (no previous) and removal (no new) of settings", () => {
      const l = make();
      expect(
        l.record(change({ previousValue: undefined, newValue: true })).previousValue
      ).toBeUndefined();
      expect(
        l.record(change({ previousValue: true, newValue: undefined })).newValue
      ).toBeUndefined();
    });

    it("treats key order in object values as equal (no-op) and deep-copies values", () => {
      const l = make();
      const val = { a: 1, b: { c: 2 } };
      const e = l.record(change({ previousValue: undefined, newValue: val }));
      val.b.c = 99;
      expect(e.newValue).toEqual({ a: 1, b: { c: 2 } });
      expect(
        codeOf(() =>
          l.record(
            change({ previousValue: { a: 1, b: { c: 2 } }, newValue: { b: { c: 2 }, a: 1 } })
          )
        )
      ).toBe("NO_OP_CHANGE");
    });

    it("redacts values of sensitive settings", () => {
      const e = make().record(
        change({ settingKey: "webhook.apiKey", previousValue: "old", newValue: "new" })
      );
      expect(e.redacted).toBe(true);
      expect(e.previousValue).toBe(ORG_CONFIG_REDACTED);
      expect(e.newValue).toBe(ORG_CONFIG_REDACTED);
      expect(JSON.stringify(e)).not.toContain('"new"');
    });

    it("trims text fields and honors supplied changeId and timestamp", () => {
      const e = make().record(
        change({ changeId: "x-1", actor: " bob ", reason: " why ", timestampMs: t0 + 5 })
      );
      expect([e.changeId, e.actor, e.reason, e.timestampMs]).toEqual(["x-1", "bob", "why", t0 + 5]);
    });

    it("returns frozen entries", () => {
      const e = make().record(change());
      expect(Object.isFrozen(e)).toBe(true);
    });
  });

  describe("validation failures", () => {
    const cases: Array<[string, Partial<OrgConfigChangeInput>, OrgConfigLedgerErrorCode]> = [
      ["missing org", { organizationId: " " }, "ORG_ID_REQUIRED"],
      ["wrong org", { organizationId: "org-2" }, "ORG_MISMATCH"],
      ["missing key", { settingKey: "" }, "SETTING_KEY_REQUIRED"],
      ["missing actor", { actor: "  " }, "ACTOR_REQUIRED"],
      ["missing reason", { reason: "" }, "REASON_REQUIRED"],
      ["no-op change", { previousValue: 5, newValue: 5 }, "NO_OP_CHANGE"],
      ["both values absent", { previousValue: undefined, newValue: undefined }, "NO_OP_CHANGE"],
      ["bigint value", { newValue: 10n as never }, "VALUE_NOT_SERIALIZABLE"],
      ["NaN value", { newValue: NaN }, "VALUE_NOT_SERIALIZABLE"],
      ["function value", { newValue: (() => 1) as never }, "VALUE_NOT_SERIALIZABLE"],
      ["class instance", { newValue: new Date() as never }, "VALUE_NOT_SERIALIZABLE"],
      ["negative timestamp", { timestampMs: -1 }, "TIMESTAMP_INVALID"],
      ["fractional timestamp", { timestampMs: 1.5 }, "TIMESTAMP_INVALID"],
      ["blank changeId", { changeId: " " }, "CHANGE_ID_DUPLICATE"],
    ];
    it.each(cases)("rejects %s", (_n, override, code) => {
      const l = make();
      expect(codeOf(() => l.record(change(override)))).toBe(code);
      expect(l.size).toBe(0);
    });

    it("rejects non-object input", () => {
      expect(codeOf(() => make().record(null as never))).toBe("SETTING_KEY_REQUIRED");
    });

    it("rejects duplicate changeId and timestamp regression", () => {
      const l = make();
      l.record(change({ changeId: "dup", timestampMs: t0 + 10 }));
      expect(
        codeOf(() =>
          l.record(change({ changeId: "dup", previousValue: 1, newValue: 2, timestampMs: t0 + 11 }))
        )
      ).toBe("CHANGE_ID_DUPLICATE");
      expect(
        codeOf(() => l.record(change({ previousValue: 1, newValue: 2, timestampMs: t0 + 9 })))
      ).toBe("TIMESTAMP_REGRESSION");
      expect(l.size).toBe(1);
    });

    it("gives actionable messages", () => {
      expect(() => make().record(change({ organizationId: "org-2" }))).toThrow(
        /belongs to "org-1"/
      );
    });

    it("requires an organizationId to construct a ledger", () => {
      expect(codeOf(() => new OrgConfigChangeLedger(""))).toBe("ORG_ID_REQUIRED");
    });
  });

  describe("queries", () => {
    it("filters by setting, actor and time range; finds latest", () => {
      const l = make();
      l.record(change({ timestampMs: t0 }));
      l.record(
        change({
          settingKey: "a.b",
          previousValue: 1,
          newValue: 2,
          actor: "bob",
          timestampMs: t0 + 10,
        })
      );
      l.record(change({ previousValue: 200, newValue: 300, timestampMs: t0 + 20 }));
      expect(l.list()).toHaveLength(3);
      expect(l.list({ settingKey: "a.b" })).toHaveLength(1);
      expect(l.list({ actor: "bob" })).toHaveLength(1);
      expect(l.list({ fromMs: t0 + 10, toMs: t0 + 10 })).toHaveLength(1);
      expect(l.latestFor("payroll.approvalThreshold")?.newValue).toBe(300);
      expect(l.latestFor("missing")).toBeUndefined();
    });
  });

  describe("integrity verification", () => {
    const build = () => {
      const l = make();
      l.record(change());
      l.record(change({ previousValue: 200, newValue: 300 }));
      l.record(change({ previousValue: 300, newValue: 400 }));
      return l.export();
    };

    it("accepts an empty ledger", () => {
      expect(verifyOrgConfigChangeLedger([])).toEqual({ valid: true });
    });

    it("detects modified content", () => {
      const e = build();
      e[1] = { ...e[1], newValue: 999 };
      expect(verifyOrgConfigChangeLedger(e)).toMatchObject({ valid: false, brokenAt: 2 });
    });

    it("detects removed entries", () => {
      const e = build();
      e.splice(1, 1);
      expect(verifyOrgConfigChangeLedger(e)).toMatchObject({ valid: false, brokenAt: 3 });
    });

    it("detects broken links", () => {
      const e = build();
      e[2] = { ...e[2], previousHash: "f".repeat(64) };
      expect(verifyOrgConfigChangeLedger(e).reason).toMatch(/does not link/);
    });

    it("export returns copies that cannot alter the ledger", () => {
      const l = make();
      l.record(change());
      const out = l.export();
      out[0].actor = "evil";
      expect(l.verify().valid).toBe(true);
      expect(l.list()[0].actor).toBe("admin-1");
    });
  });
});
