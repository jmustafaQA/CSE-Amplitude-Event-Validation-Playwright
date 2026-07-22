# CSE Amplitude Event Validation (Playwright)

Playwright-based framework for validating critical Amplitude analytics events on Common Sense Education pages.

This is a Playwright/TypeScript port of [CSE-Amplitude-Event-Validation](https://github.com/jmustafaQA/CSE-Amplitude-Event-Validation) (Cypress). Test cases, assertions, and reporting are functionally identical; only the execution engine and network-capture mechanism changed.

This project verifies that high-value analytics events are:

* Emitted from the browser
* Delivered to Amplitude over the network
* Structured with correct CMS metadata and routing information
* Aligned with expected analytics contract guarantees

This is end-to-end analytics contract validation in a real QA environment.

---

## Why Playwright Is Used

Analytics behavior depends on real browser conditions:

* A real browser session
* Consent gating via OneTrust
* Amplitude SDK initialization timing
* Page lifecycle events (load, navigation, interaction)
* Network-level verification of outbound analytics traffic

Playwright's built-in request interception (`page.on('request')`) observes every outbound network call — including the Amplitude SDK's gzip-compressed batch payloads — without needing to patch `window.fetch`/`sendBeacon`/`XMLHttpRequest` from inside the page, the way the original Cypress framework had to. The raw POST body is available directly in Node, so decompression is a single `zlib.gunzipSync` call instead of piping `ReadableStream`s through `DecompressionStream` in-browser.

Playwright also does not fail a test on an uncaught page-level JavaScript error by default (Cypress does), so several Cypress-only workarounds — `cy.on('uncaught:exception', () => false)`, per-visit `onBeforeLoad` error suppression, `failOnStatusCode: false` for the 404 case — have no equivalent here and were dropped rather than translated. See the comment block at the top of `tests/amplitude_events.spec.ts` for details.

---

## Suite Scope

This suite started as Tier-1 smoke coverage and has evolved into analytics contract validation.

Events covered here are:

* Release-critical
* Expected to fire on page visit or primary interaction
* Required for reporting accuracy
* Stable across frontend refactors and CMS changes

Assertions intentionally include stable CMS identifiers (node IDs, content types, route names) to prevent silent analytics regressions.

---

## What This Covers

### Viewed (Page View) Events

* Viewed Search — `/education/search`
* Viewed Lesson Info — `/education/digital-literacy`, `/education/digital-citizenship`, `/education/uk/digital-citizenship`
* Viewed Edu Home Page — `/education`
* Viewed Lesson Plan — `/education/digital-literacy/what-is-media`
* Viewed Course, Viewed Article, Viewed Lesson Collection, Viewed 404 Page, Viewed Video, Viewed Page

### Registration / Auth Events

* Viewed Registration Form — `/user/register`
* Viewed Login Form — `/user/login`

### Clicked / Interaction Events

* Clicked Link (Hero CTA)
* Clicked Element (video modal triggers, teaser elements, player controls)

### Video Lifecycle Events

* Played Video
* Paused Video

---

## How It Works

1. Each test navigates to a QA/Live page with OneTrust consent cookies pre-applied via the `amplitude` fixture.
2. `page.on('request')` passively observes every request the page makes; requests to `amplitude.com/2/*` or `amplitude.com/batch*` are captured, gunzip-decoded in Node, and parsed into individual events.
3. Tests poll the captured event list until a matching `event_type` (and optional property predicate) appears, or time out with a diagnostic error listing every Amplitude request seen.
4. A custom reporter (`reporters/markdown-reporter.ts`) builds a markdown summary and a `meta.json` sidecar per run, written to `reports/<env>/`.

---

## Project Structure

```
fixtures/
  amplitude-fixtures.ts   — network capture, OneTrust consent, wait/flush helpers
tests/
  amplitude_events.spec.ts — viewed/registration/auth/click/video test cases
reporters/
  markdown-reporter.ts    — markdown + meta.json report generation
playwright.config.ts
cli.js                    — interactive terminal launcher
```

---

## Running the Tests

Install dependencies and browsers:

```
npm install
npx playwright install --with-deps chromium
```

Run the suite:

```
npx playwright test
```

Interactive UI mode:

```
npx playwright test --ui
```

Interactive launcher (env picker, reports):

```
node cli.js
```

---

## Environment Configuration

```
BASE_URL=https://qa.commonsense.org REPORT_ENV=qa npx playwright test
BASE_URL=https://www.commonsense.org REPORT_ENV=live npx playwright test
```

`REPORT_ENV` controls both the default `BASE_URL` (see `playwright.config.ts`) and which `reports/<env>/` subdirectory reports are written to.

---

## Design Principles

* Validate stable identifiers, not volatile fields
* Exclude environment-dependent properties (viewport, user agent, session IDs, timing)
* Fail fast when an event isn't emitted, or is emitted but fails its contract predicate
* Keep logging minimal to reduce noise

---

## Known Considerations

* Amplitude events may be delayed due to OneTrust consent gating and SDK batching — tests poll with generous timeouts to account for this
* This validates correctness and presence, not volume or reporting aggregation

---

## Ownership

Maintained by
Jawad Mustafa
QA – Common Sense Education
