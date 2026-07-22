// fixtures/amplitude-fixtures.ts
//
// Playwright equivalent of cypress/support/commands.js.
//
// Cypress had to monkey-patch window.fetch/sendBeacon/XMLHttpRequest from inside the
// browser (via onBeforeLoad) and manually pipe ReadableStream/gzip bodies through
// DecompressionStream just to get at the outbound Amplitude payload.
//
// Playwright doesn't need any of that: `page.on('request')` observes every request the
// browser makes (without altering it), and `request.postDataBuffer()` hands back the exact
// bytes placed on the wire — so the gzip payload the Amplitude SDK sends can be decompressed
// directly in Node with zlib.

import { test as base, expect, Page, BrowserContext, Request } from '@playwright/test';
import * as zlib from 'zlib';

export interface AmplitudeEvent {
  event_type?: string;
  time?: number;
  insert_id?: string;
  event_properties?: Record<string, any>;
  [key: string]: any;
}

interface RequestLogEntry {
  url: string;
  encoding: string;
  byteLength: number;
  parsedEventCount: number;
}

// Matches any Amplitude ingestion endpoint (US, EU, and /batch variants).
function isAmplitudeHttpApi(url: string): boolean {
  return url.includes('amplitude.com') && (url.includes('/2/') || url.includes('/batch'));
}

