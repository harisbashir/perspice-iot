import { z } from 'zod';
import type { TelemetryKeyDef } from './api-types.js';
import { KEY_PATTERN } from './protocol.js';

/**
 * A small, safe expression language for calculated telemetry (spec §11): a tokenizer, a Pratt
 * parser producing a checked AST, and an evaluator that only walks that AST. No `eval`, no
 * property access, a fixed set of functions, and limits on size and nesting.
 */

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'key'; name: string }
  | { k: 'unary'; op: '-' | '!'; a: Expr }
  | { k: 'binary'; op: BinaryOp; a: Expr; b: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'call'; fn: FunctionName; args: Expr[] };

type BinaryOp = '+' | '-' | '*' | '/' | '%' | '^' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';
export type ExprValue = number | boolean | null;

export const EXPR_MAX_LENGTH = 500;
const MAX_NODES = 200;
const MAX_DEPTH = 50;

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}

const FUNCTIONS = {
  abs: [1, 1, Math.abs],
  min: [1, 20, Math.min],
  max: [1, 20, Math.max],
  round: [1, 2, (x: number, d = 0) => {
    const f = 10 ** Math.trunc(d);
    return Math.round(x * f) / f;
  }],
  floor: [1, 1, Math.floor],
  ceil: [1, 1, Math.ceil],
  sqrt: [1, 1, Math.sqrt],
  pow: [2, 2, Math.pow],
  log: [1, 1, Math.log],
  exp: [1, 1, Math.exp],
  clamp: [3, 3, (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)],
} as const satisfies Record<string, readonly [number, number, (...a: number[]) => number]>;
type FunctionName = keyof typeof FUNCTIONS;
export const EXPR_FUNCTIONS = Object.keys(FUNCTIONS) as FunctionName[];

// ── Tokens ─────────────────────────────────────────────────────────────────────────────────────

type Token = { t: 'num'; v: number; pos: number } | { t: 'name'; v: string; pos: number } | { t: 'key'; v: string; pos: number } | { t: 'op'; v: string; pos: number } | { t: 'end'; pos: number };

