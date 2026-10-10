import type { AlarmListData, AlarmStatsData, EnergyData, FleetLatestData, HistoryData, LatestData, ListData, LocationsData, StatsData, WidgetDataResult } from '@perspice/shared';

export const isLatest = (d: unknown): d is LatestData => !!d && typeof d === 'object' && 'values' in d && 'device' in d;
export const isFleet = (d: unknown): d is FleetLatestData => !!d && typeof d === 'object' && 'devices' in d && !('truncated' in d);
export const isLocations = (d: unknown): d is LocationsData => !!d && typeof d === 'object' && 'devices' in d && 'truncated' in d;
export const isHistory = (d: unknown): d is HistoryData => !!d && typeof d === 'object' && 'series' in d;
export const isList = (d: unknown): d is ListData => !!d && typeof d === 'object' && 'items' in d && 'total' in d;
export const isStats = (d: unknown): d is StatsData => !!d && typeof d === 'object' && 'online' in d && 'total' in d;
export const isAlarmList = (d: unknown): d is AlarmListData => !!d && typeof d === 'object' && 'alarms' in d && 'total' in d;
export const isEnergy = (d: unknown): d is EnergyData => !!d && typeof d === 'object' && 'periods' in d && 'previous' in d;
export const isAlarmStats = (d: unknown): d is AlarmStatsData => !!d && typeof d === 'object' && 'unacknowledged' in d && 'critical' in d;

/** The data of a successful result, or undefined while loading / on error. */
export const dataOf = (r: WidgetDataResult | undefined): unknown => (r && r.ok ? r.data : undefined);
