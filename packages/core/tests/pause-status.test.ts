import { normalizePauseStatus, PAUSE_CATEGORIES } from "../src/pause/status";

describe("normalizePauseStatus — fully unpaused fixture", () => {
  it("normalizes an all-false response to globallyPaused: false", () => {
    const raw = Object.fromEntries(PAUSE_CATEGORIES.map((c) => [c, false]));
    const status = normalizePauseStatus(raw);

    expect(status.globallyPaused).toBe(false);
    for (const category of PAUSE_CATEGORIES) {
      expect(status.categories[category]).toBe(false);
    }
    expect(status.unknownCategories).toEqual([]);
  });
});

describe("normalizePauseStatus — fully paused fixture", () => {
  it("normalizes an all-true response to globallyPaused: true", () => {
    const raw = Object.fromEntries(PAUSE_CATEGORIES.map((c) => [c, true]));
    const status = normalizePauseStatus(raw);

    expect(status.globallyPaused).toBe(true);
    for (const category of PAUSE_CATEGORIES) {
      expect(status.categories[category]).toBe(true);
    }
  });
});

describe("normalizePauseStatus — partially paused fixture", () => {
  it("reports globallyPaused: false when only some categories are paused", () => {
    const status = normalizePauseStatus({ deposits: true, withdrawals: false });
    expect(status.globallyPaused).toBe(false);
    expect(status.categories.deposits).toBe(true);
    expect(status.categories.withdrawals).toBe(false);
  });
});

describe("normalizePauseStatus — missing fields", () => {
  it("normalizes missing categories to false rather than undefined", () => {
    const status = normalizePauseStatus({ deposits: true });
    expect(status.categories.payroll).toBe(false);
    expect(status.categories.proofs).toBe(false);
    expect(status.categories.reservations).toBe(false);
    expect(status.categories.withdrawals).toBe(false);
  });

  it("handles a completely empty response", () => {
    const status = normalizePauseStatus({});
    expect(status.globallyPaused).toBe(false);
    for (const category of PAUSE_CATEGORIES) {
      expect(status.categories[category]).toBe(false);
    }
  });

  it("handles a null or undefined response without throwing", () => {
    expect(normalizePauseStatus(null).globallyPaused).toBe(false);
    expect(normalizePauseStatus(undefined).globallyPaused).toBe(false);
  });
});

describe("normalizePauseStatus — unknown categories", () => {
  it("surfaces categories not in PAUSE_CATEGORIES rather than dropping them", () => {
    const status = normalizePauseStatus({ deposits: true, new_future_category: true } as any);
    expect(status.unknownCategories).toEqual(["new_future_category"]);
  });

  it("does not let an unknown category affect globallyPaused", () => {
    const raw = {
      ...Object.fromEntries(PAUSE_CATEGORIES.map((c) => [c, true])),
      mystery_flag: false,
    } as any;
    expect(normalizePauseStatus(raw).globallyPaused).toBe(true);
  });
});

describe("normalizePauseStatus — output shape", () => {
  it("always includes every known category, even for a sparse input", () => {
    const status = normalizePauseStatus({ proofs: true });
    expect(Object.keys(status.categories).sort()).toEqual([...PAUSE_CATEGORIES].sort());
  });
});
