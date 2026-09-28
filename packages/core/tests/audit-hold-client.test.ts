/**
 * Tests for the AuditHoldClient (#527): audit hold status query and
 * authorized audit hold release.
 *
 * The release path must validate authorization locally (never broadcast a
 * malformed release), decode the post-release hold through the shared
 * #320 parser, and never expose the authorization token or the hold's
 * free-text note in the response.
 */
import { rpc, xdr, Keypair, Networks, nativeToScVal, StrKey } from "@stellar/stellar-sdk";
import { AuditHoldClient, type ReleaseAuditHoldResponse } from "../src/clients/AuditHoldClient";
import { HoldReleaseAuthorizationError } from "../src/compliance";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));

class TestableAuditHoldClient extends AuditHoldClient {
  public invokeStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network?: string
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network);
  }
}

/** Builds a contract-style hold status struct ScVal (snake_case keys). */
function makeHoldStatusScVal(overrides?: Partial<Record<string, xdr.ScVal>>): xdr.ScVal {
  const defaults: Record<string, xdr.ScVal> = {
    holdId: nativeToScVal("hold-1", { type: "string" }),
    scope: nativeToScVal("employer", { type: "symbol" }),
    targetId: nativeToScVal("employer-1", { type: "string" }),
    state: nativeToScVal("active", { type: "symbol" }),
    reasonCode: nativeToScVal("KYC_REVIEW_PENDING", { type: "symbol" }),
    placedBy: nativeToScVal("officer-a", { type: "string" }),
    placedAt: nativeToScVal(1000n, { type: "u64" }),
  };
  const merged = { ...defaults, ...overrides } as Record<string, xdr.ScVal>;
  return xdr.ScVal.scvMap(
    Object.entries(merged).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val: val as xdr.ScVal,
        })
    )
  );
}

function createMockServer(): rpc.Server {
  return {} as rpc.Server;
}

