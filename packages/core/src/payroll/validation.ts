import { validateEmployeeReferenceId } from '../employees/referenceId';

export function validatePayrollDraftEmployeeRefs(employeeIds: string[]): { isValid: boolean; invalidIds: string[] } {
  const invalidIds: string[] = [];
  for (const id of employeeIds) {
    const res = validateEmployeeReferenceId(id);
    if (!res.isValid) {
      invalidIds.push(id);
    }
  }

  return {
    isValid: invalidIds.length === 0,
    invalidIds,
  };
}