const OPERATORS = ['&&', '||', '<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '^', '<', '>', '!', '?', ':', '(', ')', ','];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (name) {
      out.push({ t: 'name', v: name[0], pos: i });
      i += name[0].length;
      continue;
    }
    if (src.startsWith('["', i)) {
      const end = src.indexOf('"]', i + 2);
      if (end < 0) throw new ExprError('Unterminated key name', i);
      out.push({ t: 'key', v: src.slice(i + 2, end), pos: i });
      i = end + 2;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character "${ch}"`, i);
    out.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

// ── Parser ─────────────────────────────────────────────────────────────────────────────────────

// Binding powers: [left, right]; right-associative operators bind tighter on the right side.
const INFIX: Record<string, [number, number]> = {
  '||': [1, 2],
  '&&': [3, 4],
  '==': [5, 6],
  '!=': [5, 6],
  '<': [7, 8],
  '<=': [7, 8],
  '>': [7, 8],
  '>=': [7, 8],
  '+': [9, 10],
  '-': [9, 10],
  '*': [11, 12],
  '/': [11, 12],
  '%': [11, 12],
  '^': [16, 15],
};
const PREFIX_POWER = 13; // below ^, so -2 ^ 2 = -(2 ^ 2)
const COND_POWER = 0;

/** Parses and checks an expression; throws ExprError with the position of the problem. */
export function parseExpr(src: string): Expr {
  if (src.length > EXPR_MAX_LENGTH) throw new ExprError(`An expression has at most ${EXPR_MAX_LENGTH} characters`, EXPR_MAX_LENGTH);
  const tokens = tokenize(src);
  let p = 0;
  let nodes = 0;
  const peek = () => tokens[p]!;
  const node = <T extends Expr>(e: T, pos: number): T => {
    if (++nodes > MAX_NODES) throw new ExprError('The expression is too complex', pos);
    return e;
  };
  const describe = (t: Token) => (t.t === 'end' ? 'end' : t.t === 'key' ? `["${t.v}"]` : `"${t.v}"`);
  const expectOp = (op: string) => {
    const t = peek();
    if (t.t !== 'op' || t.v !== op) throw new ExprError(`Expected "${op}"`, t.pos);
    p++;
  };

  function primary(depth: number): Expr {
    if (depth > MAX_DEPTH) throw new ExprError('The expression is too deeply nested', peek().pos);
    const t = peek();
    p++;
    if (t.t === 'num') return node({ k: 'num', v: t.v }, t.pos);
    if (t.t === 'key') return node({ k: 'key', name: t.v }, t.pos);
    if (t.t === 'name') {
      if (t.v === 'true' || t.v === 'false') return node({ k: 'bool', v: t.v === 'true' }, t.pos);
      const next = peek();
      if (next.t === 'op' && next.v === '(') {
        if (!(t.v in FUNCTIONS) || !Object.hasOwn(FUNCTIONS, t.v)) throw new ExprError(`Unknown function "${t.v}"`, t.pos);
        const fn = t.v as FunctionName;
        p++;
        const args: Expr[] = [];
        if (!(peek().t === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(expr(0, depth + 1));
            const sep = peek();
            if (sep.t === 'op' && sep.v === ',') {
              p++;
              continue;
            }
            break;
          }
        }
        expectOp(')');
        const [lo, hi] = FUNCTIONS[fn];
        if (args.length < lo || args.length > hi) {
          throw new ExprError(lo === hi ? `${fn} takes ${lo} argument${lo === 1 ? '' : 's'}` : `${fn} takes ${lo} to ${hi} arguments`, t.pos);
        }
        return node({ k: 'call', fn, args }, t.pos);
      }
      return node({ k: 'key', name: t.v }, t.pos);
    }
    if (t.t === 'op' && t.v === '(') {
      const inner = expr(0, depth + 1);
      expectOp(')');
      return inner;
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) {
      return node({ k: 'unary', op: t.v, a: expr(PREFIX_POWER, depth + 1) }, t.pos);
    }
    if (t.t === 'op' && t.v === '+') return expr(PREFIX_POWER, depth + 1);
    p--;
    throw new ExprError(t.t === 'end' ? 'Expected a value' : `Expected a value, not ${describe(t)}`, t.pos);
  }

  function expr(minPower: number, depth: number): Expr {
    let left = primary(depth);
    for (;;) {
      const t = peek();
      if (t.t !== 'op') break;
      if (t.v === '?') {
        if (COND_POWER < minPower) break;
        p++;
        const a = expr(0, depth + 1);
        expectOp(':');
        const b = expr(COND_POWER, depth + 1);
        left = node({ k: 'cond', c: left, a, b }, t.pos);
        continue;
      }
      const power = INFIX[t.v];
      if (!power || power[0] < minPower) break;
      p++;
      left = node({ k: 'binary', op: t.v as BinaryOp, a: left, b: expr(power[1], depth + 1) }, t.pos);
    }
    return left;
  }

  const result = expr(0, 0);
  const rest = peek();
  if (rest.t !== 'end') throw new ExprError(`Unexpected ${describe(rest)}`, rest.pos);
  return result;
}

export function compileExpr(src: string): { ok: true; expr: Expr; inputs: string[] } | { ok: false; error: string; pos: number } {
  try {
    const expr = parseExpr(src);
    return { ok: true, expr, inputs: inputsOf(expr) };
  } catch (err) {
    if (err instanceof ExprError) return { ok: false, error: err.message, pos: err.pos };
    throw err;
  }
}

/** The keys an expression reads, in order of first use. */
export function inputsOf(e: Expr): string[] {
  const seen = new Set<string>();
  const walk = (x: Expr): void => {
    switch (x.k) {
      case 'key':
        seen.add(x.name);
        return;
      case 'unary':
        return walk(x.a);
      case 'binary':
        walk(x.a);
        return walk(x.b);
      case 'cond':
        walk(x.c);
        walk(x.a);
        return walk(x.b);
      case 'call':
        return x.args.forEach(walk);
      default:
    }
  };
  walk(e);
  return [...seen];
}

// ── Evaluator ──────────────────────────────────────────────────────────────────────────────────

class Missing extends Error {}
const MISSING = new Missing();

const num = (v: number | boolean): number => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const truthy = (v: number | boolean): boolean => (typeof v === 'boolean' ? v : v !== 0);
const finite = (n: number): number => {
  if (!Number.isFinite(n)) throw MISSING;
  return n;
};

/**
 * Evaluates against `lookup` (a key's current value). Numbers and booleans are usable; anything
 * else, a missing key or a non-finite result makes the whole result missing (null).
 */
export function evaluate(e: Expr, lookup: (key: string) => unknown): ExprValue {
  const ev = (x: Expr): number | boolean => {
    switch (x.k) {
      case 'num':
      case 'bool':
        return x.v;
      case 'key': {
        const v = lookup(x.name);
        if (typeof v === 'number') return finite(v);
        if (typeof v === 'boolean') return v;
        throw MISSING;
      }
      case 'unary': {
        const a = ev(x.a);
        return x.op === '!' ? !truthy(a) : finite(-num(a));
      }
      case 'cond':
        return truthy(ev(x.c)) ? ev(x.a) : ev(x.b);
      case 'call':
        return finite((FUNCTIONS[x.fn][2] as (...a: number[]) => number)(...x.args.map((a) => num(ev(a)))));
      case 'binary': {
        if (x.op === '&&') return truthy(ev(x.a)) && truthy(ev(x.b));
        if (x.op === '||') return truthy(ev(x.a)) || truthy(ev(x.b));
        const a = ev(x.a);
        const b = ev(x.b);
        switch (x.op) {
          case '==':
            return num(a) === num(b);
          case '!=':
            return num(a) !== num(b);
          case '<':
            return num(a) < num(b);
          case '<=':
            return num(a) <= num(b);
          case '>':
            return num(a) > num(b);
          case '>=':
            return num(a) >= num(b);
          case '+':
            return finite(num(a) + num(b));
          case '-':
            return finite(num(a) - num(b));
          case '*':
            return finite(num(a) * num(b));
          case '/':
            return finite(num(a) / num(b));
          case '%':
            return finite(num(a) % num(b));
          case '^':
            return finite(num(a) ** num(b));
        }
      }
    }
  };
  try {
    return ev(e);
  } catch (err) {
    if (err instanceof Missing) return null;
    throw err;
  }
}

// ── Calculated key definitions ─────────────────────────────────────────────────────────────────

const Key = z.string().regex(KEY_PATTERN, 'Use letters, digits, ".", "_" or "-" (up to 64)');
const common = {
  key: Key,
  label: z.string().trim().min(1).max(100),
  unit: z.string().max(20).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
};

export const CalculatedKeySchema = z.discriminatedUnion('kind', [
  /** A formula over the device's values. */
  z.object({ ...common, kind: z.literal('formula'), expr: z.string().min(1).max(EXPR_MAX_LENGTH) }),
  /** Consumption since the previous reading of a cumulative counter (a reset counts the new value). */
  z.object({ ...common, kind: z.literal('counter_delta'), source: Key, maxDelta: z.number().positive().optional() }),
  /** Seconds the source was running (true or > 0) since the previous message. */
  z.object({ ...common, kind: z.literal('runtime'), source: Key, gapCapS: z.number().int().min(10).max(86_400).default(900) }),
  /** Decreases of a level (fuel used) beyond a deadband; increases (refuels) are ignored. */
  z.object({ ...common, kind: z.literal('fuel_used'), source: Key, deadband: z.number().min(0).default(0.5) }),
]);
export type CalculatedKey = z.infer<typeof CalculatedKeySchema>;
export type CalculatedKeyInput = z.input<typeof CalculatedKeySchema>;
export const CALCULATED_MAX = 20;
export const CalculatedKeysSchema = z.array(CalculatedKeySchema).max(CALCULATED_MAX);

export interface CalculatedIssue {
  index: number;
  field: 'key' | 'expr' | 'source';
  message: string;
}

/**
 * Checks definitions against the profile's telemetry keys: no clashes or repeats, formulas parse
 * and only use earlier calculated keys, stateful kinds read a declared or earlier key.
 */
export function checkCalculated(defs: readonly CalculatedKeyInput[], telemetry: readonly Pick<TelemetryKeyDef, 'key'>[]): CalculatedIssue[] {
  const declared = new Set(telemetry.map((t) => t.key));
  const all = new Set(defs.map((d) => d.key));
  const earlier = new Set<string>();
  const issues: CalculatedIssue[] = [];
  defs.forEach((d, index) => {
    if (declared.has(d.key)) issues.push({ index, field: 'key', message: `"${d.key}" is already a telemetry key` });
    else if (earlier.has(d.key)) issues.push({ index, field: 'key', message: `"${d.key}" is used twice` });
    if (d.kind === 'formula') {
      const c = compileExpr(d.expr);
      if (!c.ok) issues.push({ index, field: 'expr', message: `${c.error} (at ${c.pos})` });
      else {
        const later = c.inputs.find((k) => all.has(k) && !earlier.has(k) && !declared.has(k));
        if (later) issues.push({ index, field: 'expr', message: `"${later}" is calculated ${later === d.key ? 'here' : 'later'}; calculated keys can only use earlier ones` });
      }
    } else if (!declared.has(d.source) && !earlier.has(d.source)) {
      issues.push({ index, field: 'source', message: `No telemetry key "${d.source}"` });
    }
    earlier.add(d.key);
  });
  return issues;
}

/** A profile's keys for pickers and labels: its telemetry keys, then its calculated keys. */
export function profileKeys(profile: { telemetrySchema: TelemetryKeyDef[]; calculated?: readonly CalculatedKeyInput[] } | null | undefined): TelemetryKeyDef[] {
  if (!profile) return [];
  const calculated = (profile.calculated ?? []).map(
    (c): TelemetryKeyDef => ({ key: c.key, label: c.label, type: 'number', ...(c.unit ? { unit: c.unit } : {}), ...(c.decimals !== undefined ? { decimals: c.decimals } : {}) }),
  );
  return [...profile.telemetrySchema, ...calculated];
}
