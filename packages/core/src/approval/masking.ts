/**
 * Masks a sensitive identifier for safe display in errors and logs.
 *
 * Examples:
 *   maskIdentifier("GABCDEFGHIJKLMNOP") => "GAB***NOP"
 *   maskIdentifier("EMP-0001")         => "EMP***001"
 */
export function maskIdentifier(value: string): string {
  if (!value) return "***";
  const trimmed = value.trim();
  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 1)}***`;
  }
  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-3);
  return `${head}***${tail}`;
}
