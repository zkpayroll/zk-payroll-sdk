import {
  ZkPayrollError,
  WalletError,
  WalletRejectionError,
  WalletErrorCode,
  ContractExecutionError,
  RpcTimeoutError,
  InvalidResponseError,
  ContractErrorCode,
  mapRpcError,
  toUserFriendlyError,
} from "../src";

describe("Typed SDK Wallet and RPC Errors (Issue #156)", () => {
  describe("WalletRejectionError", () => {
    it("should construct with default parameters", () => {
      const err = new WalletRejectionError();
      expect(err).toBeInstanceOf(WalletRejectionError);
      expect(err).toBeInstanceOf(WalletError);
      expect(err).toBeInstanceOf(ZkPayrollError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("WalletRejectionError");
      expect(err.code).toBe(WalletErrorCode.SIGNING_REJECTED);
      expect(err.message).toBe("User rejected the request in their wallet");
    });

    it("should preserve custom message, walletId, context, and cause", () => {
      const originalError = new Error("User clicked Cancel in Freighter popup");
      const err = new WalletRejectionError(
        "User declined to sign payroll batch",
        "freighter",
        WalletErrorCode.SIGNING_REJECTED,
        { batchId: "b-123" },
        originalError
      );

      expect(err.message).toBe("User declined to sign payroll batch");
      expect(err.walletId).toBe("freighter");
      expect(err.context).toEqual({ batchId: "b-123", walletId: "freighter" });
      expect(err.cause).toBe(originalError);
    });

    it("should produce user-friendly error representation", () => {
      const err = new WalletRejectionError("Rejected", "albedo");
      const friendly = toUserFriendlyError(err);
      expect(friendly.code).toBe(WalletErrorCode.SIGNING_REJECTED);
      expect(friendly.friendlyMessage).toContain("signing request was rejected");
      expect(friendly.originalError).toBe(err);
    });
  });

  describe("RpcTimeoutError", () => {
    it("should construct with default parameters and preserve cause", () => {
      const rawTimeout = new Error("ETIMEDOUT: Connection timed out after 30000ms");
      const err = new RpcTimeoutError(
        "RPC endpoint did not respond",
        { endpoint: "https://soroban-testnet.stellar.org" },
        rawTimeout
      );

      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err).toBeInstanceOf(ZkPayrollError);
      expect(err.name).toBe("RpcTimeoutError");
      expect(err.code).toBe(ContractErrorCode.RPC_TIMEOUT);
      expect(err.context).toEqual({ endpoint: "https://soroban-testnet.stellar.org" });
      expect(err.cause).toBe(rawTimeout);
    });

    it("should map user friendly message for RPC_TIMEOUT", () => {
      const err = new RpcTimeoutError();
      const friendly = toUserFriendlyError(err);
      expect(friendly.code).toBe(ContractErrorCode.RPC_TIMEOUT);
      expect(friendly.friendlyMessage).toContain("RPC endpoint timed out");
    });
  });

  describe("InvalidResponseError", () => {
    it("should construct with default parameters and preserve cause", () => {
      const rawError = new SyntaxError("Unexpected token < in JSON at position 0");
      const err = new InvalidResponseError(
        "Malformed JSON-RPC payload",
        { endpoint: "https://rpc.example.com" },
        rawError
      );

      expect(err).toBeInstanceOf(InvalidResponseError);
      expect(err).toBeInstanceOf(ContractExecutionError);
      expect(err).toBeInstanceOf(ZkPayrollError);
      expect(err.name).toBe("InvalidResponseError");
      expect(err.code).toBe(ContractErrorCode.INVALID_RESPONSE);
      expect(err.context).toEqual({ endpoint: "https://rpc.example.com" });
      expect(err.cause).toBe(rawError);
    });

    it("should map user friendly message for INVALID_RESPONSE", () => {
      const err = new InvalidResponseError();
      const friendly = toUserFriendlyError(err);
      expect(friendly.code).toBe(ContractErrorCode.INVALID_RESPONSE);
      expect(friendly.friendlyMessage).toContain("invalid or malformed response");
    });
  });

  describe("mapRpcError utility", () => {
    it("should map timeout exceptions into RpcTimeoutError with cause", () => {
      const cause = new Error("Request failed with status code 504 (Gateway Timeout)");
      const mapped = mapRpcError(cause, { requestId: "req-1" });

      expect(mapped).toBeInstanceOf(RpcTimeoutError);
      expect(mapped.code).toBe(ContractErrorCode.RPC_TIMEOUT);
      expect(mapped.cause).toBe(cause);
      expect(mapped.context).toEqual({ requestId: "req-1" });
    });

    it("should map malformed/parse error exceptions into InvalidResponseError with cause", () => {
      const cause = new Error("Unexpected response structure: missing result field");
      const mapped = mapRpcError(cause, { requestId: "req-2" });

      expect(mapped).toBeInstanceOf(InvalidResponseError);
      expect(mapped.code).toBe(ContractErrorCode.INVALID_RESPONSE);
      expect(mapped.cause).toBe(cause);
      expect(mapped.context).toEqual({ requestId: "req-2" });
    });

    it("should pass through existing ContractExecutionError untouched", () => {
      const existing = new ContractExecutionError(
        "Already typed",
        ContractErrorCode.CONTRACT_REVERT
      );
      const mapped = mapRpcError(existing);
      expect(mapped).toBe(existing);
    });
  });

  describe("Programmatic error categorization for SDK consumers", () => {
    it("should allow consumers to distinguish between wallet errors and RPC errors", () => {
      const walletErr: unknown = new WalletRejectionError("User declined", "freighter");
      const rpcErr: unknown = new RpcTimeoutError("Server didn't respond");

      const categorize = (err: unknown) => {
        if (err instanceof WalletError) {
          return err instanceof WalletRejectionError ? "WALLETS_USER_REJECTED" : "WALLET_GENERIC";
        }
        if (err instanceof ContractExecutionError) {
          if (err instanceof RpcTimeoutError) return "RPC_TIMEOUT";
          if (err instanceof InvalidResponseError) return "RPC_INVALID_RESPONSE";
          return "RPC_GENERIC";
        }
        return "UNKNOWN";
      };

      expect(categorize(walletErr)).toBe("WALLETS_USER_REJECTED");
      expect(categorize(rpcErr)).toBe("RPC_TIMEOUT");
    });
  });
});
