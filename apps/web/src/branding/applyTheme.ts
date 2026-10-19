import { type BrandingDto, PALETTE_STEPS, generatePalette } from '@perspice/shared';

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

/** Applies white-label branding: palette CSS variables, title, favicon and custom CSS. */
export function applyTheme(b: BrandingDto, doc: Document = document): void {
  const root = doc.documentElement;
  const palette = generatePalette(b.primaryColor);
  for (const step of PALETTE_STEPS) root.style.setProperty(`--color-primary-${step}`, channels(palette[step]));
  root.style.setProperty('--color-accent', channels(b.accentColor));
  doc.title = b.productName;

  if (b.faviconUrl) {
    let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.href = b.faviconUrl;
  }

  let style = doc.getElementById('perspice-custom-css');
  if (b.customCss) {
    if (!style) {
      style = doc.createElement('style');
      style.id = 'perspice-custom-css';
      doc.head.appendChild(style);
    }
    style.textContent = b.customCss;
  } else {
    style?.remove();
  }
}

/** The appearance setting: follow the system (the default, per Apple's HIG), or a fixed one. */
export type Appearance = 'system' | 'light' | 'dark';
export const THEME_KEY = 'perspice.theme';

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

function paint(appearance: Appearance): void {
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function getAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function setAppearance(appearance: Appearance): void {
  try {
    if (appearance === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, appearance);
  } catch {
    /* storage unavailable */
  }
  paint(appearance);
}

/** Keeps "system" in step when the OS switches between light and dark (index.html sets the first paint). */
export function followSystemAppearance(): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => getAppearance() === 'system' && paint('system');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
