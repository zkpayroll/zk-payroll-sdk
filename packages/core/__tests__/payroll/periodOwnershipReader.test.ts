import {
  createPeriodOwnership,
  readPeriodOwnership,
  hasOwnershipAuthority,
  canTransferOwnership,
  getEffectiveOwner,
  isOwnershipValid,
} from "../../src/payroll/periodOwnershipReader";

describe("Payroll Period Ownership Reader", () => {
  const periodId = "PERIOD001";
  const ownerId = "OWNER001";
  const otherOwnerId = "OWNER002";

  describe("createPeriodOwnership", () => {
    it("creates ownership with default values", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      expect(ownership.periodId).toBe(periodId);
      expect(ownership.ownerId).toBe(ownerId);
      expect(ownership.ownershipType).toBe("principal");
      expect(ownership.isTransferable).toBe(true);
      expect(ownership.status).toBe("active");
    });

    it("creates ownership with custom options", () => {
      const now = Date.now();
      const ownership = createPeriodOwnership(periodId, ownerId, {
        ownershipType: "organization",
        isTransferable: false,
        status: "suspended",
        ownershipTimestamp: now,
      });

      expect(ownership.ownershipType).toBe("organization");
      expect(ownership.isTransferable).toBe(false);
      expect(ownership.status).toBe("suspended");
      expect(ownership.ownershipTimestamp).toBe(now);
    });

    it("redacts owner ID by default", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      expect(ownership.redactedOwnerId).not.toBe(ownerId);
      expect(ownership.redactedOwnerId).toBeDefined();
    });

    it("handles different ownership types", () => {
      const types = ["principal", "organization", "delegate", "trustee"] as const;

      for (const type of types) {
        const ownership = createPeriodOwnership(periodId, ownerId, {
          ownershipType: type,
        });

        expect(ownership.ownershipType).toBe(type);
      }
    });
  });

  describe("readPeriodOwnership", () => {
    it("reads active ownership successfully", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);
      const result = readPeriodOwnership(periodId, ownership);

      expect(result.ownership).toEqual(ownership);
      expect(result.hasAccess).toBe(true);
      expect(result.accessors).toContain(ownerId);
    });

    it("throws error for revoked ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "revoked",
      });

      expect(() => {
        readPeriodOwnership(periodId, ownership);
      }).toThrow();
    });

    it("throws error for invalid period ID", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      expect(() => {
        readPeriodOwnership("", ownership);
      }).toThrow();
    });

    it("includes constraints when requested", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: false,
      });

      const result = readPeriodOwnership(periodId, ownership, {
        includeConstraints: true,
      });

      expect(result.constraints).toBeDefined();
      expect(result.constraints?.length).toBeGreaterThan(0);
      expect(result.constraints?.[0].type).toBe("ROLE_RESTRICTED");
    });

    it("excludes accessors when not requested", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      const result = readPeriodOwnership(periodId, ownership, {
        includeAccessors: false,
      });

      expect(result.accessors).toBeUndefined();
    });

    it("excludes constraints when not requested", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: false,
      });

      const result = readPeriodOwnership(periodId, ownership, {
        includeConstraints: false,
      });

      expect(result.constraints).toBeUndefined();
    });
  });

  describe("hasOwnershipAuthority", () => {
    it("returns true for the owner", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      expect(hasOwnershipAuthority(ownership, ownerId)).toBe(true);
    });

    it("returns false for non-owner", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      expect(hasOwnershipAuthority(ownership, otherOwnerId)).toBe(false);
    });

    it("returns false if ownership is not active", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "suspended",
      });

      expect(hasOwnershipAuthority(ownership, ownerId)).toBe(false);
    });

    it("returns false for transferred ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "transferred",
      });

      expect(hasOwnershipAuthority(ownership, ownerId)).toBe(false);
    });
  });

  describe("canTransferOwnership", () => {
    it("allows transfer for active transferable ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: true,
      });

      expect(canTransferOwnership(ownership)).toBe(true);
    });

    it("prevents transfer for non-transferable ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: false,
      });

      expect(canTransferOwnership(ownership)).toBe(false);
    });

    it("prevents transfer for inactive ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: true,
        status: "suspended",
      });

      expect(canTransferOwnership(ownership)).toBe(false);
    });

    it("respects transfer deadline constraints", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: true,
      });

      const constraints = [
        {
          type: "TRANSFER_DEADLINE" as const,
          description: "Transfer deadline passed",
          isActive: true,
        },
      ];

      expect(canTransferOwnership(ownership, constraints)).toBe(false);
    });

    it("allows transfer with inactive constraints", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        isTransferable: true,
      });

      const constraints = [
        {
          type: "TRANSFER_DEADLINE" as const,
          description: "Transfer deadline",
          isActive: false,
        },
      ];

      expect(canTransferOwnership(ownership, constraints)).toBe(true);
    });
  });

  describe("getEffectiveOwner", () => {
    it("returns owner for active ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "active",
      });

      expect(getEffectiveOwner(ownership)).toBe(ownerId);
    });

    it("returns original owner for non-active status without accessors", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "transferred",
      });

      expect(getEffectiveOwner(ownership)).toBe(ownerId);
    });

    it("returns first accessor for transferred ownership with accessors", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "transferred",
      });

      const accessors = [otherOwnerId];

      expect(getEffectiveOwner(ownership, accessors)).toBe(otherOwnerId);
    });

    it("returns original owner for transferred without accessors", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "transferred",
      });

      expect(getEffectiveOwner(ownership, undefined)).toBe(ownerId);
    });
  });

  describe("isOwnershipValid", () => {
    it("validates active ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "active",
      });

      expect(isOwnershipValid(ownership)).toBe(true);
    });

    it("invalidates inactive ownership", () => {
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "suspended",
      });

      expect(isOwnershipValid(ownership)).toBe(false);
    });

    it("invalidates ownership with empty owner ID", () => {
      const ownership = createPeriodOwnership(periodId, "", {
        status: "active",
      });

      expect(isOwnershipValid(ownership)).toBe(false);
    });

    it("invalidates ownership with future timestamp", () => {
      const futureTime = Date.now() + 1000000;
      const ownership = createPeriodOwnership(periodId, ownerId, {
        status: "active",
        ownershipTimestamp: futureTime,
      });

      expect(isOwnershipValid(ownership)).toBe(false);
    });
  });

  describe("Privacy and security", () => {
    it("redacts owner ID in results", () => {
      const ownership = createPeriodOwnership(periodId, ownerId);

      expect(ownership.redactedOwnerId).not.toBe(ownerId);
    });

    it("handles sensitive owner IDs", () => {
      const sensitiveOwnerId = "SECRET_OWNER_ID_12345";
      const ownership = createPeriodOwnership(periodId, sensitiveOwnerId);

      expect(ownership.ownerId).toBe(sensitiveOwnerId);
      expect(ownership.redactedOwnerId).not.toContain(sensitiveOwnerId);
    });
  });

  describe("Edge cases", () => {
    it("handles empty owner ID during creation", () => {
      const ownership = createPeriodOwnership(periodId, "");

      expect(ownership.ownerId).toBe("");
      expect(ownership.redactedOwnerId).toBeDefined();
    });

    it("handles special characters in IDs", () => {
      const specialOwnerId = "OWNER@#$%^&*()";
      const ownership = createPeriodOwnership(periodId, specialOwnerId);

      expect(ownership.ownerId).toBe(specialOwnerId);
    });

    it("handles different ownership statuses", () => {
      const statuses = ["active", "suspended", "transferred", "revoked"] as const;

      for (const status of statuses) {
        const ownership = createPeriodOwnership(periodId, ownerId, { status });
        expect(ownership.status).toBe(status);
      }
    });
  });
});
