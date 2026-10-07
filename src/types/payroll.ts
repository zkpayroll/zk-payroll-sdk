// SPDX-License-Identifier: MIT
import { CorrectionRequestStatus } from './enums.js';

/**
 * Extended correction request interface with expiry metadata.
 */
export interface ICorrectionRequest {
  id: string;
  status: CorrectionRequestStatus;
  createdAt: string | Date;
  expiryTTL?: number; // Optional TTL in days (defaults to config)
  [key: string]: unknown; // Allow additional metadata
}