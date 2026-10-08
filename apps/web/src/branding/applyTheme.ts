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

export type ThemeMode = 'light' | 'dark';
export const THEME_KEY = 'perspice.theme';

export function setThemeMode(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

export function currentThemeMode(): ThemeMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
