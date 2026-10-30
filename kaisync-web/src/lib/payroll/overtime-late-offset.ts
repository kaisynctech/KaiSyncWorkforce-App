/** Payable overtime after HR chooses to take that day's lateness off the overtime. */

export function payableOvertimeHours(
  overtimeHours: number,
  lateMinutes: number,
  offsetLate: boolean,
): number {
  const overtime = Math.max(0, Number(overtimeHours) || 0)
  if (!offsetLate) return Math.round(overtime * 100) / 100
  const lateHours = Math.max(0, Number(lateMinutes) || 0) / 60
  return Math.round(Math.max(0, overtime - lateHours) * 100) / 100
}
