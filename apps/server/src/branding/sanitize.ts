import DOMPurify from 'isomorphic-dompurify';

/**
 * Custom CSS is injected into every page of a tenant, so remove anything that could load
 * remote resources or execute code: @import, absolute url(...), expression(), javascript:,
 * and attempts to close the surrounding <style> element.
 */
export function sanitizeCss(css: string): string {
  return css
    .replace(/<\/?\s*style[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript\s*:/gi, '')
    .replace(/url\(\s*(['"]?)\s*([a-z][a-z0-9+.-]*:|\/\/)[^)]*\)/gi, 'url()')
    .replace(/behavior\s*:/gi, '')
    .replace(/-moz-binding/gi, '')
    .slice(0, 50_000);
}

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
