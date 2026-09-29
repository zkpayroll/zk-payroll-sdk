// SPDX-License-Identifier: MIT
import { expect, describe, it, beforeEach } from 'vitest';
import { CorrectionRequestExpiry } from '../../src/payroll/correction-request';
import { CorrectionRequestExpiredError } from '../../src/errors/payroll';
import { DEFAULT_CORRECTION_REQUEST_TTL } from '../../src/config/payroll';

describe('CorrectionRequestExpiry', () => {
  let expiry: CorrectionRequestExpiry;

  beforeEach(() => {
    const mockRequest = {
      id: 'test-123',
      status: 'PENDING',
      createdAt: new Date(),
    };
    expiry = new CorrectionRequestExpiry(mockRequest);
  });

  it('should validate active requests', () => {
    // Mock current time as 1 day after creation
    const originalDate = global.Date;
    global.Date = class extends Date {
      constructor() {
        super();
        this.setDate(this.getDate() + 1);
      }
    } as any;

    expect(() => expiry.validate()).not.toThrow();
    global.Date = originalDate;
  });

  it('should reject expired requests', () => {
    // Mock current time as 8 days after creation (default TTL = 7)
    const originalDate = global.Date;
    global.Date = class extends Date {
      constructor() {
        super();
        this.setDate(this.getDate() + 8);
      }
    } as any;

    expect(() => expiry.validate()).toThrow(CorrectionRequestExpiredError);
    global.Date = originalDate;
  });

  it('should respect custom TTL', () => {
    const customTTLRequest = {
      id: 'custom-ttl',
      status: 'PENDING',
      createdAt: new Date(),
      expiryTTL: 1, // 1 day TTL
    };
    const customExpiry = new CorrectionRequestExpiry(customTTLRequest);

    // Mock current time as 2 days after creation
    const originalDate = global.Date;
    global.Date = class extends Date {
      constructor() {
        super();
        this.setDate(this.getDate() + 2);
      }
    } as any;

    expect(() => customExpiry.validate()).toThrow(CorrectionRequestExpiredError);
    global.Date = originalDate;
  });

  it('should handle exact expiry edge case', () => {
    const exactExpiryRequest = {
      id: 'exact-expiry',
      status: 'PENDING',
      createdAt: new Date(0), // Unix epoch
      expiryTTL: 1, // 1 day TTL
    };
    const exactExpiry = new CorrectionRequestExpiry(exactExpiryRequest);

    // Mock current time as exactly 1 day after epoch
    const originalDate = global.Date;
    global.Date = class extends Date {
      constructor() {
        super(86400000); // 1 day in ms
      }
    } as any;

    expect(() => exactExpiry.validate()).toThrow(CorrectionRequestExpiredError);
    global.Date = originalDate;
  });

  it('should provide non-throwing expiry check', () => {
    // Mock current time as 8 days after creation
    const originalDate = global.Date;
    global.Date = class extends Date {
      constructor() {
        super();
        this.setDate(this.getDate() + 8);
      }
    } as any;

    expect(expiry.isExpired()).toBe(true);
    global.Date = originalDate;
  });
});