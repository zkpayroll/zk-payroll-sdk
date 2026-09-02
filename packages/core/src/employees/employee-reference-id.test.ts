import { describe, it, expect } from 'vitest';
import { validateEmployeeReferenceId, assertValidEmployeeReferenceId } from './referenceId';

describe('Employee Reference ID Validator (#388)', () => {
  it('accepts valid reference IDs', () => {
    expect(validateEmployeeReferenceId('EMP_1001').isValid).toBe(true);
    expect(validateEmployeeReferenceId('emp-dev-42').isValid).toBe(true);
    expect(assertValidEmployeeReferenceId('  EMP-99  ')).toBe('EMP-99');
  });

  it('rejects too short or too long reference IDs', () => {
    expect(validateEmployeeReferenceId('ab').isValid).toBe(false);
    expect(validateEmployeeReferenceId('a'.repeat(65)).isValid).toBe(false);
  });

  it('rejects forbidden special characters or spaces', () => {
    expect(validateEmployeeReferenceId('EMP 100').isValid).toBe(false);
    expect(validateEmployeeReferenceId('EMP#100!').isValid).toBe(false);
    expect(() => assertValidEmployeeReferenceId('INVALID@ID')).toThrow('Invalid employee reference ID');
  });
});
