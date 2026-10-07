// SPDX-License-Identifier: MIT
import { ICorrectionRequest, CorrectionRequestStatus } from '../types/payroll.js';
import { CorrectionRequestExpiredError } from '../errors/payroll.js';
import { DEFAULT_CORRECTION_REQUEST_TTL } from '../config/payroll.js';

/**
 * Handles correction request lifecycle with expiry validation.
 */
export class CorrectionRequestExpiry {
  private readonly ttl: number;
  private readonly createdAt: Date;

  constructor(request: ICorrectionRequest) {
    this.ttl = request.expiryTTL || DEFAULT_CORRECTION_REQUEST_TTL;
    this.createdAt = new Date(request.createdAt || Date.now());
  }

  /**
   * Validates if the request is still within its TTL window.
   * @throws {CorrectionRequestExpiredError} if expired
   */
  public validate(): void {
    const now = new Date();
    const expiryTime = new Date(this.createdAt.getTime() + this.ttl * 24 * 60 * 60 * 1000);

    if (now > expiryTime) {
      throw new CorrectionRequestExpiredError(
        `Correction request expired at ${expiryTime.toISOString()}`
      );
    }
  }

  /**
   * Checks if request is expired without throwing.
   */
  public isExpired(): boolean {
    const now = new Date();
    const expiryTime = new Date(this.createdAt.getTime() + this.ttl * 24 * 60 * 60 * 1000);
    return now > expiryTime;
  }
}