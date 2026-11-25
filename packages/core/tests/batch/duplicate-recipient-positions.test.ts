/**
 * Tests for duplicate recipient position rejection (#831).
 *
 * Covers:
 *  - success: every recipient occupies exactly one position
 *  - rejection: the same recipient repeated, including whitespace variants
 *  - boundary: adjacent duplicate positions and a single-entry batch
 *  - integration: BatchPayloadBuilder and EmployeeBatchSchemaValidator
 */

import {
  findDuplicateRecipientPositions,
  formatDuplicateRecipientPositionMessage,
  normalizeRecipientPosition,
} from "../../src/batch/duplicateRecipientPositions";
import { BatchPayloadBuilder } from "../../src/batch/BatchPayloadBuilder";
import { EmployeeBatchSchemaValidator } from "../../src/batch/employeeBatchSchemaValidator";

const ALICE = "GALICE0000000000000000000000000000000000000000000000";
const BOB = "GBOB00000000000000000000000000000000000000000000000";

describe("duplicate recipient positions (#831)", () => {
  it("accepts a batch where every recipient occupies exactly one position", () => {
    const duplicates = findDuplicateRecipientPositions([
      { recipient: ALICE },
      { recipient: BOB },
    ]);

    expect(duplicates).toEqual([]);

    const errors = new BatchPayloadBuilder()
      .add({ recipient: ALICE, amount: 100n, asset: "native" })
      .add({ recipient: BOB, amount: 200n, asset: "native" })
      .validate();

    expect(errors).toEqual([]);
  });

  it("rejects a repeated recipient, including surrounding-whitespace variants", () => {
    const duplicates = findDuplicateRecipientPositions([
      { recipient: ALICE },
      { recipient: BOB },
      { recipient: `  ${ALICE}  ` },
    ]);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].normalizedRecipient).toBe(ALICE);
    expect(duplicates[0].firstPosition).toBe(0);
    expect(duplicates[0].duplicatePositions).toEqual([2]);

    const errors = new BatchPayloadBuilder()
      .add({ recipient: ALICE, amount: 100n, asset: "native" })
      .add({ recipient: BOB, amount: 200n, asset: "native" })
      .add({ recipient: ` ${ALICE} `, amount: 300n, asset: "native" })
      .validate();

    const duplicate = errors.find((error) => error.code === "DUPLICATE_RECIPIENT");
    expect(duplicate).toBeDefined();
    expect(duplicate?.index).toBe(2);
    expect(duplicate?.message).toContain("0");
    expect(duplicate?.message).toContain("2");
  });

  it("boundary: adjacent duplicate positions are rejected without echoing the address", () => {
    const duplicates = findDuplicateRecipientPositions([
      { recipient: ALICE },
      { recipient: ALICE },
    ]);

    expect(duplicates[0].positions).toEqual([0, 1]);

    const message = formatDuplicateRecipientPositionMessage(duplicates[0]);
    expect(message).toContain("0, 1");
    expect(message).not.toContain(ALICE);
  });

  it("boundary: a single-entry batch and blank recipients are never duplicate positions", () => {
    expect(findDuplicateRecipientPositions([{ recipient: ALICE }])).toEqual([]);
    expect(
      findDuplicateRecipientPositions([{ recipient: "   " }, { recipient: "" }, {}])
    ).toEqual([]);
    expect(normalizeRecipientPosition(` ${BOB} `)).toBe(BOB);
    expect(normalizeRecipientPosition(undefined)).toBeNull();
  });

  it("reports every extra position for a recipient repeated three times", () => {
    const duplicates = findDuplicateRecipientPositions([
      { recipient: ALICE },
      { recipient: BOB },
      { recipient: `${ALICE}\n` },
      { recipient: ALICE },
    ]);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].positions).toEqual([0, 2, 3]);
    expect(duplicates[0].duplicatePositions).toEqual([2, 3]);
  });

  it("applies the same rejection to employee batch validation", () => {
    const errors = new EmployeeBatchSchemaValidator()
      .add({ employeeId: "emp-1", recipient: ALICE, salary: 100n, asset: "native" })
      .add({ employeeId: "emp-2", recipient: ` ${ALICE} `, salary: 200n, asset: "native" })
      .validate();

    const duplicate = errors.find((error) => error.code === "DUPLICATE_RECIPIENT");
    expect(duplicate).toBeDefined();
    expect(duplicate?.index).toBe(1);
  });
});
