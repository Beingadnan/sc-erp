export const ATTENDANCE_LABEL: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  half_day: 'Half day',
  leave: 'On leave',
};
export const ATTENDANCE_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue'> = {
  present: 'green',
  absent: 'red',
  late: 'amber',
  half_day: 'amber',
  leave: 'blue',
};
