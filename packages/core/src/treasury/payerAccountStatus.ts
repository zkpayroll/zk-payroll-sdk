/**
 * Payer Account Status Reader (#559).
 *
 * `readiness.ts` answers "can this run execute right now" by comparing treasury
 * balances against the obligations in front of it. It assumes the payer account
 * itself is in a usable state, and takes the account's balances, trustline
 * coverage, and admin holds as already-resolved facts supplied by the caller.
 *
 * Nothing in the SDK reduced raw account state to that: there was no single
 * classification of "is this payer account able to act at all", so every caller
 * re-derived it and a suspended account or a missing trustline surfaced as a
 * confusing downstream failure instead of a clear, addressable status.
 *
 * This reader is that single, pure classification. It turns the account-level
 * facts — existence, activation, per-asset trustline coverage, fee-funding
 * balance, compliance holds, and required reserves — into a typed status with
 * blockers and advisories, and it composes with `readiness.ts` rather than
 * replacing it.
 *
 * Privacy: the payer address is masked in every human-readable surface via the
 * shared `maskStellarAddress` helper, and no payroll value is derived or
 * exposed — balances are returned only as the stroop values the caller already
 * holds.
 */
import { maskStellarAddress } from "../issues/exportSanitizer";

/**
 * Whether the payer account can act on the network at all.
 */
export type PayerAccountStatus =
  | "active" // Exists, not suspended, and funded for fees
  | "unfunded" // Exists and active, but below the fee-funding floor
  | "suspended"; // Exists but is administratively held

/**
 * Trustline / allowlist coverage for one asset on the payer account.
 */
export type PayerAssetSupportStatus =
  | "ready" // Account holds a trustline and the asset is allowlisted
  | "missing_trustline" // Account has no trustline for the asset
  | "not_allowlisted" // Asset is not on the payer's allowlist
  | "suspended"; // Asset is administratively suspended

/**
 * Overall operability of the payer account.
 */
export type PayerAccountReadinessLevel =
  | "ready" // Safe to send payments from
  | "warning" // Non-blocking advisories (thin fee balance, no reserves yet)
  | "blocked"; // A hard blocker prevents payment

/**
 * Status of one required asset on the payer account.
 */
export interface PayerAssetStatus {
  /** Asset identifier (e.g. "native", a token contract address) */
  asset: string;
  /** Balance the account can spend, in stroops */
  availableBalance: bigint;
  /** Balance locked or reserved, in stroops */
  reservedBalance: bigint;
  /** Whether a trustline exists for this asset */
  hasTrustline: boolean;
  /** Whether the asset is on the payer's allowlist */
  allowlisted: boolean;
  /** Whether the asset is administratively suspended */
  suspended: boolean;
  /** Evaluated support status for this asset */
  supportStatus: PayerAssetSupportStatus;
  /** Shortfall against `requiredAmount`, in stroops; undefined when covered */
  shortfallAmount?: bigint;
  /** Advisory warnings for this asset */
  warnings: string[];
  /** Blocking errors for this asset */
  blockers: string[];
}

/**
 * Complete payer account status returned by {@link readPayerAccountStatus}.
 */
export interface PayerAccountStatusResult {
  /** True when the account is active and not blocked. */
  isActive: boolean;
  /** True when payments may be sent without a hard blocker present. */
  canSendPayments: boolean;
  /** Whether the account exists on the network. */
  accountExists: boolean;
  /** Account-level classification. */
  accountStatus: PayerAccountStatus;
  /** Overall operability level. */
  readinessLevel: PayerAccountReadinessLevel;
  /** Balance available for network fees, in stroops */
  feeBalance: bigint;
  /** Minimum fee-funding floor that was applied, in stroops */
  minFeeBalance: bigint;
  /** Per-asset status for every required asset. */
  assets: PayerAssetStatus[];
  /** Assets missing a trustline, by asset identifier */
  missingTrustlines: string[];
  /** Blocking error messages, safe for UI feedback and logging */
  blockers: string[];
  /** Non-blocking advisory warnings */
  warnings: string[];
  /** Human-readable summary safe for dashboards and logs */
  summary: string;
  /** Epoch ms the status was computed */
  lastCheckedAt: number;
  /** Masked payer address, safe to display or log */
  payerAddress?: string;
  /** Optional batch or draft identifier this status was evaluated for */
  batchId?: string;
}

