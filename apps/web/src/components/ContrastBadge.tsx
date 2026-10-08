import { contrastRatio } from '@perspice/shared';
import { Badge } from './ui/badge';

export const MIN_CONTRAST = 3;

/** WCAG contrast of the colour against white text (buttons use white on the primary colour). */
export function ContrastBadge({ color }: { color: string }) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return null;
  const ratio = contrastRatio(color, '#FFFFFF');
  const ok = ratio >= MIN_CONTRAST;
  return (
    <Badge variant={ok ? 'success' : 'danger'} title={`Contrast with white: ${ratio.toFixed(2)}:1`}>
      {ok ? 'Passes' : 'Fails'} {ratio.toFixed(1)}:1
    </Badge>
  );
}
