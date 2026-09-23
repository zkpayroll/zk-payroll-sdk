import {
  SUPPORTED_HOLD_REASONS,
  HOLD_REASON_DEFINITIONS_MAP,
  isSupportedHoldReasonCode,
  getHoldReasonDefinition,
  getHoldReasonLabel,
  getHoldReasonShortDescription,
  listSupportedHoldReasons,
  listHoldReasonSelectOptions,
  HoldReasonCode,
} from "../src/compliance";

describe("Compliance Hold Reason Helpers", () => {
  const ALL_EXPECTED_CODES: HoldReasonCode[] = [
    "KYC_REVIEW_PENDING",
    "SANCTIONS_SCREENING",
    "TAX_WITHHOLDING_DISCREPANCY",
    "REGULATORY_INVESTIGATION",
    "DUPLICATE_PAYMENT_SUSPECTED",
    "MANUAL_REVIEW_REQUESTED",
    "OTHER",
  ];

  describe("isSupportedHoldReasonCode", () => {
    it("recognizes all standard supported hold reason codes", () => {
      for (const code of ALL_EXPECTED_CODES) {
        expect(isSupportedHoldReasonCode(code)).toBe(true);
      }
    });

    it("rejects unknown or invalid codes", () => {
      expect(isSupportedHoldReasonCode("UNKNOWN_CODE")).toBe(false);
      expect(isSupportedHoldReasonCode("")).toBe(false);
      expect(isSupportedHoldReasonCode(null)).toBe(false);
      expect(isSupportedHoldReasonCode(undefined)).toBe(false);
      expect(isSupportedHoldReasonCode(12345)).toBe(false);
    });
  });

  describe("getHoldReasonDefinition", () => {
    it("retrieves full definition for valid codes", () => {
      const kycDef = getHoldReasonDefinition("KYC_REVIEW_PENDING");
      expect(kycDef).toBeDefined();
      expect(kycDef?.code).toBe("KYC_REVIEW_PENDING");
      expect(kycDef?.label).toBe("KYC Review Pending");
      expect(kycDef?.category).toBe("identity");
      expect(kycDef?.shortDescription).toContain("Identity verification");

      const sanctionsDef = getHoldReasonDefinition("SANCTIONS_SCREENING");
      expect(sanctionsDef).toBeDefined();
      expect(sanctionsDef?.label).toBe("Sanctions Screening");
      expect(sanctionsDef?.category).toBe("screening");

      expect(HOLD_REASON_DEFINITIONS_MAP["KYC_REVIEW_PENDING"]).toBe(kycDef);
      expect(SUPPORTED_HOLD_REASONS.length).toBe(7);
    });

    it("returns undefined for unrecognized codes", () => {
      expect(getHoldReasonDefinition("INVALID_CODE")).toBeUndefined();
    });
  });

  describe("getHoldReasonLabel", () => {
    it("returns clear human-readable label for each code", () => {
      expect(getHoldReasonLabel("KYC_REVIEW_PENDING")).toBe("KYC Review Pending");
      expect(getHoldReasonLabel("SANCTIONS_SCREENING")).toBe("Sanctions Screening");
      expect(getHoldReasonLabel("TAX_WITHHOLDING_DISCREPANCY")).toBe("Tax Withholding Discrepancy");
      expect(getHoldReasonLabel("REGULATORY_INVESTIGATION")).toBe("Regulatory Investigation");
      expect(getHoldReasonLabel("DUPLICATE_PAYMENT_SUSPECTED")).toBe("Duplicate Payment Suspected");
      expect(getHoldReasonLabel("MANUAL_REVIEW_REQUESTED")).toBe("Manual Review Requested");
      expect(getHoldReasonLabel("OTHER")).toBe("Other Compliance Reason");
    });

    it("falls back to the raw input string for unknown codes", () => {
      expect(getHoldReasonLabel("CUSTOM_HOLD_REASON")).toBe("CUSTOM_HOLD_REASON");
    });
  });

  describe("getHoldReasonShortDescription", () => {
    it("returns descriptive summary for known codes", () => {
      expect(getHoldReasonShortDescription("TAX_WITHHOLDING_DISCREPANCY")).toContain(
        "tax calculations"
      );
      expect(getHoldReasonShortDescription("DUPLICATE_PAYMENT_SUSPECTED")).toContain("duplicate");
    });

    it("falls back gracefully for unknown codes without leaking sensitive data", () => {
      expect(getHoldReasonShortDescription("UNKNOWN")).toBe(
        "Unrecognized compliance hold reason code."
      );
    });
  });

  describe("listSupportedHoldReasons and listHoldReasonSelectOptions", () => {
    it("lists all 7 supported reasons in constant list", () => {
      const all = listSupportedHoldReasons();
      expect(all).toHaveLength(7);
      expect(all.map((item) => item.code)).toEqual(ALL_EXPECTED_CODES);
    });

    it("provides form select options with value and label pairs", () => {
      const options = listHoldReasonSelectOptions();
      expect(options).toHaveLength(7);
      expect(options[0]).toEqual({
        value: "KYC_REVIEW_PENDING",
        label: "KYC Review Pending",
      });
      expect(options.every((opt) => opt.value && opt.label)).toBe(true);
    });
  });
});