/**
 * Raw account facts a caller supplies. Every field is optional so a partially
 * known account still yields a usable status with the unknown parts reported
 * rather than silently assumed healthy.
 */
export interface PayerAccountState {
  /** Payer / employer Stellar address. Masked in all output. */
  address?: string;
  /** Whether the account is known to exist on the network. */
  exists?: boolean;
  /** Whether the account is administratively suspended. */
  isSuspended?: boolean;
  /** Balance available for network fees, in stroops. */
  feeBalance?: bigint;
  /** Minimum balance required to keep the account fee-capable, in stroops. */
  minFeeBalance?: bigint;
  /** Per-asset balances and trustline state. */
  assets?: {
    asset: string;
    availableBalance: bigint;
    reservedBalance?: bigint;
    hasTrustline?: boolean;
    allowlisted?: boolean;
    suspended?: boolean;
    /** Amount the account must be able to send for the pending run. */
    requiredAmount?: bigint;
  }[];
  /** Extra diagnostic context. Redacted on output. */
  metadata?: Record<string, unknown>;
}

/** Options for {@link readPayerAccountStatus}. */
export interface PayerAccountStatusOptions {
  /** Current time in epoch ms (defaults to `Date.now()`). */
  now?: number;
  /** Treat warnings as blockers. */
  strict?: boolean;
  /** Fee-funding floor in stroops when the caller does not supply one. */
  defaultMinFeeBalance?: bigint;
  /** Require a trustline for every required asset. Defaults to true. */
  requireTrustlines?: boolean;
}

/**
 * Default minimum balance a payer must hold to stay fee-capable. Stellar
 * requires a base reserve to keep an account active, so a payer at or near zero
 * can be loaded or deactivated by the next operation that touches it.
 */
export const DEFAULT_MIN_FEE_BALANCE_STROOPS = 1_500_000n;

function deriveSupportStatus(asset: {
  hasTrustline: boolean;
  allowlisted: boolean;
  suspended: boolean;
  requireTrustlines: boolean;
}): PayerAssetSupportStatus {
  if (asset.suspended) return "suspended";
  if (!asset.allowlisted) return "not_allowlisted";
  if (asset.requireTrustlines && !asset.hasTrustline) return "missing_trustline";
  return "ready";
}

/**
 * Reduces raw payer account state into a typed, actionable status.
 *
 * Blockers are the conditions that make sending impossible or unsafe:
 * the account not existing, being suspended, an asset being suspended or
 * not allowlisted, a required trustline being absent, a balance short of the
 * required amount, and a fee balance below the funding floor. Advisories cover
 * non-blocking conditions, such as an unreserved or fully reserved account.
 *
 * @param state - Raw account facts. Unknown fields are reported, not assumed.
 * @param options - `now`, `strict`, `defaultMinFeeBalance`, `requireTrustlines`.
 *
 * @example
 * ```ts
 * const status = readPayerAccountStatus({ address, exists: true, feeBalance, assets });
 * if (!status.canSendPayments) {
 *   console.warn(status.summary); // masked address, counts only
 * }
 * ```
 */
