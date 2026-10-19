import { describe, expect, it } from 'vitest';
import { stackedLayout } from './DashboardGrid';

const at = (i: string, x: number, y: number, w: number, h: number) => ({ i, x, y, w, h });

describe('stackedLayout (dashboards on phones)', () => {
  it('reads the grid row by row and pairs narrow widgets', () => {
    const out = stackedLayout([at('chart', 0, 3, 12, 8), at('b', 3, 0, 3, 3), at('a', 0, 0, 3, 3), at('c', 6, 0, 3, 3), at('d', 9, 0, 3, 3)]);
    expect(out.map((o) => [o.i, o.full])).toEqual([
      ['a', false],
      ['b', false],
      ['c', false],
      ['d', false],
      ['chart', true],
    ]);
  });

  it('gives a narrow widget left on its own the full width', () => {
    const out = stackedLayout([at('a', 0, 0, 3, 3), at('b', 3, 0, 3, 3), at('c', 6, 0, 3, 3), at('wide', 0, 3, 12, 6)]);
    expect(out.map((o) => o.full)).toEqual([false, false, true, true]);
  });

  it('keeps short tiles compact and caps tall widgets', () => {
    const out = stackedLayout([at('kpi', 0, 0, 2, 3), at('gauge', 2, 0, 3, 5), at('table', 0, 5, 12, 20)]);
    expect(out.map((o) => o.height)).toEqual([112, 5 * 40 + 4 * 12, 560]);
  });
});
