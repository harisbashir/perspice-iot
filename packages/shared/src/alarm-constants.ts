// Shared by alarms.ts and dashboard.ts (kept separate to avoid an import cycle).

export const ALARM_SEVERITIES = ['critical', 'major', 'minor', 'warning'] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];

export const ALARM_STATUSES = ['active', 'acknowledged', 'cleared'] as const;
export type AlarmStatus = (typeof ALARM_STATUSES)[number];
