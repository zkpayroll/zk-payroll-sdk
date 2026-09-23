/**
 * Treasury Readiness Result Type (#276).
 *
 * Defines strongly typed structures and evaluation utilities for treasury
 * readiness checks, including balance sufficiency, reserve state, asset support,
 * and timestamp metadata.
 *
 * Designed for frontend dashboards, pre-execution gates, and audit reports
 * while enforcing privacy-safe defaults for logs and telemetry.
 */

/**
 * Categorization of treasury balance sufficiency against payroll obligations.
 */
export type TreasuryBalanceStatus =
  | "sufficient" // Balance covers required obligation + safety buffer
  | "low" // Balance covers obligation but falls below safety buffer
  | "insufficient" // Balance is less than required payout
  | "zero" // Balance is zero
  | "unknown"; // Balance could not be queried or verified

/**
 * Status of funding reservations allocated for payroll processing.
 */
export type TreasuryReserveStatus =
  | "ready" // Active reservations fully cover the obligation
  | "partially_reserved" // Some funds reserved, remainder pending
  | "unreserved" // No reservation created yet
  | "over_reserved" // Reserved amount exceeds obligation
  | "locked" // Treasury funds under compliance lock or admin hold
  | "expired"; // Reservation validity window has passed

/**
 * Support status of a specific asset within the treasury contract.
 */
export type AssetSupportStatus =
  | "supported" // Allowlisted and active
  | "unsupported" // Not allowlisted or unrecognized
  | "suspended" // Contract paused or maintenance mode
  | "insufficient_liquidity"; // Lacks trustline or liquidity depth

/**
 * Overall readiness level for dashboard banners and execution gates.
 */
export type TreasuryReadinessLevel =
  | "ready" // Safe to proceed without hesitation
  | "warning" // Non-blocking advisories (e.g. low buffer, unreserved draft)
  | "blocked"; // Hard blockers present (insufficient funds, unsupported asset, locks)

/**
 * Detailed readiness check for an individual asset.
 */
export interface AssetReadinessCheck {
  /** Asset identifier (e.g. "native", "USDC:G...", contract address) */
  asset: string;
  /** Required obligation amount in stroops */
  requiredAmount: bigint;
  /** Currently available unreserved balance in stroops */
  availableBalance: bigint;
  /** Currently locked/reserved amount in stroops */
  reservedAmount: bigint;
  /** Evaluated balance status */
  balanceStatus: TreasuryBalanceStatus;
  /** Evaluated reservation status */
  reserveStatus: TreasuryReserveStatus;
  /** Evaluated asset support status */
  supportStatus: AssetSupportStatus;
  /** Optional safety buffer percentage (e.g. 5 for 5%) */
  bufferPercent?: number;
  /** Shortfall amount if balance is insufficient (in stroops) */
  shortfallAmount?: bigint;
  /** Advisory warnings specific to this asset */
  warnings: string[];
  /** Blocking errors specific to this asset */
  blockers: string[];
}

/**
 * Complete typed result of a treasury readiness evaluation.
 */
export interface TreasuryReadinessResult {
  /** True if execution is not blocked (readinessLevel !== "blocked") */
  isReady: boolean;
  /** High-level operational readiness level */
  readinessLevel: TreasuryReadinessLevel;
  /** Aggregate balance status across all required assets */
  overallBalanceStatus: TreasuryBalanceStatus;
  /** Aggregate reserve status across all required assets */
  overallReserveStatus: TreasuryReserveStatus;
  /** Detailed per-asset readiness checks */
  assets: AssetReadinessCheck[];
  /** List of blocking error messages */
  blockers: string[];
  /** List of non-blocking advisory warnings */
  warnings: string[];
  /** Epoch milliseconds when the readiness check was computed */
  lastCheckedAt: number;
  /** Employer or treasury address */
  employerAddress?: string;
  /** Optional batch or draft identifier evaluated */
  batchId?: string;
  /** Extra diagnostic context */
  metadata?: Record<string, unknown>;
}

/**
 * Input parameters to evaluate treasury readiness.
 */
