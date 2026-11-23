/**
 * Cache Invalidation Helpers Test Suite.
 *
 * Tests key generation, event-driven invalidation, manual invalidation,
 * and stale state detection across payroll, employee, treasury, and contract domains.
 */

import {
  CacheNamespace,
  MemoryCacheProvider,
  ServerCacheAdapter,
  CacheEntry,
  PayrollCacheInvalidator,
  buildPayrollCacheKey,
  buildEmployeeCacheKey,
  buildTreasuryCacheKey,
  buildContractCacheKey,
  parseCacheKey,
  matchesCachePattern,
  getInvalidationRule,
  listInvalidationRulesByDomain,
  resolveInvalidationPlan,
  applyInvalidationPlan,
  isCacheEntryStale,
  isPayrollStateStale,
  isEmployeeStateStale,
  isTreasuryStateStale,
  isContractStateStale,
  invalidatePayrollReviewState,
  invalidatePayrollCycleState,
  evaluatePayrollReviewFreshness,
  assertFreshPayrollReview,
  StalePayrollReviewError,
  invalidationPlanFromContractEvent,
  invalidateFromContractEvents,
  attachCacheInvalidatorToWatcher,
  TypedContractEvent,
  RegisteredEvent,
  RegistryUpdatedEvent,
  RegistryDeactivatedEvent,
  CommittedEvent,
  SalaryRevealedEvent,
  PaymentExecutedEvent,
  PaymentScheduledEvent,
  PaymentCancelledEvent,
  CacheEntryMetadata,
} from "../src";
import { EventEmitter } from "events";

/**
 * In-memory implementation of ServerCacheAdapter for testing.
 */
class MockServerCacheAdapter implements ServerCacheAdapter<string> {
  public store = new Map<string, { value: string; expiresAt: number | null; storedAt: number }>();

  private composeKey(namespace: CacheNamespace, key: string): string {
    return `${namespace}::${key}`;
  }

  async get(namespace: CacheNamespace, key: string): Promise<string | null> {
    const entry = this.store.get(this.composeKey(namespace, key));
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(this.composeKey(namespace, key));
      return null;
    }
    return entry.value;
  }

  async set(
    namespace: CacheNamespace,
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<void> {
    const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(this.composeKey(namespace, key), {
      value,
      expiresAt,
      storedAt: Date.now(),
    });
  }

  async has(namespace: CacheNamespace, key: string): Promise<boolean> {
    return (await this.get(namespace, key)) !== null;
  }

  async del(namespace: CacheNamespace, key: string): Promise<void> {
    this.store.delete(this.composeKey(namespace, key));
  }

  async clearNamespace(namespace: CacheNamespace): Promise<void> {
    const prefix = `${namespace}::`;
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
      }
    }
  }

  async clearAll(): Promise<void> {
    this.store.clear();
  }

  async getRemainingTtl(namespace: CacheNamespace, key: string): Promise<number | null> {
    const entry = this.store.get(this.composeKey(namespace, key));
    if (!entry || entry.expiresAt === null) return null;
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : null;
  }

  async keys(namespace: CacheNamespace): Promise<CacheEntry<string>[]> {
    const prefix = `${namespace}::`;
    const results: CacheEntry<string>[] = [];
    for (const [k, entry] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        const key = k.slice(prefix.length);
        results.push({
          key,
          value: entry.value,
          namespace,
          expiresAt: entry.expiresAt,
          storedAt: entry.storedAt,
        });
      }
    }
    return results;
  }

  async size(namespace: CacheNamespace): Promise<number> {
    return (await this.keys(namespace)).length;
  }
}

