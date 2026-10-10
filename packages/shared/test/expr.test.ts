import { describe, expect, it } from 'vitest';
import { ExprError, checkCalculated, compileExpr, evaluate, inputsOf, parseExpr } from '../src/expr.js';

const run = (src: string, values: Record<string, unknown> = {}) => evaluate(parseExpr(src), (k) => values[k]);

describe('expression language', () => {
  it('follows the usual precedence and associativity', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('2 ^ 3 ^ 2')).toBe(512);
    expect(run('-2 ^ 2')).toBe(-4);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('7 % 4')).toBe(3);
    expect(run('1 < 2 && 2 < 3 || false')).toBe(true);
    expect(run('!(1 > 2)')).toBe(true);
    expect(run('1 > 2 ? 10 : 2 > 1 ? 20 : 30')).toBe(20);
  });

  it('reads keys, including dotted and quoted names', () => {
    expect(run('v * i * pf', { v: 230, i: 2, pf: 0.5 })).toBe(230);
    expect(run('meter.l1 + ["phase-2"]', { 'meter.l1': 1, 'phase-2': 2 })).toBe(3);
    expect(inputsOf(parseExpr('v * i + max(v, ["x-y"])')).sort()).toEqual(['i', 'v', 'x-y']);
  });

  it('has a fixed set of functions', () => {
    expect(run('abs(-3) + min(4, 2, 8) + max(1, 5)')).toBe(10);
    expect(run('round(2.345, 2)')).toBe(2.35);
    expect(run('round(2.5)')).toBe(3);
    expect(run('floor(2.7) + ceil(2.1) + sqrt(16) + pow(2, 3)')).toBe(17);
    expect(run('clamp(150, 0, 100)')).toBe(100);
    expect(run('round(log(exp(2)), 6)')).toBe(2);
    expect(() => parseExpr('eval(1)')).toThrow(/Unknown function "eval"/);
    expect(() => parseExpr('round()')).toThrow(/round takes 1 to 2 arguments/);
    expect(() => parseExpr('abs(1, 2)')).toThrow(/abs takes 1 argument/);
  });

  it('treats booleans as 0/1 in arithmetic and numbers as truthy in logic', () => {
    expect(run('gen_running * 50', { gen_running: true })).toBe(50);
    expect(run('a && b', { a: 1, b: 0 })).toBe(false);
    expect(run('true == 1 > 0')).toBe(true);
  });

  it('is missing (null) when an input is missing or not usable, or the result not finite', () => {
    expect(run('v * i', { v: 230 })).toBeNull();
    expect(run('v * 2', { v: 'high' })).toBeNull();
    expect(run('v * 2', { v: { nested: 1 } })).toBeNull();
    expect(run('1 / 0')).toBeNull();
    expect(run('0 / 0')).toBeNull();
    expect(run('sqrt(-1)')).toBeNull();
    expect(run('10 ^ 400')).toBeNull();
    // A missing branch that isn't taken doesn't matter.
    expect(run('ok ? 1 : missing', { ok: true })).toBe(1);
  });

  it('treats prototype names as ordinary (missing) keys', () => {
    expect(run('constructor + 1')).toBeNull();
    expect(run('__proto__ * 2')).toBeNull();
    expect(run('["toString"]')).toBeNull();
    expect(run('constructor + 1', { constructor: 1 })).toBe(2);
  });

  it('reports syntax errors with their position', () => {
    for (const [src, msg, pos] of [
      ['1 +', 'Expected a value', 3],
      ['(1 + 2', 'Expected ")"', 6],
      ['1 2', 'Unexpected "2"', 2],
      ['a ? 1', 'Expected ":"', 5],
      ['1 $ 2', 'Unexpected character "$"', 2],
      ['["unterminated', 'Unterminated key name', 0],
      ['', 'Expected a value', 0],
    ] as const) {
      try {
        parseExpr(src);
        expect.unreachable(src);
      } catch (err) {
        expect(err).toBeInstanceOf(ExprError);
        expect((err as ExprError).message).toContain(msg);
        expect((err as ExprError).pos).toBe(pos);
      }
    }
  });

  it('limits length and size', () => {
    expect(() => parseExpr(`1${' + 1'.repeat(130)}`)).toThrow(/at most 500 characters/);
    expect(() => parseExpr(Array.from({ length: 110 }, () => 'a').join('+'))).toThrow(/too complex/);
    expect(() => parseExpr(`${'('.repeat(60)}1${')'.repeat(60)}`)).toThrow(/too deeply nested/);
  });

  it('compileExpr returns errors instead of throwing', () => {
    expect(compileExpr('v * i')).toMatchObject({ ok: true, inputs: ['v', 'i'] });
    expect(compileExpr('v *')).toEqual({ ok: false, error: 'Expected a value', pos: 3 });
  });
});

describe('calculated key definitions', () => {
  const schema = [
    { key: 'v', label: 'Voltage', type: 'number' as const },
    { key: 'i', label: 'Current', type: 'number' as const },
    { key: 'energy_kwh', label: 'Energy', type: 'number' as const },
  ];

  it('accepts formulas over telemetry and earlier calculated keys', () => {
    expect(
      checkCalculated(
        [
          { key: 'power', label: 'Power', kind: 'formula', expr: 'v * i' },
          { key: 'power_kw', label: 'Power', kind: 'formula', expr: 'power / 1000' },
          { key: 'energy_used', label: 'Used', kind: 'counter_delta', source: 'energy_kwh' },
        ],
        schema,
      ),
    ).toEqual([]);
  });

  it('rejects clashes, repeats, later references, unknown sources and bad formulas', () => {
    const issues = checkCalculated(
      [
        { key: 'v', label: 'Clash', kind: 'formula', expr: '1' },
        { key: 'a', label: 'A', kind: 'formula', expr: 'b * 2' },
        { key: 'b', label: 'B', kind: 'formula', expr: '1' },
        { key: 'b', label: 'B again', kind: 'formula', expr: '2' },
        { key: 'c', label: 'C', kind: 'runtime', source: 'gen_running' },
        { key: 'd', label: 'D', kind: 'formula', expr: 'v *' },
      ],
      schema,
    );
    expect(issues).toEqual([
      { index: 0, field: 'key', message: '"v" is already a telemetry key' },
      { index: 1, field: 'expr', message: '"b" is calculated later; calculated keys can only use earlier ones' },
      { index: 3, field: 'key', message: '"b" is used twice' },
      { index: 4, field: 'source', message: 'No telemetry key "gen_running"' },
      { index: 5, field: 'expr', message: 'Expected a value (at 3)' },
    ]);
  });

  it('allows inputs the profile does not declare (devices may send undeclared keys)', () => {
    expect(checkCalculated([{ key: 'p', label: 'P', kind: 'formula', expr: 'undeclared * 2' }], schema)).toEqual([]);
  });
});
