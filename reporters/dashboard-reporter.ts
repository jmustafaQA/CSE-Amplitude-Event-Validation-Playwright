// reporters/dashboard-reporter.ts
//
// Emits sentinel-prefixed NDJSON progress events to stdout, alongside the normal `list`
// reporter output, for the CSE Launcher dashboard to consume live (see dashboard/server.js's
// _spawnLocalPlaywright, which detects the `__DASH__:` prefix and relays each line as a
// structured SSE event instead of a raw log line). Gated behind PW_DASH_EVENTS so a plain
// `npm test`/CI run never prints these lines — this reporter is a no-op outside the dashboard.
// Ported verbatim from CSE-E2E-Playwright/reporters/dashboard-reporter.ts (see there for the
// retries/onTestEnd rationale) — this repo runs retries: 0, so every onTestEnd is already the
// final attempt, but the guard (and the onEnd catch-up sweep below, for a still-possible
// shouldNotRetryTest edge case — see CSE-E2E-Playwright's copy) is kept for parity in case
// that config ever changes.
import * as path from 'path';
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

function emit(type: string, data: Record<string, unknown>): void {
  // Leading newline: the `list` reporter sometimes hasn't terminated its own line yet
  // (observed in practice) when onTestEnd fires, which would otherwise splice this
  // sentinel onto the tail of that line and make it invisible to a `^__DASH__:` match.
  console.log(`\n__DASH__:${JSON.stringify({ type, ...data })}`);
}

function testCompletePayload(test: TestCase, result: TestResult): Record<string, unknown> {
  const outcome = test.outcome(); // 'expected' | 'unexpected' | 'flaky' | 'skipped' — trustworthy now that retries are exhausted
  const spec = path.basename(test.location.file);
  const error = outcome === 'unexpected' ? (result.errors?.[0]?.message || 'No error message').split('\n')[0] : undefined;
  return { spec, title: test.title, status: outcome, duration: result.duration, retries: result.retry, error };
}

export default class DashboardReporter implements Reporter {
  private rootSuite: Suite | undefined;
  private reported = new Set<string>(); // test.id values already emitted live, so onEnd's sweep never double-reports one

  onBegin(_config: FullConfig, suite: Suite): void {
    if (!process.env.PW_DASH_EVENTS) return;
    this.rootSuite = suite;

    const bySpec: Record<string, number> = {};
    for (const test of suite.allTests()) {
      const spec = path.basename(test.location.file);
      bySpec[spec] = (bySpec[spec] || 0) + 1;
    }
    const specs = Object.entries(bySpec).map(([file, total]) => ({ file, total }));
    emit('run-start', { specs, totalTests: suite.allTests().length });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!process.env.PW_DASH_EVENTS) return;

    // Still-retryable failure — not the final word on this test yet, don't report it.
    const isFinalAttempt = result.status === 'passed' || result.status === 'skipped' || result.retry >= test.retries;
    if (!isFinalAttempt) return;

    this.reported.add(test.id);
    emit('test-complete', testCompletePayload(test, result));
  }

  onEnd(): void {
    if (!process.env.PW_DASH_EVENTS || !this.rootSuite) return;

    for (const test of this.rootSuite.allTests()) {
      if (this.reported.has(test.id)) continue;
      const result = test.results[test.results.length - 1];
      if (!result) continue; // never actually ran
      emit('test-complete', testCompletePayload(test, result));
    }
  }
}
