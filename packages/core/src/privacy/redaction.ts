import { createHash } from 'node:crypto';

/**
 * Redacts or hashes sensitive employee reference IDs to prevent privacy leaks.
 */
export function hashEmployeeReferenceId(referenceId: string, salt: string = 'zk-payroll-salt'): string {
  if (!referenceId) return '';
  return createHash('sha256')
    .update(`${salt}:${referenceId}`)
    .digest('hex')
    .substring(0, 16);
}

export function redactSensitivePayload<T extends Record<string, any>>(data: T, secretKeys: string[] = ['employeeId', 'secret', 'ssn', 'memo']): T {
  const copy = { ...data } as Record<string, any>;
  for (const key of Object.keys(copy)) {
    if (secretKeys.includes(key)) {
      copy[key] = '[REDACTED]';
    }
  }
  return copy as T;
}