export interface EvaluateTreasuryReadinessInput {
  /** Employer or treasury public key */
  employerAddress?: string;
  /** Associated batch identifier */
  batchId?: string;
  /** Required asset obligations */
  obligations: {
    asset: string;
    requiredAmount: bigint;
    allowlisted?: boolean;
    suspended?: boolean;
  }[];
  /** Current treasury state per asset */
  treasuryBalances: {
    asset: string;
    availableBalance: bigint;
    reservedAmount?: bigint;
    isLocked?: boolean;
    isExpired?: boolean;
  }[];
  /** Optional global safety buffer percentage (e.g. 10 for 10% buffer) */
  defaultBufferPercent?: number;
  /** Extra metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for configuring readiness evaluation.
 */
export interface ReadinessEvaluationOptions {
  /** Strict mode treats warnings as blockers */
  strict?: boolean;
  /** Require funds to be strictly pre-reserved before reporting "ready" */
  requirePreReservation?: boolean;
}

/**
 * Evaluates treasury balances, reservations, and asset support to produce a typed TreasuryReadinessResult.
 */
export function evaluateTreasuryReadiness(
  input: EvaluateTreasuryReadinessInput,
  options: ReadinessEvaluationOptions = {}
): TreasuryReadinessResult {
  const lastCheckedAt = Date.now();
  const bufferPercent = input.defaultBufferPercent ?? 0;
  const assetChecks: AssetReadinessCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  const balanceMap = new Map<
    string,
    {
      availableBalance: bigint;
      reservedAmount: bigint;
      isLocked: boolean;
      isExpired: boolean;
    }
  >();

  for (const b of input.treasuryBalances) {
    balanceMap.set(b.asset, {
      availableBalance: b.availableBalance,
      reservedAmount: b.reservedAmount ?? 0n,
      isLocked: b.isLocked ?? false,
      isExpired: b.isExpired ?? false,
    });
  }

  for (const ob of input.obligations) {
    const assetBlockers: string[] = [];
    const assetWarnings: string[] = [];
    const assetState = balanceMap.get(ob.asset) ?? {
      availableBalance: 0n,
      reservedAmount: 0n,
      isLocked: false,
      isExpired: false,
    };

    // 1. Evaluate Asset Support Status
    let supportStatus: AssetSupportStatus = "supported";
    if (ob.suspended) {
      supportStatus = "suspended";
      assetBlockers.push(`Asset ${ob.asset} contract is currently suspended.`);
    } else if (ob.allowlisted === false) {
      supportStatus = "unsupported";
      assetBlockers.push(`Asset ${ob.asset} is not allowlisted in treasury policy.`);
    }

    // 2. Evaluate Balance Status
    const { status: balanceStatus, shortfall } = deriveBalanceStatus(
      assetState.availableBalance,
      ob.requiredAmount,
      bufferPercent
    );

    if (balanceStatus === "insufficient" || balanceStatus === "zero") {
      assetBlockers.push(
        `Insufficient treasury balance for ${ob.asset}. Shortfall: ${shortfall.toString()} stroops.`
      );
    } else if (balanceStatus === "low") {
      assetWarnings.push(
        `Treasury balance for ${ob.asset} is low. Below recommended ${bufferPercent}% buffer.`
      );
    }

    // 3. Evaluate Reserve Status
    let reserveStatus: TreasuryReserveStatus = "unreserved";
    if (assetState.isLocked) {
      reserveStatus = "locked";
      assetBlockers.push(`Treasury reservation for ${ob.asset} is locked under administrative hold.`);
    } else if (assetState.isExpired) {
      reserveStatus = "expired";
      assetBlockers.push(`Treasury reservation for ${ob.asset} has expired.`);
    } else {
      reserveStatus = deriveReserveStatus(assetState.reservedAmount, ob.requiredAmount);
      if (options.requirePreReservation && reserveStatus !== "ready" && reserveStatus !== "over_reserved") {
        assetBlockers.push(`Pre-reservation required for ${ob.asset}, but status is '${reserveStatus}'.`);
      } else if (reserveStatus === "unreserved" || reserveStatus === "partially_reserved") {
        assetWarnings.push(`Asset ${ob.asset} has pending reservation status: '${reserveStatus}'.`);
      }
    }

    assetChecks.push({
      asset: ob.asset,
      requiredAmount: ob.requiredAmount,
      availableBalance: assetState.availableBalance,
      reservedAmount: assetState.reservedAmount,
      balanceStatus,
      reserveStatus,
      supportStatus,
      bufferPercent,
      shortfallAmount: shortfall > 0n ? shortfall : undefined,
      warnings: assetWarnings,
      blockers: assetBlockers,
    });

    blockers.push(...assetBlockers);
    warnings.push(...assetWarnings);
  }

  // Determine aggregate statuses
  const overallBalanceStatus = resolveAggregateBalanceStatus(assetChecks);
  const overallReserveStatus = resolveAggregateReserveStatus(assetChecks);

  let readinessLevel: TreasuryReadinessLevel = "ready";
  if (blockers.length > 0 || (options.strict && warnings.length > 0)) {
    readinessLevel = "blocked";
  } else if (warnings.length > 0) {
    readinessLevel = "warning";
  }

  return {
    isReady: readinessLevel !== "blocked",
    readinessLevel,
    overallBalanceStatus,
    overallReserveStatus,
    assets: assetChecks,
    blockers,
    warnings,
    lastCheckedAt,
    employerAddress: input.employerAddress,
    batchId: input.batchId,
    metadata: input.metadata,
  };
}

/**
 * Calculates balance status and shortfall.
 */
export function deriveBalanceStatus(
  available: bigint,
  required: bigint,
  bufferPercent = 0
): { status: TreasuryBalanceStatus; shortfall: bigint } {
  if (available <= 0n && required > 0n) {
    return { status: "zero", shortfall: required };
  }
  if (available < required) {
    return { status: "insufficient", shortfall: required - available };
  }

  if (bufferPercent > 0) {
    const bufferMultiplier = 100n + BigInt(Math.floor(bufferPercent));
    const targetWithBuffer = (required * bufferMultiplier) / 100n;
    if (available < targetWithBuffer) {
      return { status: "low", shortfall: 0n };
    }
  }

  return { status: "sufficient", shortfall: 0n };
}

/**
 * Calculates reservation status.
 */
export function deriveReserveStatus(reserved: bigint, required: bigint): TreasuryReserveStatus {
  if (reserved === 0n) return "unreserved";
  if (reserved === required) return "ready";
  if (reserved > required) return "over_reserved";
  return "partially_reserved";
}

/**
 * Checks if treasury readiness result is green for batch execution.
 */
export function isTreasuryReadyForExecution(result: TreasuryReadinessResult): boolean {
  return result.isReady && result.blockers.length === 0;
}

/**
 * Formats a clean human-readable diagnostic report for dashboards or logs.
 */
export function formatTreasuryReadinessSummary(result: TreasuryReadinessResult): string {
  const icon =
    result.readinessLevel === "ready"
      ? "✅ READY"
      : result.readinessLevel === "warning"
      ? "⚠️ WARNING"
      : "🛑 BLOCKED";

  const lines = [
    `Treasury Readiness: ${icon}`,
    `Overall Balance: ${result.overallBalanceStatus} | Overall Reserve: ${result.overallReserveStatus}`,
    `Checked At: ${new Date(result.lastCheckedAt).toISOString()}`,
  ];

  if (result.employerAddress) {
    lines.push(`Employer: ${maskStellarAddress(result.employerAddress)}`);
  }

  if (result.assets.length > 0) {
    lines.push(`Assets Checked (${result.assets.length}):`);
    for (const a of result.assets) {
      lines.push(
        `  - ${a.asset}: balance=${a.balanceStatus}, reserve=${a.reserveStatus}, support=${a.supportStatus}`
      );
    }
  }

  if (result.blockers.length > 0) {
    lines.push(`Blockers (${result.blockers.length}):`);
    for (const b of result.blockers) {
      lines.push(`  ❌ ${b}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      lines.push(`  ⚠️ ${w}`);
    }
  }

  return lines.join("\n");
}

/**
 * Redacts addresses and sensitive payload metadata from a readiness result for telemetry/logging.
 */
export function redactTreasuryReadiness(
  result: TreasuryReadinessResult,
  placeholder = "[REDACTED]"
): TreasuryReadinessResult {
  return {
    ...result,
    employerAddress: result.employerAddress
      ? maskStellarAddress(result.employerAddress)
      : undefined,
    metadata: result.metadata ? redactMetadata(result.metadata, placeholder) : undefined,
  };
}

// ── Private Aggregation Helpers ─────────────────────────────────────────────

function resolveAggregateBalanceStatus(checks: AssetReadinessCheck[]): TreasuryBalanceStatus {
  if (checks.length === 0) return "unknown";
  if (checks.some((c) => c.balanceStatus === "insufficient")) return "insufficient";
  if (checks.some((c) => c.balanceStatus === "zero")) return "zero";
  if (checks.some((c) => c.balanceStatus === "low")) return "low";
  if (checks.every((c) => c.balanceStatus === "sufficient")) return "sufficient";
  return "unknown";
}

function resolveAggregateReserveStatus(checks: AssetReadinessCheck[]): TreasuryReserveStatus {
  if (checks.length === 0) return "unreserved";
  if (checks.some((c) => c.reserveStatus === "locked")) return "locked";
  if (checks.some((c) => c.reserveStatus === "expired")) return "expired";
  if (checks.every((c) => c.reserveStatus === "ready" || c.reserveStatus === "over_reserved")) {
    return "ready";
  }
  if (checks.some((c) => c.reserveStatus === "partially_reserved")) return "partially_reserved";
  return "unreserved";
}

function maskStellarAddress(address: string): string {
  if (!address || address.length <= 8) return "****";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function redactMetadata(
  meta: Record<string, unknown>,
  placeholder: string
): Record<string, unknown> {
  const sensitivePattern = /(salary|amount|wage|secret|token|private_?key|auth)/i;
  const clean: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(meta)) {
    if (sensitivePattern.test(k)) {
      clean[k] = placeholder;
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      clean[k] = redactMetadata(v as Record<string, unknown>, placeholder);
    } else {
      clean[k] = v;
    }
  }

  return clean;
}
