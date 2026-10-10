import type { AlarmRuleInput } from '@perspice/shared';

const OP: Record<string, string> = { '>': 'above', '>=': 'at or above', '<': 'below', '<=': 'at or below' };
const dur = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);

type RuleCore = AlarmRuleInput extends infer R ? (R extends AlarmRuleInput ? Pick<R, 'type' | 'condition' | 'clear'> : never) : never;

/** A rule's condition in words, e.g. "fuel_level below 20 (clears at 22)". */
export function describeRule(r: RuleCore, label: (key: string) => string = (k) => k): string {
  switch (r.type) {
    case 'threshold': {
      const { key, op, value } = r.condition;
      const m = r.clear.margin;
      return `${label(key)} ${OP[op]} ${value}` + (m ? ` (clears at ${op.startsWith('<') ? value + m : value - m})` : '');
    }
    case 'range': {
      const { key, min, max, mode } = r.condition;
      return `${label(key)} ${mode === 'outside' ? 'outside' : 'inside'} ${min}–${max}` + (r.clear.margin ? ` (margin ${r.clear.margin})` : '');
    }
    case 'duration': {
      const { key, op, value, forS } = r.condition;
      return `${label(key)} ${OP[op]} ${value} for ${dur(forS)}`;
    }
    case 'rate_of_change': {
      const { key, perMinute, direction } = r.condition;
      const dir = direction === 'up' ? 'rises' : direction === 'down' ? 'falls' : 'changes';
      return `${label(key)} ${dir} faster than ${perMinute}/min`;
    }
    case 'state_match':
      return `${label(r.condition.key)} is ${r.condition.values.map((v) => JSON.stringify(v)).join(' or ')}`;
    case 'status':
      return `Device is ${r.condition.statuses.join(' or ')}`;
    case 'no_data_key':
      return `No ${label(r.condition.key)} for ${dur(r.condition.forS)}`;
    case 'geofence':
      return `Device ${r.condition.trigger === 'inside' ? 'enters' : 'leaves'} the geofence` + (r.clear.marginM ? ` (clears ${r.clear.marginM} m back)` : '');
  }
}