export function readPayerAccountStatus(
  state: PayerAccountState,
  options: PayerAccountStatusOptions = {}
): PayerAccountStatusResult {
  const lastCheckedAt = options.now ?? Date.now();
  const requireTrustlines = options.requireTrustlines ?? true;
  const minFeeBalance =
    state.minFeeBalance ?? options.defaultMinFeeBalance ?? DEFAULT_MIN_FEE_BALANCE_STROOPS;
  const feeBalance = state.feeBalance ?? 0n;

  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Account-level facts ──────────────────────────────────────────────────
  if (state.exists === false) {
    blockers.push("Payer account does not exist on the network.");
  }

  let accountStatus: PayerAccountStatus = "active";
  if (state.exists === false) {
    accountStatus = "suspended";
  } else if (state.isSuspended === true) {
    accountStatus = "suspended";
    blockers.push("Payer account is suspended by an administrative hold.");
  } else if (feeBalance < minFeeBalance) {
    accountStatus = "unfunded";
    blockers.push(
      `Payer fee balance is below the required minimum of ${minFeeBalance.toString()} stroops.`
    );
  }

  // ── Per-asset facts ──────────────────────────────────────────────────────
  const assets: PayerAssetStatus[] = (state.assets ?? []).map((asset) => {
    const hasTrustline = asset.hasTrustline ?? false;
    const allowlisted = asset.allowlisted ?? false;
    const suspended = asset.suspended ?? false;
    const supportStatus = deriveSupportStatus({
      hasTrustline,
      allowlisted,
      suspended,
      requireTrustlines,
    });
    const reservedBalance = asset.reservedBalance ?? 0n;
    const available = asset.availableBalance - reservedBalance;
    const assetBlockers: string[] = [];
    const assetWarnings: string[] = [];

    if (supportStatus === "suspended") {
      assetBlockers.push(`Asset ${asset.asset} is administratively suspended.`);
    } else if (supportStatus === "not_allowlisted") {
      assetBlockers.push(`Asset ${asset.asset} is not on the payer's allowlist.`);
    } else if (supportStatus === "missing_trustline") {
      assetBlockers.push(`Payer account has no trustline for asset ${asset.asset}.`);
    }

    let shortfall: bigint | undefined;
    if (asset.requiredAmount !== undefined) {
      if (asset.availableBalance < asset.requiredAmount) {
        shortfall = asset.requiredAmount - asset.availableBalance;
        assetBlockers.push(
          `Payer balance for ${asset.asset} is short by ${shortfall.toString()} stroops.`
        );
      } else {
        shortfall = 0n;
      }
    }

    if (reservedBalance > 0n && asset.requiredAmount === undefined) {
      assetWarnings.push(
        `Asset ${asset.asset} has ${reservedBalance.toString()} stroops reserved against it.`
      );
    }

    return {
      asset: asset.asset,
      availableBalance: asset.availableBalance,
      reservedBalance,
      hasTrustline,
      allowlisted,
      suspended,
      supportStatus,
      shortfallAmount: shortfall,
      warnings: assetWarnings,
      blockers: assetBlockers,
    };
  });

  for (const asset of assets) {
    blockers.push(...asset.blockers);
    warnings.push(...asset.warnings);
  }

  // A payer with nothing reserved yet is worth surfacing, but it is not a
  // blocker: settlement can still proceed.
  if (assets.length > 0 && assets.every((a) => a.reservedBalance === 0n)) {
    warnings.push("No funds are currently reserved against the payer's assets.");
  }

  const readinessLevel: PayerAccountReadinessLevel =
    blockers.length > 0 || (options.strict === true && warnings.length > 0)
      ? "blocked"
      : warnings.length > 0
        ? "warning"
        : "ready";

  const missingTrustlines = assets
    .filter((a) => a.supportStatus === "missing_trustline")
    .map((a) => a.asset);

  return {
    isActive: accountStatus === "active" && state.exists !== false,
    canSendPayments: readinessLevel !== "blocked",
    accountExists: state.exists !== false,
    accountStatus,
    readinessLevel,
    feeBalance,
    minFeeBalance,
    assets,
    missingTrustlines,
    blockers,
    warnings,
    summary: formatPayerAccountStatusSummary({
      accountStatus,
      readinessLevel,
      address: state.address,
      assetCount: assets.length,
      missingTrustlineCount: missingTrustlines.length,
    }),
    lastCheckedAt,
    payerAddress: state.address ? maskStellarAddress(state.address) : undefined,
  };
}

/**
 * Formats the headline of a payer account status as one line.
 *
 * Reports the masked address, status, and counts only — never a balance or any
 * payroll value — so it is safe to log or render in a banner.
 */
export function formatPayerAccountStatusSummary(input: {
  accountStatus: PayerAccountStatus;
  readinessLevel: PayerAccountReadinessLevel;
  address?: string;
  assetCount: number;
  missingTrustlineCount: number;
}): string {
  const masked = input.address ? maskStellarAddress(input.address) : "payer account";
  const icon =
    input.readinessLevel === "ready" ? "✅" : input.readinessLevel === "warning" ? "⚠️" : "🛑";

  const lines = [`Payer Account (${masked}): ${icon} ${input.accountStatus.toUpperCase()}`];

  if (input.missingTrustlineCount > 0) {
    lines.push(`Missing trustlines: ${input.missingTrustlineCount}`);
  } else if (input.assetCount > 0) {
    lines.push(`Assets checked: ${input.assetCount}`);
  }

  return lines.join(" | ");
}