// Decodes an Amplitude request body, transparently handling gzip (by header or magic bytes).
async function decodeAmplitudeBody(req: Request): Promise<AmplitudeEvent[]> {
  const buf = req.postDataBuffer();
  if (!buf) return [];

  try {
    const headers = await req.allHeaders();
    const encoding = (headers['content-encoding'] || '').toLowerCase();
    const looksGzipped = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;

    const text = encoding.includes('gzip') || looksGzipped
      ? zlib.gunzipSync(buf).toString('utf-8')
      : buf.toString('utf-8');

    const parsed = JSON.parse(text);
    const events = parsed?.events || parsed?.e;
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

export class AmplitudeCapture {
  readonly events: AmplitudeEvent[] = [];
  readonly urls: string[] = [];
  readonly requestLog: RequestLogEntry[] = [];
  private readonly seenInsertIds = new Set<string>();

  constructor(private readonly page: Page) {
    page.on('request', (req) => {
      void this.handleRequest(req);
    });
  }

  private async handleRequest(req: Request): Promise<void> {
    const url = req.url();
    if (req.method() !== 'POST' || !isAmplitudeHttpApi(url)) return;

    this.urls.push(url);
    const buf = req.postDataBuffer();
    const headers = await req.allHeaders().catch(() => ({} as Record<string, string>));

    const events = await decodeAmplitudeBody(req);
    this.requestLog.push({
      url,
      encoding: headers['content-encoding'] || '',
      byteLength: buf ? buf.length : 0,
      parsedEventCount: events.length,
    });

    events.forEach((evt) => {
      const key = evt?.insert_id;
      if (key) {
        if (this.seenInsertIds.has(key)) return;
        this.seenInsertIds.add(key);
      }
      this.events.push(evt);
    });
  }

  // Navigates to a page. Amplitude capture is already wired up via the request listener,
  // so unlike Cypress's visitWithAmplitudeCapture there is nothing to install per-visit.
  async visit(path: string, options: Parameters<Page['goto']>[1] = {}): Promise<void> {
    await this.page.goto(path, options);
  }

  // Flushes the Amplitude SDK's event queue immediately instead of waiting for its
  // normal batching interval. Mirrors the `win.amplitude.flush()` calls in the Cypress spec.
  async flush(): Promise<void> {
    await this.page.evaluate(() => {
      const w = window as any;
      if (w.amplitude?.flush) return w.amplitude.flush();
    });
  }

  getEvents(eventType: string | null = null, newestFirst = false): AmplitudeEvent[] {
    let events = this.events;
    if (eventType) events = events.filter((e) => e?.event_type === eventType);
    if (newestFirst) {
      events = [...events].sort((a, b) => (b?.time || 0) - (a?.time || 0));
    }
    return events;
  }

  private buildDiagnostics(): string {
    const allUrls = [...new Set(this.urls)];
    const urlHint = allUrls.length
      ? `\n  Amplitude URLs : ${allUrls.join(', ')}`
      : '\n  Amplitude URLs : (none)';

    const reqHint = this.requestLog.length
      ? `\n  Requests seen  : ${this.requestLog
          .map((r) => `${r.url} [enc:${r.encoding || 'none'}, bytes:${r.byteLength}, events:${r.parsedEventCount}]`)
          .join(' | ')}`
      : '\n  Requests seen  : (none for amplitude.com)';

    return urlHint + reqHint;
  }

  private summarizeEvent(evt: AmplitudeEvent) {
    const p = evt?.event_properties || {};
    const out: Record<string, any> = { event_type: evt?.event_type };
    Object.keys(p).forEach((k) => {
      if (p[k] !== undefined) out[k] = p[k];
    });
    return out;
  }

  // Waits for a specific Amplitude event, optionally matched against a predicate.
  async waitForEvent(
    eventType: string,
    predicate: ((evt: AmplitudeEvent) => boolean) | null = null,
    timeoutMs = 60000
  ): Promise<AmplitudeEvent> {
    const start = Date.now();

    while (true) {
      const matches = this.events.filter((e) => e?.event_type === eventType);
      const filtered = predicate
        ? matches.filter((e) => {
            try {
              return !!predicate(e);
            } catch {
              return false;
            }
          })
        : matches;

      if (filtered.length > 0) return filtered[filtered.length - 1];

      if (Date.now() - start > timeoutMs) {
        const seen = [...new Set(this.events.map((e) => e?.event_type).filter(Boolean))];
        const diag = this.buildDiagnostics();

        if (matches.length > 0 && predicate) {
          const summary = this.summarizeEvent(matches[matches.length - 1]);
          throw new Error(
            `Amplitude event captured but predicate did not match: ${eventType}. ` +
              `Captured ${matches.length} event(s). Seen: ${seen.join(', ') || '(none)'}` +
              diag +
              `\n  Last event     : ${JSON.stringify(summary)}`
          );
        }

        throw new Error(
          `Amplitude event not captured: ${eventType}. ` + `Seen: ${seen.join(', ') || '(none)'}` + diag
        );
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// Returns hostname from Playwright's configured baseURL, if any.
function getBaseUrlHost(baseURL?: string): string | null {
  if (!baseURL) return null;
  try {
    return new URL(baseURL).hostname;
  } catch {
    return null;
  }
}

// Returns domains where OneTrust consent cookies should be applied.
function getConsentDomains(baseURL?: string): string[] {
  const domains = new Set(['qa.commonsense.org', 'www.commonsense.org']);
  const baseHost = getBaseUrlHost(baseURL);
  if (baseHost) domains.add(baseHost);
  return Array.from(domains);
}

// Sets OneTrust cookies to enable analytics tracking before page load.
async function setOneTrustAnalyticsConsent(context: BrowserContext, baseURL?: string): Promise<void> {
  const now = new Date();
  const domains = getConsentDomains(baseURL);

  const consentValue =
    'isIABGlobal=false' +
    '&datestamp=' +
    encodeURIComponent(now.toString()) +
    '&version=202401.1.0' +
    '&consentId=playwright-consent' +
    '&interactionCount=1' +
    '&groups=' +
    encodeURIComponent('C0001:1,C0002:1') +
    '&AwaitingReconsent=false';

  const cookies = domains.flatMap((domain) => [
    { name: 'OptanonAlertBoxClosed', value: 'true', domain, path: '/', secure: true },
    { name: 'OptanonConsent', value: consentValue, domain, path: '/', secure: true },
    { name: 'OptanonActiveGroups', value: ',C0001,C0002,', domain, path: '/', secure: true },
  ]);

  await context.addCookies(cookies);
}

// Dismisses the CTA redirect modal that otherwise blocks clicks on some collection pages.
export async function dismissCtaModal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById('cta-modal-redirect');
    if (el) {
      (el as HTMLElement).style.display = 'none';
      el.classList.remove('show');
    }
    document.body.classList.remove('modal-open');
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) backdrop.remove();
  });
  await page.waitForTimeout(1000);
}

type AmplitudeFixtures = {
  amplitude: AmplitudeCapture;
};

export const test = base.extend<AmplitudeFixtures>({
  amplitude: async ({ page, context, baseURL }, use) => {
    await setOneTrustAnalyticsConsent(context, baseURL);
    const capture = new AmplitudeCapture(page);
    await use(capture);
  },
});

export { expect };
