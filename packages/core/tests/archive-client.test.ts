import { rpc, xdr, Keypair, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import {
  ArchiveClient,
  parseArchiveEvent,
  filterActiveRuns,
  filterArchivedRuns,
  filterDisputedRuns,
  filterFinalizedRuns,
  filterHeldRuns,
  isSafelyArchived,
  isActiveOperationalRun,
  PayrollRunItem,
} from "../src/archive";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

const MOCK_ACCOUNT_RESPONSE = {
  accountId: () => Keypair.random().publicKey(),
  sequenceNumber: () => "1",
  incrementSequenceNumber: () => {},
};

const MOCK_SIMULATE_SUCCESS = {
  results: [],
  minResourceFee: "100",
};

const MOCK_SEND_SUCCESS = {
  status: "PENDING",
  hash: "tx_hash_archive_123",
};

describe("ArchiveClient & Archive Operational Filtering", () => {
  describe("Archive Eligibility Rules", () => {
    let mockServer: rpc.Server;
    let client: ArchiveClient;

    beforeEach(() => {
      mockServer = {} as rpc.Server;
      client = new ArchiveClient(mockServer, TEST_CONTRACT_ID);
    });

    it("allows archiving for finalized or completed runs", () => {
      const finalizedRun: PayrollRunItem = {
        id: "run_1",
        status: "finalized",
        isDisputed: false,
        isHeld: false,
      };
      const completedRun: PayrollRunItem = {
        id: "run_2",
        status: "completed",
        isDisputed: false,
        isHeld: false,
      };

      expect(client.checkEligibility(finalizedRun).eligible).toBe(true);
      expect(client.checkEligibility(completedRun).eligible).toBe(true);
    });

    it("prevents archiving for active/pending runs", () => {
      const activeRun: PayrollRunItem = {
        id: "run_3",
        status: "active",
        isDisputed: false,
        isHeld: false,
      };
      const res = client.checkEligibility(activeRun);

      expect(res.eligible).toBe(false);
      expect(res.reason).toContain("not eligible");
    });

    it("rejects disputed runs from safe archiving", () => {
      const disputedRun: PayrollRunItem = { id: "run_4", status: "finalized", isDisputed: true };
      const statusDisputedRun: PayrollRunItem = { id: "run_5", status: "disputed" };

      expect(client.checkEligibility(disputedRun).eligible).toBe(false);
      expect(client.checkEligibility(disputedRun).reason).toContain(
        "Disputed runs cannot be archived"
      );

      expect(client.checkEligibility(statusDisputedRun).eligible).toBe(false);
      expect(isSafelyArchived(disputedRun)).toBe(false);
      expect(isSafelyArchived(statusDisputedRun)).toBe(false);
    });

    it("rejects held runs from safe archiving", () => {
      const heldRun: PayrollRunItem = { id: "run_6", status: "finalized", isHeld: true };
      const statusHeldRun: PayrollRunItem = { id: "run_7", status: "held" };

      expect(client.checkEligibility(heldRun).eligible).toBe(false);
      expect(client.checkEligibility(heldRun).reason).toContain("Held runs cannot be archived");

      expect(client.checkEligibility(statusHeldRun).eligible).toBe(false);
      expect(isSafelyArchived(heldRun)).toBe(false);
      expect(isSafelyArchived(statusHeldRun)).toBe(false);
    });

    it("verifies isSafelyArchived only returns true for clean archived runs", () => {
      const cleanArchived: PayrollRunItem = {
        id: "run_8",
        status: "archived",
        isDisputed: false,
        isHeld: false,
      };
      const disputedArchived: PayrollRunItem = {
        id: "run_9",
        status: "archived",
        isDisputed: true,
        isHeld: false,
      };
      const heldArchived: PayrollRunItem = {
        id: "run_10",
        status: "archived",
        isDisputed: false,
        isHeld: true,
      };

      expect(isSafelyArchived(cleanArchived)).toBe(true);
      expect(isSafelyArchived(disputedArchived)).toBe(false);
      expect(isSafelyArchived(heldArchived)).toBe(false);
    });
  });

  describe("Operational View Filtering", () => {
    const sampleRuns: PayrollRunItem[] = [
      { id: "run_active_1", status: "active", isDisputed: false, isHeld: false },
      { id: "run_finalized_2", status: "finalized", isDisputed: false, isHeld: false },
      { id: "run_archived_3", status: "archived", isDisputed: false, isHeld: false },
      { id: "run_disputed_4", status: "active", isDisputed: true, isHeld: false },
      { id: "run_held_5", status: "finalized", isDisputed: false, isHeld: true },
      { id: "run_disputed_status_6", status: "disputed" },
      { id: "run_held_status_7", status: "held" },
    ];

    it("filters active operational views excluding archived, disputed, and held runs", () => {
      expect(isActiveOperationalRun(sampleRuns[0])).toBe(true);
      expect(isActiveOperationalRun(sampleRuns[2])).toBe(false);

      const activeViews = filterActiveRuns(sampleRuns);
      const activeIds = activeViews.map((r) => r.id);

      expect(activeIds).toEqual(["run_active_1", "run_finalized_2"]);
      expect(activeIds).not.toContain("run_archived_3");
      expect(activeIds).not.toContain("run_disputed_4");
      expect(activeIds).not.toContain("run_held_5");
    });

    it("filters finalized runs", () => {
      const finalized = filterFinalizedRuns(sampleRuns);
      expect(finalized.map((r) => r.id)).toEqual(["run_finalized_2"]);
    });

    it("filters safely archived runs", () => {
      const archived = filterArchivedRuns(sampleRuns);
      expect(archived.map((r) => r.id)).toEqual(["run_archived_3"]);
    });

    it("filters disputed runs", () => {
      const disputed = filterDisputedRuns(sampleRuns);
      expect(disputed.map((r) => r.id)).toEqual(["run_disputed_4", "run_disputed_status_6"]);
    });

    it("filters held runs", () => {
      const held = filterHeldRuns(sampleRuns);
      expect(held.map((r) => r.id)).toEqual(["run_held_5", "run_held_status_7"]);
    });
  });

  describe("Archive Event Parsing", () => {
    it("parses payroll_run_archived event into ArchiveRecord", () => {
      const event = {
        topic: ["payroll_run_archived"],
        value: {
          run_id: "run_arch_99",
          archived_by: "GADMIN123",
          reason: "Completed audit cycle Q1",
          timestamp: 1700000000000,
        },
      };

      const record = parseArchiveEvent(event);
      expect(record).not.toBeNull();
      expect(record?.runId).toBe("run_arch_99");
      expect(record?.status).toBe("archived");
      expect(record?.archivedBy).toBe("GADMIN123");
      expect(record?.reason).toBe("Completed audit cycle Q1");
      expect(record?.archivedAt).toBe(1700000000000);
      expect(record?.isDisputed).toBe(false);
      expect(record?.isHeld).toBe(false);
    });

    it("parses payroll_run_disputed event into disputed record", () => {
      const event = {
        topic: ["payroll_run_disputed"],
        value: {
          run_id: "run_disp_11",
          reason: "Employee salary dispute filed",
        },
      };

      const record = parseArchiveEvent(event);
      expect(record).not.toBeNull();
      expect(record?.runId).toBe("run_disp_11");
      expect(record?.status).toBe("disputed");
      expect(record?.isDisputed).toBe(true);
    });

    it("returns null for non-archive events", () => {
      const event = {
        topic: ["payment_processed"],
        value: { id: "p1" },
      };

      expect(parseArchiveEvent(event)).toBeNull();
    });
  });

  describe("ArchiveClient Contract Invocations", () => {
    class TestableArchiveClient extends ArchiveClient {
      public invokeStub = jest
        .fn()
        .mockResolvedValue(nativeToScVal("archived", { type: "string" }));

      protected override async invoke(
        method: string,
        args: unknown[],
        signer: unknown,
        network?: string
      ): Promise<xdr.ScVal> {
        return this.invokeStub(method, args, signer, network);
      }
    }

    it("invokes archive_run method on contract", async () => {
      const client = new TestableArchiveClient({} as rpc.Server, TEST_CONTRACT_ID);
      const signer = Keypair.random();

      const record = await client.archivePayrollRun("run_101", signer, {
        reason: "End of fiscal year",
      });

      expect(client.invokeStub).toHaveBeenCalledWith(
        "archive_run",
        expect.any(Array),
        expect.anything(),
        expect.anything()
      );
      expect(record).toBeDefined();
      expect(record.runId).toBe("run_101");
      expect(record.status).toBe("archived");
      expect(record.reason).toBe("End of fiscal year");
    });

    it("queries get_archive_status method on contract", async () => {
      const client = new TestableArchiveClient({} as rpc.Server, TEST_CONTRACT_ID);
      const signer = Keypair.random();

      const status = await client.getArchiveStatus("run_102", signer);
      expect(client.invokeStub).toHaveBeenCalledWith(
        "get_archive_status",
        expect.any(Array),
        expect.anything(),
        expect.anything()
      );
      expect(status).toBe("archived");
    });
  });
});
