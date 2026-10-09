import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Browser } from 'playwright-core';

export interface PdfRenderer {
  /** Opens the print page at `url`, waits until it reports ready, and prints it to PDF. */
  render(url: string): Promise<Buffer>;
}

export const PDF_RENDERER = Symbol('PDF_RENDERER');

const READY_TIMEOUT_MS = 60_000;

/** Headless Chromium via Playwright; only the `renderer` image ships a browser. */
@Injectable()
export class ChromiumRenderer implements PdfRenderer, OnApplicationShutdown {
  private readonly logger = new Logger(ChromiumRenderer.name);
  private browser?: Promise<Browser>;

  private launch(): Promise<Browser> {
    this.browser ??= import('playwright-core').then(({ chromium }) => chromium.launch({ chromiumSandbox: false }));
    return this.browser.catch((err: Error) => {
      this.browser = undefined;
      throw err;
    });
  }

  async render(url: string): Promise<Buffer> {
    const browser = await this.launch();
    // ~A4 landscape printable width at 96 dpi, so charts are laid out at the size they print.
    const context = await browser.newContext({ viewport: { width: 1050, height: 1400 } });
    const page = await context.newPage();
    try {
      page.on('pageerror', (err) => this.logger.warn(`Print page error: ${err.message}`));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const root = await page.waitForSelector('[data-print-state="ready"], [data-print-state="error"]', { timeout: READY_TIMEOUT_MS });
      if ((await root.getAttribute('data-print-state')) === 'error') {
        throw new Error((await root.textContent())?.trim() || 'The dashboard could not be rendered');
      }
      await page.emulateMedia({ media: 'print' });
      return await page.pdf({ format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    } finally {
      await context.close();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const browser = await this.browser?.catch(() => undefined);
    await browser?.close();
  }
}
