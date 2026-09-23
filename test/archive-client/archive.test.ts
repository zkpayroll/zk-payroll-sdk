import {
  ArchiveClient,
  parseArchiveEvent,
  filterActiveRuns,
  filterArchivedRuns,
  filterDisputedRuns,
  isSafelyArchived,
  PayrollRunItem,
} from "../../packages/core/src/archive";

describe("Root test/archive-client — Archive SDK Helpers", () => {
  it("verifies archive status and filtering out of operational views", () => {
    const runs: PayrollRunItem[] = [
      { id: "run_active", status: "active", isDisputed: false, isHeld: false },
      { id: "run_archived", status: "archived", isDisputed: false, isHeld: false },
      { id: "run_disputed", status: "archived", isDisputed: true, isHeld: false },
      { id: "run_held", status: "archived", isDisputed: false, isHeld: true },
    ];

    const activeRuns = filterActiveRuns(runs);
    expect(activeRuns.map((r) => r.id)).toEqual(["run_active"]);

    const safelyArchived = filterArchivedRuns(runs);
    expect(safelyArchived.map((r) => r.id)).toEqual(["run_archived"]);

    expect(isSafelyArchived(runs[2])).toBe(false);
    expect(isSafelyArchived(runs[3])).toBe(false);
  });

  it("parses contract archive events", () => {
    const event = {
      topic: ["payroll_run_archived"],
      value: {
        run_id: "run_test_777",
        archived_by: "GA_ADMIN",
        reason: "Archive lifecycle rule met",
      },
    };

    const parsed = parseArchiveEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.runId).toBe("run_test_777");
    expect(parsed?.status).toBe("archived");
  });
});