describe("Cache Invalidation Helpers", () => {
  const EMPLOYER_1 = "GDHOJ7BK6ZA3YZTXOYV6PPP7K4NRWQQ7W2YFC3RZHZRABRPYOC5FZWSW";
  const EMPLOYEE_1 = "GAPSRH3PJI36YZA4EGPSVXYYGN4MNU74ID62ZDAGRBHQH2MBHGQMAZQS";
  const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Cache Key Builders & Parsers
  // ──────────────────────────────────────────────────────────────────────────
  describe("Cache Key Builders & Parsers", () => {
    it("builds deterministic payroll cache keys", () => {
      expect(
        buildPayrollCacheKey({ subscope: "run", employer: EMPLOYER_1, runId: "run-101" })
      ).toBe(`payroll:run:${EMPLOYER_1}:run-101`);

      expect(buildPayrollCacheKey({ subscope: "cycle", employer: EMPLOYER_1, cycleId: 42n })).toBe(
        `payroll:cycle:${EMPLOYER_1}:42`
      );

      expect(buildPayrollCacheKey({ subscope: "draft", draftId: "draft-xyz" })).toBe(
        "payroll:draft:draft-xyz"
      );

      expect(
        buildPayrollCacheKey({ subscope: "review", employer: EMPLOYER_1, runId: "run-101" })
      ).toBe(`payroll:review:${EMPLOYER_1}:run-101`);

      expect(buildPayrollCacheKey({ subscope: "status", runId: "tx-abc" })).toBe(
        "payroll:status:tx-abc"
      );
    });

    it("builds deterministic employee cache keys", () => {
      expect(
        buildEmployeeCacheKey({ subscope: "profile", employer: EMPLOYER_1, employeeId: EMPLOYEE_1 })
      ).toBe(`employee:profile:${EMPLOYER_1}:${EMPLOYEE_1}`);

      expect(
        buildEmployeeCacheKey({
          subscope: "eligibility",
          employer: EMPLOYER_1,
          employeeId: EMPLOYEE_1,
        })
      ).toBe(`employee:eligibility:${EMPLOYER_1}:${EMPLOYEE_1}`);

      expect(buildEmployeeCacheKey({ subscope: "destination", employeeId: EMPLOYEE_1 })).toBe(
        `employee:destination:${EMPLOYEE_1}`
      );

      expect(buildEmployeeCacheKey({ subscope: "roster", employer: EMPLOYER_1 })).toBe(
        `employee:roster:${EMPLOYER_1}`
      );
    });

    it("builds deterministic treasury cache keys", () => {
      expect(
        buildTreasuryCacheKey({ subscope: "balance", companyId: EMPLOYER_1, asset: "USDC" })
      ).toBe(`treasury:balance:${EMPLOYER_1}:USDC`);

      expect(buildTreasuryCacheKey({ subscope: "reservations", companyId: EMPLOYER_1 })).toBe(
        `treasury:reservations:${EMPLOYER_1}`
      );

      expect(
        buildTreasuryCacheKey({
          subscope: "reservation",
          companyId: EMPLOYER_1,
          reservationId: "res-1",
        })
      ).toBe("treasury:reservation:res-1");

      expect(buildTreasuryCacheKey({ subscope: "checkpoints", companyId: EMPLOYER_1 })).toBe(
        `treasury:checkpoints:${EMPLOYER_1}`
      );
    });

    it("builds deterministic contract cache keys", () => {
      expect(buildContractCacheKey({ subscope: "state", contractId: CONTRACT_ID })).toBe(
        `contract:state:${CONTRACT_ID}`
      );
      expect(buildContractCacheKey({ subscope: "config", contractId: CONTRACT_ID })).toBe(
        `contract:config:${CONTRACT_ID}`
      );
      expect(
        buildContractCacheKey({
          subscope: "registry",
          contractId: CONTRACT_ID,
          entityId: EMPLOYEE_1,
        })
      ).toBe(`contract:registry:${CONTRACT_ID}:${EMPLOYEE_1}`);
    });

    it("parses canonical cache keys into structured segments", () => {
      const parsed = parseCacheKey(`payroll:run:${EMPLOYER_1}:run-99`);
      expect(parsed).toEqual({
        domain: "payroll",
        subscope: "run",
        segments: [EMPLOYER_1, "run-99"],
        rawKey: `payroll:run:${EMPLOYER_1}:run-99`,
      });

      expect(parseCacheKey("invalid")).toBeNull();
      expect(parseCacheKey("")).toBeNull();
      expect(parseCacheKey("unknown:domain:key")).toBeNull();
    });

    it("matches cache patterns with and without wildcards", () => {
      expect(matchesCachePattern("payroll:run:emp-1:run-1", "payroll:run:emp-1:run-1")).toBe(true);
      expect(matchesCachePattern("payroll:run:emp-1:run-1", "payroll:run:emp-1:*")).toBe(true);
      expect(matchesCachePattern("payroll:review:emp-1:run-1", "payroll:run:emp-1:*")).toBe(false);
      expect(matchesCachePattern("", "payroll:*")).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Invalidation Rules Documentation & Querying
  // ──────────────────────────────────────────────────────────────────────────
  describe("Invalidation Rules", () => {
    it("retrieves documented rules by trigger and verifies hazard prevention categories", () => {
      const registeredRule = getInvalidationRule("event:registered");
      expect(registeredRule).toBeDefined();
      expect(registeredRule?.riskPrevented).toBe("unsafe_review_state");
      expect(registeredRule?.domains).toContain("employee");

      const executedRule = getInvalidationRule("event:payment_executed");
      expect(executedRule).toBeDefined();
      expect(executedRule?.riskPrevented).toBe("incorrect_warning");
      expect(executedRule?.domains).toContain("treasury");

      const revealedRule = getInvalidationRule("event:salary_revealed");
      expect(revealedRule).toBeDefined();
      expect(revealedRule?.riskPrevented).toBe("confusing_reconciliation");
    });

    it("lists rules affecting specific cache domains", () => {
      const payrollRules = listInvalidationRulesByDomain("payroll");
      expect(payrollRules.length).toBeGreaterThan(0);
      expect(payrollRules.every((r) => r.domains.includes("payroll"))).toBe(true);

      const treasuryRules = listInvalidationRulesByDomain("treasury");
      expect(treasuryRules.length).toBeGreaterThan(0);
      expect(treasuryRules.every((r) => r.domains.includes("treasury"))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Event-Driven Invalidation
  // ──────────────────────────────────────────────────────────────────────────
  describe("Event-Driven Invalidation", () => {
    let serverCache: MockServerCacheAdapter;
    let invalidator: PayrollCacheInvalidator;

    beforeEach(() => {
      serverCache = new MockServerCacheAdapter();
      invalidator = new PayrollCacheInvalidator(serverCache);
    });

    it("invalidates employee roster and profile on RegisteredEvent", async () => {
      const rosterKey = buildEmployeeCacheKey({ subscope: "roster", employer: EMPLOYER_1 });
      const profileKey = buildEmployeeCacheKey({
        subscope: "profile",
        employer: EMPLOYER_1,
        employeeId: EMPLOYEE_1,
      });

      await serverCache.set(CacheNamespace.EMPLOYEE, rosterKey, "roster-data");
      await serverCache.set(CacheNamespace.EMPLOYEE, profileKey, "profile-data");

      const event: RegisteredEvent = {
        type: "registered",
        employer: EMPLOYER_1,
        employee: EMPLOYEE_1,
        salary: 5000n,
        token: "USDC",
        contractId: CONTRACT_ID,
      };

      const result = await invalidator.invalidateFromEvent(event);
      expect(result.success).toBe(true);
      expect(result.invalidatedKeys).toContain(rosterKey);
      expect(result.invalidatedKeys).toContain(profileKey);

      expect(await serverCache.get(CacheNamespace.EMPLOYEE, rosterKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.EMPLOYEE, profileKey)).toBeNull();
    });

    it("invalidates review states on RegistryUpdatedEvent to prevent unsafe reviews", async () => {
      const reviewKey = buildPayrollCacheKey({
        subscope: "review",
        employer: EMPLOYER_1,
        runId: "run-active",
      });
      const profileKey = buildEmployeeCacheKey({
        subscope: "profile",
        employer: EMPLOYER_1,
        employeeId: EMPLOYEE_1,
      });

      await serverCache.set(CacheNamespace.PAYROLL, reviewKey, "review-state-pending");
      await serverCache.set(CacheNamespace.EMPLOYEE, profileKey, "old-salary");

      const event: RegistryUpdatedEvent = {
        type: "registry_updated",
        employer: EMPLOYER_1,
        employee: EMPLOYEE_1,
        salary: 7500n,
      };

      const result = await invalidator.invalidateFromEvent(event);
      expect(result.success).toBe(true);
      expect(result.affectedDomains).toContain("employee");
      expect(result.affectedDomains).toContain("payroll");

      expect(await serverCache.get(CacheNamespace.PAYROLL, reviewKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.EMPLOYEE, profileKey)).toBeNull();
    });

    it("invalidates employee eligibility and roster on RegistryDeactivatedEvent", async () => {
      const eligibilityKey = buildEmployeeCacheKey({
        subscope: "eligibility",
        employer: EMPLOYER_1,
        employeeId: EMPLOYEE_1,
      });
      const rosterKey = buildEmployeeCacheKey({ subscope: "roster", employer: EMPLOYER_1 });

      await serverCache.set(CacheNamespace.EMPLOYEE, eligibilityKey, "eligible");
      await serverCache.set(CacheNamespace.EMPLOYEE, rosterKey, "cached-roster");

      const event: RegistryDeactivatedEvent = {
        type: "registry_deactivated",
        employer: EMPLOYER_1,
        employee: EMPLOYEE_1,
      };

      const result = await invalidator.invalidateFromEvent(event);
      expect(result.success).toBe(true);
      expect(await serverCache.get(CacheNamespace.EMPLOYEE, eligibilityKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.EMPLOYEE, rosterKey)).toBeNull();
    });

    it("invalidates cycle and uncommitted runs on CommittedEvent", async () => {
      const cycleKey = buildPayrollCacheKey({
        subscope: "cycle",
        employer: EMPLOYER_1,
        cycleId: 10n,
      });
      const runKey = buildPayrollCacheKey({
        subscope: "run",
        employer: EMPLOYER_1,
        runId: "draft-run",
      });

      await serverCache.set(CacheNamespace.PAYROLL, cycleKey, "uncommitted-cycle");
      await serverCache.set(CacheNamespace.PAYROLL, runKey, "draft-run");

      const event: CommittedEvent = {
        type: "committed",
        employer: EMPLOYER_1,
        employee: EMPLOYEE_1,
        commitmentHash: "0xhash123",
        cycleId: 10n,
        contractId: CONTRACT_ID,
      };

      await invalidator.invalidateFromEvent(event);
      expect(await serverCache.get(CacheNamespace.PAYROLL, cycleKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.PAYROLL, runKey)).toBeNull();
    });

    it("invalidates pre-reveal estimates on SalaryRevealedEvent", async () => {
      const cycleKey = buildPayrollCacheKey({
        subscope: "cycle",
        employer: EMPLOYER_1,
        cycleId: 5n,
      });
      await serverCache.set(CacheNamespace.PAYROLL, cycleKey, "pre-reveal-state");

      const event: SalaryRevealedEvent = {
        type: "salary_revealed",
        employer: EMPLOYER_1,
        employee: EMPLOYEE_1,
        cycleId: 5n,
        actualAmount: 10000n,
      };

      await invalidator.invalidateFromEvent(event);
      expect(await serverCache.get(CacheNamespace.PAYROLL, cycleKey)).toBeNull();
    });

    it("invalidates treasury balance, checkpoints, and payment status on PaymentExecutedEvent", async () => {
      const balanceKey = buildTreasuryCacheKey({
        subscope: "balance",
        companyId: EMPLOYER_1,
        asset: "USDC",
      });
      const checkpointKey = buildTreasuryCacheKey({
        subscope: "checkpoints",
        companyId: EMPLOYER_1,
      });
      const statusKey = buildPayrollCacheKey({ subscope: "status", runId: "tx-hash-999" });

      await serverCache.set(CacheNamespace.TREASURY, balanceKey, "100000");
      await serverCache.set(CacheNamespace.TREASURY, checkpointKey, "verified");
      await serverCache.set(CacheNamespace.PAYROLL, statusKey, "pending");

      const event: PaymentExecutedEvent = {
        type: "payment_executed",
        recipient: EMPLOYEE_1,
        amount: 3000n,
        asset: "USDC",
        txHash: "tx-hash-999",
        contractId: EMPLOYER_1,
      };

      const result = await invalidator.invalidateFromEvent(event);
      expect(result.success).toBe(true);
      expect(await serverCache.get(CacheNamespace.TREASURY, balanceKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.TREASURY, checkpointKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.PAYROLL, statusKey)).toBeNull();
    });

    it("invalidates reservations on PaymentScheduledEvent and PaymentCancelledEvent", async () => {
      const resKey = buildTreasuryCacheKey({ subscope: "reservations", companyId: EMPLOYER_1 });
      await serverCache.set(CacheNamespace.TREASURY, resKey, "reservations-list");

      const scheduled: PaymentScheduledEvent = {
        type: "payment_scheduled",
        recipient: EMPLOYEE_1,
        amount: 1500n,
        asset: "USDC",
        executeAt: Date.now() + 86400000,
        paymentId: 77n,
        contractId: EMPLOYER_1,
      };

      await invalidator.invalidateFromEvent(scheduled);
      expect(await serverCache.get(CacheNamespace.TREASURY, resKey)).toBeNull();

      // Reset and test cancelled
      await serverCache.set(CacheNamespace.TREASURY, resKey, "reservations-list-2");
      const cancelled: PaymentCancelledEvent = {
        type: "payment_cancelled",
        paymentId: 77n,
        contractId: EMPLOYER_1,
      };

      await invalidator.invalidateFromEvent(cancelled);
      expect(await serverCache.get(CacheNamespace.TREASURY, resKey)).toBeNull();
    });

    it("refreshes treasury balance and releases the reservation on a failed transfer (#826)", async () => {
      // A failed on-chain transfer can still differ from the pre-attempt
      // cached balance (fees, partial state), and must not leave its
      // reservation locked forever — RULE-TRS-004-FAILED invalidates both
      // instead of letting the next retry trust stale pre-failure state.
      const balanceKey = buildTreasuryCacheKey({
        subscope: "balance",
        companyId: EMPLOYER_1,
        asset: "USDC",
      });
      const resKey = buildTreasuryCacheKey({ subscope: "reservations", companyId: EMPLOYER_1 });
      const reservationKey = buildTreasuryCacheKey({
        subscope: "reservation",
        companyId: EMPLOYER_1,
        reservationId: "77",
      });
      const statusKey = buildPayrollCacheKey({ subscope: "status", runId: "tx-hash-failed-1" });

      await serverCache.set(CacheNamespace.TREASURY, balanceKey, "100000");
      await serverCache.set(CacheNamespace.TREASURY, resKey, "reservations-list");
      await serverCache.set(CacheNamespace.TREASURY, reservationKey, "reserved");
      await serverCache.set(CacheNamespace.PAYROLL, statusKey, "pending");

      const result = await invalidator.invalidateFromEvent({
        type: "payment_failed",
        contractId: EMPLOYER_1,
        asset: "USDC",
        paymentId: 77n,
        txHash: "tx-hash-failed-1",
      });

      expect(result.success).toBe(true);
      expect(await serverCache.get(CacheNamespace.TREASURY, balanceKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.TREASURY, resKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.TREASURY, reservationKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.PAYROLL, statusKey)).toBeNull();
    });

    it("bridges TransactionWatcher events to invalidator", async () => {
      const emitter = new EventEmitter();
      const unsubscribe = attachCacheInvalidatorToWatcher(
        emitter as unknown as Parameters<typeof attachCacheInvalidatorToWatcher>[0],
        invalidator
      );

      const statusKey = buildPayrollCacheKey({ subscope: "status", runId: "tx-confirmed-1" });
      await serverCache.set(CacheNamespace.PAYROLL, statusKey, "pending");

      emitter.emit("confirmed", { txHash: "tx-confirmed-1", status: "SUCCESS" });

      // Allow async invalidation handler to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(await serverCache.get(CacheNamespace.PAYROLL, statusKey)).toBeNull();
      unsubscribe();
    });

    it("generates plans from contract events via invalidationPlanFromContractEvent", () => {
      const event: RegisteredEvent = {
        type: "registered",
        employer: EMPLOYER_1,
        employee: EMPLOYEE_1,
        salary: 4000n,
        token: "USDC",
      };

      const plan = invalidationPlanFromContractEvent(event);
      expect(plan.trigger).toBe("event:registered");
      expect(plan.domains).toContain("employee");
    });

    it("processes batch contract events with invalidateFromContractEvents", async () => {
      const profileKey = buildEmployeeCacheKey({
        subscope: "profile",
        employer: EMPLOYER_1,
        employeeId: EMPLOYEE_1,
      });
      await serverCache.set(CacheNamespace.EMPLOYEE, profileKey, "old-profile");

      const events: TypedContractEvent[] = [
        {
          type: "registry_updated",
          employer: EMPLOYER_1,
          employee: EMPLOYEE_1,
          salary: 6000n,
        },
      ];

      const results = await invalidateFromContractEvents(serverCache, events);
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(await serverCache.get(CacheNamespace.EMPLOYEE, profileKey)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Manual Invalidation Helpers
  // ──────────────────────────────────────────────────────────────────────────
  describe("Manual Invalidation Helpers", () => {
    let serverCache: MockServerCacheAdapter;
    let memCache: MemoryCacheProvider;
    let invalidator: PayrollCacheInvalidator;

    beforeEach(() => {
      serverCache = new MockServerCacheAdapter();
      memCache = new MemoryCacheProvider();
      invalidator = new PayrollCacheInvalidator(serverCache);
    });

    it("manually invalidates specific payroll runs and drafts", async () => {
      const runKey = buildPayrollCacheKey({
        subscope: "run",
        employer: EMPLOYER_1,
        runId: "run-m1",
      });
      const draftKey = buildPayrollCacheKey({ subscope: "draft", draftId: "draft-m1" });

      await serverCache.set(CacheNamespace.PAYROLL, runKey, "run-content");
      await serverCache.set(CacheNamespace.PAYROLL, draftKey, "draft-content");

      await invalidator.invalidatePayroll({ runId: "run-m1", employer: EMPLOYER_1 });
      expect(await serverCache.get(CacheNamespace.PAYROLL, runKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.PAYROLL, draftKey)).toBe("draft-content");

      await invalidator.invalidatePayroll({ draftId: "draft-m1" });
      expect(await serverCache.get(CacheNamespace.PAYROLL, draftKey)).toBeNull();
    });

    it("manually invalidates entire payroll domain namespace", async () => {
      const key1 = buildPayrollCacheKey({ subscope: "draft", draftId: "d1" });
      const key2 = buildPayrollCacheKey({ subscope: "draft", draftId: "d2" });

      await serverCache.set(CacheNamespace.PAYROLL, key1, "v1");
      await serverCache.set(CacheNamespace.PAYROLL, key2, "v2");

      const res = await invalidator.invalidateDomain("payroll");
      expect(res.clearedNamespaces).toContain(CacheNamespace.PAYROLL);
      expect(await serverCache.get(CacheNamespace.PAYROLL, key1)).toBeNull();
      expect(await serverCache.get(CacheNamespace.PAYROLL, key2)).toBeNull();
    });

    it("manually invalidates treasury reservations and checkpoints", async () => {
      const resKey = buildTreasuryCacheKey({
        subscope: "reservation",
        companyId: EMPLOYER_1,
        reservationId: "res-lock",
      });
      const checkKey = buildTreasuryCacheKey({ subscope: "checkpoints", companyId: EMPLOYER_1 });

      await serverCache.set(CacheNamespace.TREASURY, resKey, "locked");
      await serverCache.set(CacheNamespace.TREASURY, checkKey, "checks");

      await invalidator.invalidateTreasury({
        companyId: EMPLOYER_1,
        reservationId: "res-lock",
        clearCheckpoints: true,
      });

      expect(await serverCache.get(CacheNamespace.TREASURY, resKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.TREASURY, checkKey)).toBeNull();
    });

    it("manually invalidates contract state and config", async () => {
      const stateKey = buildContractCacheKey({ subscope: "state", contractId: CONTRACT_ID });
      const configKey = buildContractCacheKey({ subscope: "config", contractId: CONTRACT_ID });

      await serverCache.set(CacheNamespace.CONTRACT, stateKey, "state-data");
      await serverCache.set(CacheNamespace.CONTRACT, configKey, "config-data");

      await invalidator.invalidateContract({ contractId: CONTRACT_ID });
      expect(await serverCache.get(CacheNamespace.CONTRACT, stateKey)).toBeNull();
      expect(await serverCache.get(CacheNamespace.CONTRACT, configKey)).toBeNull();
    });

    it("operates reliably against standard CacheProvider (MemoryCacheProvider)", async () => {
      const key = buildPayrollCacheKey({ subscope: "run", runId: "mem-run-1" });
      await memCache.set(key, "data");
      expect(await memCache.has(key)).toBe(true);

      const memInvalidator = new PayrollCacheInvalidator(memCache);
      const res = await memInvalidator.invalidatePayroll({ runId: "mem-run-1" });

      expect(res.success).toBe(true);
      expect(await memCache.get(key)).toBeNull();
    });

    it("operates reliably against native Map cache", async () => {
      const map = new Map<string, string>();
      const key = buildEmployeeCacheKey({ employeeId: "emp-map-1", subscope: "destination" });
      map.set(key, "addr-1");

      const mapInvalidator = new PayrollCacheInvalidator(map);
      await mapInvalidator.invalidateEmployee({ employeeId: "emp-map-1" });

      expect(map.has(key)).toBe(false);
    });

    it("provides dry-run plan generation via plan() without mutating cache", async () => {
      const key = buildTreasuryCacheKey({
        companyId: EMPLOYER_1,
        subscope: "balance",
        asset: "USDC",
      });
      await serverCache.set(CacheNamespace.TREASURY, key, "10000");

      const plan = invalidator.plan({
        type: "payment_executed",
        contractId: EMPLOYER_1,
        asset: "USDC",
      });

      expect(plan.domains).toContain("treasury");
      expect(plan.targets.length).toBeGreaterThan(0);
      // Cache must remain untouched
      expect(await serverCache.get(CacheNamespace.TREASURY, key)).toBe("10000");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Stale State Detection (Payroll, Employee, Treasury)
  // ──────────────────────────────────────────────────────────────────────────
  describe("Stale State Detection", () => {
    it("detects stale payroll state when TTL expires", () => {
      const metadata: CacheEntryMetadata = {
        storedAt: Date.now() - 5000,
      };

      const fresh = isPayrollStateStale(metadata, { maxAgeMs: 10000 });
      expect(fresh.isStale).toBe(false);

      const stale = isPayrollStateStale(metadata, { maxAgeMs: 3000 });
      expect(stale.isStale).toBe(true);
      expect(stale.riskCategory).toBe("expired_ttl");
    });

    it("detects stale payroll review state when revision version mismatches", () => {
      const metadata: CacheEntryMetadata = {
        storedAt: Date.now(),
        version: 1,
      };

      const result = isPayrollStateStale(metadata, { expectedVersion: 2 });
      expect(result.isStale).toBe(true);
      expect(result.riskCategory).toBe("unsafe_review_state");
      expect(result.reason).toContain("Version mismatch");
    });

    it("asserts fresh payroll review and throws StalePayrollReviewError on stale review", () => {
      const freshReview = {
        runId: "run-fresh",
        employer: EMPLOYER_1,
        employeeIds: [EMPLOYEE_1],
        totalAmount: 10000n,
        metadata: { storedAt: Date.now(), version: 2 },
      };

      expect(() => assertFreshPayrollReview(freshReview, { expectedVersion: 2 })).not.toThrow();

      const staleReview = {
        ...freshReview,
        metadata: { storedAt: Date.now(), version: 1 },
      };

      expect(() => assertFreshPayrollReview(staleReview, { expectedVersion: 2 })).toThrow(
        StalePayrollReviewError
      );

      const freshness = evaluatePayrollReviewFreshness(freshReview, { expectedVersion: 2 });
      expect(freshness.isStale).toBe(false);

      const genericStale = isCacheEntryStale(
        { storedAt: Date.now() - 10000 },
        { maxAgeMs: 5000 },
        "payroll"
      );
      expect(genericStale.isStale).toBe(true);
    });

    it("directly resolves and applies plans via resolveInvalidationPlan and applyInvalidationPlan", async () => {
      const testCache = new MockServerCacheAdapter();
      const plan = resolveInvalidationPlan({
        trigger: "manual:payroll_run_reset",
        domain: "payroll",
      });
      expect(plan.domains).toContain("payroll");

      const result = await applyInvalidationPlan(testCache, plan);
      expect(result.success).toBe(true);
    });

    it("detects stale employee eligibility when an invalidating event occurred", () => {
      const metadata: CacheEntryMetadata = {
        storedAt: Date.now(),
      };

      const result = isEmployeeStateStale(metadata, { invalidatingEventOccurred: true });
      expect(result.isStale).toBe(true);
      expect(result.riskCategory).toBe("incorrect_warning");
    });

    it("detects stale treasury balance when ledger sequence is behind current ledger", () => {
      const metadata: CacheEntryMetadata = {
        storedAt: Date.now(),
        ledger: 1000,
      };

      const result = isTreasuryStateStale(metadata, { currentLedger: 1005 });
      expect(result.isStale).toBe(true);
      expect(result.riskCategory).toBe("incorrect_warning");
      expect(result.reason).toContain("behind current ledger");
    });

    it("detects stale state when entry is older than invalidation watermark", () => {
      const metadata: CacheEntryMetadata = {
        storedAt: 1000,
      };

      const result = isTreasuryStateStale(metadata, { staleBeforeTimestamp: 2000 });
      expect(result.isStale).toBe(true);
      expect(result.riskCategory).toBe("expired_ttl");
    });

    it("detects stale contract state on checksum mismatch", () => {
      const metadata: CacheEntryMetadata = {
        storedAt: Date.now(),
        checksum: "0xhashA",
      };

      const result = isContractStateStale(metadata, { expectedChecksum: "0xhashB" });
      expect(result.isStale).toBe(true);
      expect(result.riskCategory).toBe("confusing_reconciliation");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Dedicated Payroll Domain Helpers
  // ──────────────────────────────────────────────────────────────────────────
  describe("Payroll Review & Cycle Helpers", () => {
    let serverCache: MockServerCacheAdapter;

    beforeEach(() => {
      serverCache = new MockServerCacheAdapter();
    });

    it("invalidates payroll review state using invalidatePayrollReviewState", async () => {
      const key = buildPayrollCacheKey({ subscope: "review", employer: EMPLOYER_1, runId: "r-9" });
      await serverCache.set(CacheNamespace.PAYROLL, key, "review-data");

      await invalidatePayrollReviewState(serverCache, EMPLOYER_1, "r-9");
      expect(await serverCache.get(CacheNamespace.PAYROLL, key)).toBeNull();
    });

    it("invalidates payroll cycle state using invalidatePayrollCycleState", async () => {
      const key = buildPayrollCacheKey({ subscope: "cycle", employer: EMPLOYER_1, cycleId: 100n });
      await serverCache.set(CacheNamespace.PAYROLL, key, "cycle-data");

      await invalidatePayrollCycleState(serverCache, EMPLOYER_1, 100n);
      expect(await serverCache.get(CacheNamespace.PAYROLL, key)).toBeNull();
    });
  });
});