describe("AuditHoldClient", () => {
  let client: TestableAuditHoldClient;
  let signer: Keypair;

  beforeEach(() => {
    client = new TestableAuditHoldClient(createMockServer(), TEST_CONTRACT_ID);
    signer = Keypair.random();
  });

  describe("constructor", () => {
    it("creates a client with the default TESTNET passphrase", () => {
      expect(client).toBeInstanceOf(AuditHoldClient);
    });

    it("accepts a custom network passphrase", () => {
      const custom = new TestableAuditHoldClient(createMockServer(), TEST_CONTRACT_ID, {
        networkPassphrase: Networks.PUBLIC,
      });
      expect(custom).toBeInstanceOf(AuditHoldClient);
    });
  });

  describe("getAuditHoldStatus", () => {
    it("calls invoke with method name 'get_audit_hold_status'", async () => {
      client.invokeStub.mockResolvedValue(makeHoldStatusScVal());
      await client.getAuditHoldStatus("hold-1", signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_audit_hold_status");
    });

    it("encodes the holdId as a single string argument", async () => {
      client.invokeStub.mockResolvedValue(makeHoldStatusScVal());
      await client.getAuditHoldStatus("hold-1", signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(1);
      expect(args[0].str()?.toString()).toBe("hold-1");
    });

    it("returns a normalized ComplianceHold", async () => {
      client.invokeStub.mockResolvedValue(makeHoldStatusScVal());
      const hold = await client.getAuditHoldStatus("hold-1", signer);
      expect(hold).toMatchObject({
        holdId: "hold-1",
        target: { scope: "employer", id: "employer-1" },
        state: "active",
        reasonCode: "KYC_REVIEW_PENDING",
      });
    });

    it("throws a local validation error for an empty holdId without any RPC call", async () => {
      await expect(client.getAuditHoldStatus("   ", signer)).rejects.toThrow("holdId is required");
      expect(client.invokeStub).not.toHaveBeenCalled();
    });

    it("throws a decode error when the contract returns a non-struct value", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvBool(true));
      await expect(client.getAuditHoldStatus("hold-1", signer)).rejects.toThrow(
        "expected a struct"
      );
    });

    it("falls back to state 'unknown' for a malformed response rather than a safe state", async () => {
      // Missing scope/targetId/state: parseHoldStatus must fail closed.
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({
          scope: xdr.ScVal.scvVoid(),
          targetId: xdr.ScVal.scvVoid(),
          state: xdr.ScVal.scvVoid(),
        })
      );
      const hold = await client.getAuditHoldStatus("hold-1", signer);
      expect(hold.state).toBe("unknown");
    });
  });

  describe("releaseAuditHold — happy path", () => {
    const validRelease = {
      holdId: "hold-1",
      releasedBy: "officer-a",
      authorizationToken: "a-valid-token-123",
    };

    it("calls invoke with method name 'release_audit_hold'", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({ state: nativeToScVal("released", { type: "symbol" }) })
      );
      await client.releaseAuditHold(validRelease, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("release_audit_hold");
    });

    it("encodes holdId, releasedBy, and authorizationToken as string arguments", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({ state: nativeToScVal("released", { type: "symbol" }) })
      );
      await client.releaseAuditHold(validRelease, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(3);
      expect(args[0].str()?.toString()).toBe("hold-1");
      expect(args[1].str()?.toString()).toBe("officer-a");
      expect(args[2].str()?.toString()).toBe("a-valid-token-123");
    });

    it("appends an optional releaseReason as a fourth argument", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({ state: nativeToScVal("released", { type: "symbol" }) })
      );
      await client.releaseAuditHold(
        { ...validRelease, releaseReason: "Confirmed not a duplicate" },
        signer
      );
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
      expect(args[3].str()?.toString()).toBe("Confirmed not a duplicate");
    });

    it("returns the released hold with a dashboards-safe explanation", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({
          state: nativeToScVal("released", { type: "symbol" }),
          releasedBy: nativeToScVal("officer-a", { type: "string" }),
          releasedAt: nativeToScVal(2000n, { type: "u64" }),
        })
      );
      const response: ReleaseAuditHoldResponse = await client.releaseAuditHold(
        validRelease,
        signer
      );

      expect(response.holdId).toBe("hold-1");
      expect(response.hold.state).toBe("released");
      expect(response.explanation).toContain("released");
      expect(response.explanation).toContain("no longer blocks payroll");
    });

    it("never surfaces the hold's free-text note in the explanation", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({
          state: nativeToScVal("released", { type: "symbol" }),
          note: nativeToScVal("sensitive investigation detail", { type: "string" }),
        })
      );
      const response = await client.releaseAuditHold(validRelease, signer);
      expect(JSON.stringify(response)).not.toContain("sensitive investigation detail");
    });

    it("passes the default TESTNET passphrase to invoke", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({ state: nativeToScVal("released", { type: "symbol" }) })
      );
      await client.releaseAuditHold(validRelease, signer);
      expect(client.invokeStub.mock.calls[0][3]).toBe(Networks.TESTNET);
    });
  });

  describe("releaseAuditHold — validation edge cases (no RPC call)", () => {
    const validRelease = {
      holdId: "hold-1",
      releasedBy: "officer-a",
      authorizationToken: "a-valid-token-123",
    };

    it("rejects a release with an empty holdId before broadcasting", async () => {
      await expect(
        client.releaseAuditHold({ ...validRelease, holdId: "" }, signer)
      ).rejects.toBeInstanceOf(HoldReleaseAuthorizationError);
      expect(client.invokeStub).not.toHaveBeenCalled();
    });

    it("rejects a release with an empty releasedBy before broadcasting", async () => {
      await expect(
        client.releaseAuditHold({ ...validRelease, releasedBy: "" }, signer)
      ).rejects.toBeInstanceOf(HoldReleaseAuthorizationError);
      expect(client.invokeStub).not.toHaveBeenCalled();
    });

    it("rejects a release with a too-short authorizationToken before broadcasting", async () => {
      await expect(
        client.releaseAuditHold({ ...validRelease, authorizationToken: "short" }, signer)
      ).rejects.toBeInstanceOf(HoldReleaseAuthorizationError);
      expect(client.invokeStub).not.toHaveBeenCalled();
    });

    it("never leaks the rejected authorization token value in the error", async () => {
      let caught: unknown;
      try {
        await client.releaseAuditHold({ ...validRelease, authorizationToken: "bad" }, signer);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HoldReleaseAuthorizationError);
      expect(JSON.stringify(caught)).not.toContain('"bad"');
    });

    it("uses the error code COMPLIANCE_HOLD_RELEASE_UNAUTHORIZED", async () => {
      await expect(
        client.releaseAuditHold({ ...validRelease, holdId: "" }, signer)
      ).rejects.toMatchObject({ code: "COMPLIANCE_HOLD_RELEASE_UNAUTHORIZED" });
    });
  });

  describe("network passphrase override", () => {
    it("passes an explicit network argument through to invoke", async () => {
      client.invokeStub.mockResolvedValue(
        makeHoldStatusScVal({ state: nativeToScVal("released", { type: "symbol" }) })
      );
      await client.releaseAuditHold(
        { holdId: "hold-1", releasedBy: "officer-a", authorizationToken: "a-valid-token-123" },
        signer,
        Networks.PUBLIC
      );
      expect(client.invokeStub.mock.calls[0][3]).toBe(Networks.PUBLIC);
    });
  });
});
