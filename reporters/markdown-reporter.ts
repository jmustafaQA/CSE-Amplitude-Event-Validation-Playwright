// reporters/markdown-reporter.ts
//
// Port of the after:run hook in cypress.config.js: builds a markdown run report plus a
// meta.json sidecar (consumed by the launcher's push-results sync) in reports/<env>/.
//
// Playwright's Suite/TestCase model gives per-test retry history for free via
// `test.outcome()`, so flakyTests/highRetryTests below are populated for real instead of
// being hardcoded to empty arrays as they were in the Cypress version.

import * as fs from 'fs';
import * as path from 'path';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';

const REPORT_ENV = process.env.REPORT_ENV || 'qa';
const REPORTS_DIR = path.join(__dirname, '..', 'reports', REPORT_ENV);

interface TestRow {
  title: string;
  section: string;
  state: 'passed' | 'failed' | 'skipped';
  duration: number;
  error: string | null;
  retries: number;
}

function ensureReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

// Extracts { eventType, path, name } from a test title of the form
// `fires "EventType" on /path (Case Name)`.
function parseTitle(title: string) {
  const eventMatch = title.match(/fires "([^"]+)"/);
  const pathMatch = title.match(/fires "[^"]+" on (\S+)/);
  const nameMatch = title.match(/\((.+)\)$/);
  return {
    eventType: eventMatch ? eventMatch[1] : '',
    path: pathMatch ? pathMatch[1] : '',
    name: nameMatch ? nameMatch[1] : title,
  };
}

function fmtDur(ms: number): string {
  return ms ? `${(ms / 1000).toFixed(2)}s` : '—';
}

function buildMarkdown(
  timestamp: string,
  baseUrl: string,
  rows: TestRow[],
  flakyTests: string[],
  highRetryTests: string[]
): string {
  const total = rows.length;
  const pass = rows.filter((r) => r.state === 'passed').length;
  const fail = rows.filter((r) => r.state === 'failed').length;
  const skip = rows.filter((r) => r.state === 'skipped').length;
  const durationMs = rows.reduce((sum, r) => sum + r.duration, 0);
  const totalDur = (durationMs / 1000).toFixed(1);
  const isPassing = fail === 0;

  const statusIcon = isPassing ? '🟢' : '🔴';
  const statusLabel = isPassing ? 'PASS' : 'FAIL';

  const date = new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const L: string[] = [];

  L.push(`# ${statusIcon} Amplitude Test Run — ${statusLabel}`);
  L.push(``);
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| 🕐 Run at | ${date} |`);
  L.push(`| 🌐 Base URL | \`${baseUrl}\` |`);
  L.push(`| ✅ Passed | **${pass} / ${total}** |`);
  L.push(`| ❌ Failed | **${fail}** |`);
  L.push(`| ⏭️ Skipped | ${skip} |`);
  L.push(`| ⏱️ Duration | ${totalDur}s |`);
  if (flakyTests.length) L.push(`| 🍂 Flaky | ${flakyTests.length} |`);
  L.push(``);

  const sections: Record<string, TestRow[]> = {};
  rows.forEach((r) => {
    if (!sections[r.section]) sections[r.section] = [];
    sections[r.section].push(r);
  });

  L.push(`## 🧪 Test Results`);
  L.push(``);

  let globalIdx = 1;
  Object.entries(sections).forEach(([section, sectionRows]) => {
    const sectionFail = sectionRows.filter((r) => r.state === 'failed').length;
    const sectionIcon = sectionFail === 0 ? '✅' : '❌';

    L.push(`### ${sectionIcon} ${section}`);
    L.push(``);
    L.push(`| # | Test | Path | Duration | Status |`);
    L.push(`|---|------|------|----------|--------|`);

    sectionRows.forEach((r) => {
      const p = parseTitle(r.title);
      const icon = r.state === 'passed' ? '🟢' : r.state === 'failed' ? '🔴' : '⏭️';
      L.push(`| ${globalIdx++} | ${p.name} | \`${p.path}\` | ${fmtDur(r.duration)} | ${icon} |`);
    });

    L.push(``);
  });

  const failed = rows.filter((r) => r.state === 'failed');
  if (failed.length > 0) {
    L.push(`---`);
    L.push(``);
    L.push(`## ❌ Failure Details`);

    failed.forEach((r, i) => {
      const p = parseTitle(r.title);
      const errorLine = r.error ? r.error.split('\n')[0].replace(/^Error:\s*/, '').trim() : '(no error message)';

      L.push(``);
      L.push(`### ${i + 1}. ${p.name}`);
      L.push(``);
      L.push(`**Event:** \`${p.eventType}\` &nbsp; **Path:** \`${p.path}\``);
      L.push(``);
      L.push(`> ⚠️ ${errorLine}`);
    });

    L.push(``);
  }

  return L.join('\n') + '\n';
}

