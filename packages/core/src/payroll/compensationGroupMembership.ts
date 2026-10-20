/**
 * Compensation group membership validation (#714).
 *
 * A compensation group is a named cohort of employees who share a pay
 * policy (a pay band, a bonus tier, a withholding rule set, etc). Nothing
 * in the SDK enforces that an employee belongs to exactly one group, or
 * that every group member is actually a known employee — a dashboard that
 * lets an admin freely edit group rosters can easily end up with an
 * employee listed in two conflicting groups, or a roster entry for an
 * employee who was removed. This module catches that before a client
 * submits anything derived from the grouping (e.g. per-group salary runs).
 *
 * @module
 */

/** A compensation group's membership roster. */
export interface CompensationGroup {
  /** Stable identifier for the group (e.g. a pay-band or bonus-tier id). */
  groupId: string;
  /** Human-readable label, used only in diagnostic messages. */
  label?: string;
  /** Employee identifiers currently assigned to this group. */
  memberIds: string[];
}

/** Options controlling which conditions are treated as violations. */
export interface CompensationGroupMembershipOptions {
  /**
   * The full set of known/active employee identifiers. When supplied, a
   * group member not present in this set is reported as an
   * `UNKNOWN_MEMBER` violation. Omit this to skip that check (e.g. when
   * validating group definitions before the employee roster is loaded).
   */
  knownEmployeeIds?: Iterable<string>;
  /**
   * When `true` (the default), every known employee must belong to at
   * least one group — an employee with no group membership is reported as
   * an `UNASSIGNED_EMPLOYEE` violation. Set `false` when groups are
   * optional (e.g. only employees with a non-standard pay policy get a
   * group, everyone else uses a default).
   */
  requireEveryEmployeeAssigned?: boolean;
}

/** Machine-readable violation codes. */
export type CompensationGroupViolationCode =
  | "EMPTY_GROUP_ID"
  | "DUPLICATE_GROUP_ID"
  | "EMPTY_MEMBER_ID"
  | "MULTIPLE_GROUP_MEMBERSHIP"
  | "UNKNOWN_MEMBER"
  | "UNASSIGNED_EMPLOYEE";

/** A single membership-integrity violation. */
export interface CompensationGroupViolation {
  code: CompensationGroupViolationCode;
  /** The employee this violation concerns, when applicable. */
  employeeId?: string;
  /** The group(s) involved, when applicable. */
  groupIds?: string[];
  /** Human-readable explanation. */
  message: string;
}

/** Result of validating a set of compensation groups. */
export interface CompensationGroupMembershipResult {
  /** `true` only when no violations were found. */
  valid: boolean;
  /** Every violation found, in a deterministic order (by code, then employee/group id). */
  violations: CompensationGroupViolation[];
  /** Resolved group membership: employee id → the group id(s) they belong to. */
  membershipByEmployee: Map<string, string[]>;
  /** Human-readable summary. */
  message: string;
}

/**
 * Validates compensation group definitions for membership-integrity
 * violations: duplicate group ids, malformed entries, an employee assigned
 * to more than one group, a group member who is not a known employee, and
 * (optionally) a known employee assigned to no group at all.
 *
 * This checks *membership integrity* only — it has no opinion on whether a
 * group's pay policy itself is valid; pair it with the payroll policy
 * compiler (`../policy`) or `salaryPolicyImpact` for that.
 *
 * @param groups - The compensation groups to validate.
 * @param options - See {@link CompensationGroupMembershipOptions}.
 * @returns A deterministic validation result; never throws on malformed
 *   input — malformed entries surface as violations instead, so a caller
 *   can report every problem in one pass rather than catching exceptions
 *   one at a time.
 */
export function validateCompensationGroupMembership(
  groups: CompensationGroup[],
  options: CompensationGroupMembershipOptions = {}
): CompensationGroupMembershipResult {
  const requireEveryEmployeeAssigned = options.requireEveryEmployeeAssigned ?? true;
  const violations: CompensationGroupViolation[] = [];
  const membershipByEmployee = new Map<string, string[]>();
  const seenGroupIds = new Set<string>();

  for (const group of groups) {
    if (typeof group.groupId !== "string" || group.groupId.length === 0) {
      violations.push({
        code: "EMPTY_GROUP_ID",
        message: "A compensation group has a missing or empty groupId",
      });
      continue;
    }

    if (seenGroupIds.has(group.groupId)) {
      violations.push({
        code: "DUPLICATE_GROUP_ID",
        groupIds: [group.groupId],
        message: `Group id "${group.groupId}" is defined more than once`,
      });
      continue;
    }
    seenGroupIds.add(group.groupId);

    for (const memberId of group.memberIds ?? []) {
      if (typeof memberId !== "string" || memberId.length === 0) {
        violations.push({
          code: "EMPTY_MEMBER_ID",
          groupIds: [group.groupId],
          message: `Group "${group.groupId}" lists a member with a missing or empty employee id`,
        });
        continue;
      }
      const existing = membershipByEmployee.get(memberId);
      if (existing) {
        existing.push(group.groupId);
      } else {
        membershipByEmployee.set(memberId, [group.groupId]);
      }
    }
  }

  for (const [employeeId, groupIds] of membershipByEmployee) {
    if (groupIds.length > 1) {
      violations.push({
        code: "MULTIPLE_GROUP_MEMBERSHIP",
        employeeId,
        groupIds: [...groupIds].sort(),
        message: `Employee "${employeeId}" belongs to ${groupIds.length} compensation groups (${[
          ...groupIds,
        ]
          .sort()
          .join(", ")}); an employee must belong to at most one group`,
      });
    }
  }

  if (options.knownEmployeeIds) {
    const knownIds = new Set(options.knownEmployeeIds);

    for (const [employeeId, groupIds] of membershipByEmployee) {
      if (!knownIds.has(employeeId)) {
        violations.push({
          code: "UNKNOWN_MEMBER",
          employeeId,
          groupIds: [...groupIds].sort(),
          message: `Employee "${employeeId}" is listed in group(s) ${[...groupIds]
            .sort()
            .join(", ")} but is not a known employee`,
        });
      }
    }

    if (requireEveryEmployeeAssigned) {
      for (const employeeId of knownIds) {
        if (!membershipByEmployee.has(employeeId)) {
          violations.push({
            code: "UNASSIGNED_EMPLOYEE",
            employeeId,
            message: `Employee "${employeeId}" is not assigned to any compensation group`,
          });
        }
      }
    }
  }

  violations.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const aKey = a.employeeId ?? a.groupIds?.[0] ?? "";
    const bKey = b.employeeId ?? b.groupIds?.[0] ?? "";
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });

  const valid = violations.length === 0;
  const message = valid
    ? `${groups.length} compensation group(s) validated with no membership violations`
    : `${violations.length} membership violation(s) found across ${groups.length} compensation group(s)`;

  return { valid, violations, membershipByEmployee, message };
}
