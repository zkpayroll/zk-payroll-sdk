// SPDX-License-Identifier: MIT
/**
 * Thrown when a correction request has expired.
 */
export class CorrectionRequestExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionRequestExpiredError';
  }
}