function printReport(timestamp: string, baseUrl: string, rows: TestRow[]): void {
  const total = rows.length;
  const pass = rows.filter((r) => r.state === 'passed').length;
  const fail = rows.filter((r) => r.state === 'failed').length;
  const durationMs = rows.reduce((sum, r) => sum + r.duration, 0);
  const dur = (durationMs / 1000).toFixed(1);
  const status = fail === 0 ? 'PASS' : 'FAIL';

  console.log('\n========================================');
  console.log(`  Run completed : ${timestamp}`);
  console.log(`  Base URL      : ${baseUrl}`);
  console.log(`  Status        : ${status}  (${pass}/${total} passed, ${fail} failed)`);
  console.log(`  Duration      : ${dur}s`);
  console.log('========================================\n');
}

export default class MarkdownReporter implements Reporter {
  private rootSuite!: Suite;
  private config!: FullConfig;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.rootSuite = suite;
  }

  onEnd(): void {
    const allTests = this.rootSuite.allTests();
    const anyExecuted = allTests.some((t) => t.results.length > 0);
    if (!anyExecuted) return; // `--list` or a dry collection pass — nothing ran, nothing to report

    ensureReportsDir();

    const baseUrl =
      (this.config.projects[0]?.use?.baseURL as string) || process.env.BASE_URL || '';

    const rows: TestRow[] = [];
    const flakyTests: string[] = [];
    const highRetryTests: string[] = [];
    const failures: Array<{ spec: string; title: string; project: string; error: string; retries: number }> = [];

    for (const test of allTests) {
      const outcome = test.outcome(); // 'expected' | 'unexpected' | 'flaky' | 'skipped'
      const state: TestRow['state'] =
        outcome === 'skipped' ? 'skipped' : outcome === 'unexpected' ? 'failed' : 'passed';

      const lastResult = test.results[test.results.length - 1];
      const retries = Math.max(0, test.results.length - 1);
      const errorMessage = lastResult?.errors?.[0]?.message || null;

      rows.push({
        title: test.title,
        section: test.parent?.title || 'Other',
        state,
        duration: lastResult?.duration || 0,
        error: errorMessage,
        retries,
      });

      if (outcome === 'flaky') flakyTests.push(test.title);
      if (retries >= 2) highRetryTests.push(test.title);

      if (state === 'failed') {
        const projectName = test.titlePath()[1] || 'chromium';
        failures.push({
          spec: path.basename(test.location.file),
          title: test.titlePath().slice(3).join(' > '),
          project: projectName,
          error: (errorMessage || '').split('\n')[0],
          retries,
        });
      }
    }

    // PT-formatted timestamp — matches Automation naming: run_YYYY-MM-DDTHH-MM-SS
    const timestamp = new Date()
      .toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' })
      .replace(' ', 'T')
      .replace(/:/g, '-');
    const isoTimestamp = new Date().toISOString();

    fs.writeFileSync(
      path.join(REPORTS_DIR, `run_${timestamp}.md`),
      buildMarkdown(isoTimestamp, baseUrl, rows, flakyTests, highRetryTests)
    );

    const total = rows.length;
    const passed = rows.filter((r) => r.state === 'passed').length;
    const failed = rows.filter((r) => r.state === 'failed').length;
    const skipped = rows.filter((r) => r.state === 'skipped').length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const elapsedMs = rows.reduce((sum, r) => sum + r.duration, 0);

    fs.writeFileSync(
      path.join(REPORTS_DIR, `run_${timestamp}.meta.json`),
      JSON.stringify(
        {
          timestamp,
          environment: process.env.PW_ENV_NAME || REPORT_ENV.toUpperCase(),
          baseUrl,
          stats: {
            passed,
            failed,
            flaky: flakyTests.length,
            skipped,
            total,
            passRate,
            elapsedMs,
          },
          failures,
          flakyTests,
          highRetryTests,
        },
        null,
        2
      )
    );

    printReport(isoTimestamp, baseUrl, rows);
  }
}
