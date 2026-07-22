#!/usr/bin/env node
'use strict';

const readline     = require('readline');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;

// ── ANSI helpers ──────────────────────────────────────────────
const R   = '\x1b[0m';
const B   = '\x1b[1m';
const DM  = '\x1b[2m';
const GR  = '\x1b[32m';
const YL  = '\x1b[33m';
const CY  = '\x1b[36m';
const RE  = '\x1b[31m';
const HDR = '\x1b[1;38;5;27m';

const clear = () => process.stdout.write('\x1bc');

// ── Environments ──────────────────────────────────────────────
const ENVS = [
  { label: 'QA',   url: 'https://qa.commonsense.org'  },
  { label: 'Live', url: 'https://www.commonsense.org' },
];
let currentEnv = null;

function reportsDirFor(env) {
  return path.join(ROOT, 'reports', env.label.toLowerCase());
}

// ── Environment chooser ───────────────────────────────────────
async function askEnv() {
  clear();
  banner();
  console.log(`  ${B}Choose environment:${R}\n`);
  ENVS.forEach((e, i) => {
    const c = e.label === 'QA' ? YL : GR;
    console.log(`  ${c}${i + 1}${R}  ${c}${B}${e.label}${R}  ${DM}${e.url}${R}`);
  });
  console.log();
  const ans = await ask('  Select [1-2]: ');
  const idx = parseInt(ans, 10) - 1;
  currentEnv = (idx >= 0 && idx < ENVS.length) ? ENVS[idx] : ENVS[0];
  process.env.BASE_URL = currentEnv.url;
  process.env.REPORT_ENV = currentEnv.label.toLowerCase();
}

// ── Banner / header ───────────────────────────────────────────
function banner() {
  console.log(`\n${HDR}  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║   CSE Amplitude Analytics Suite (Playwright)  ║`);
  console.log(`  ╚══════════════════════════════════════════════╝${R}\n`);
}

function header() {
  banner();
  if (currentEnv) {
    const envColor = currentEnv.label === 'QA' ? YL : GR;
    console.log(`  ${DM}Environment${R}  ${envColor}${B}${currentEnv.label}${R}  ${DM}${currentEnv.url}${R}`);

    const reports = getReports();
    console.log(`  ${DM}Reports${R}      ${CY}${reports.length} saved${R}`);
    console.log();
  }
}

// ── Divider ───────────────────────────────────────────────────
function divider(label) {
  const inner = label ? `── ${label} ` : '';
  const fill  = '─'.repeat(Math.max(0, 42 - inner.length));
  return `  ${DM}${inner}${fill}${R}`;
}

// ── Menu ──────────────────────────────────────────────────────
function menu() {
  clear();
  header();

  console.log(divider('Run'));
  console.log(`  ${GR}1${R}  ${B}Run all tests${R}              ${DM}headless · generates report${R}`);
  console.log(`  ${GR}2${R}  ${B}Open Playwright UI${R}          ${DM}interactive · pick tests${R}`);
  console.log();
  console.log(divider('Reports'));
  console.log(`  ${CY}3${R}  ${B}View latest report${R}`);
  console.log(`  ${CY}4${R}  ${B}List all reports${R}`);
  console.log();
  console.log(divider(''));
  console.log(`  ${YL}e${R}  ${B}Switch environment${R}          ${DM}currently: ${currentEnv ? (currentEnv.label === 'QA' ? YL : GR) + currentEnv.label + R : '?'}${R}`);
  console.log(`  ${YL}0${R}  ${B}Exit${R}                   ${DM}[q]${R}\n`);
}

// ── Shared utilities ──────────────────────────────────────────
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

function pause() {
  return ask(`\n  ${DM}Press Enter to return to the menu...${R}`);
}

function run(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
    return true;
  } catch (_) {
    return false;
  }
}

function getReports() {
  const dir = reportsDirFor(currentEnv || ENVS[0]);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('run_') && f.endsWith('.md'))
    .sort().reverse();
}

// ── Option 3: view latest report ──────────────────────────────
async function viewLatestReport() {
  clear(); header();
  const reports = getReports();
  if (reports.length === 0) {
    console.log(`  ${YL}No reports found.${R} Run the test suite first.\n`);
    await pause(); return;
  }
  console.log(`  ${DM}${reports[0]}${R}\n${'─'.repeat(60)}\n`);
  console.log(fs.readFileSync(path.join(reportsDirFor(currentEnv), reports[0]), 'utf8'));
  console.log('─'.repeat(60));
  await pause();
}

// ── Option 4: list all reports ────────────────────────────────
async function listReports() {
  clear(); header();
  const reports = getReports();
  if (reports.length === 0) {
    console.log(`  ${YL}No reports found.${R}\n`);
  } else {
    console.log(`  ${B}Saved reports:\n${R}`);
    reports.forEach((r, i) => console.log(`  ${CY}${i + 1}${R}  ${r}`));
  }
  console.log();
  await pause();
}

// ── Main loop ─────────────────────────────────────────────────
async function main() {
  await askEnv();

  while (true) {
    menu();
    const choice = await ask(`  ${DM}Select [1-4, e, 0]:${R} `);

    switch (choice) {
      case '1':
        clear(); header();
        console.log(`\n  ${CY}Running all tests on ${currentEnv.label}...${R}\n`);
        run('npx playwright test');
        await pause(); break;

      case '2':
        clear(); header();
        console.log(`\n  ${CY}Opening Playwright UI (${currentEnv.label})...${R}\n`);
        run('npx playwright test --ui'); break;

      case '3':
        await viewLatestReport(); break;

      case '4':
        await listReports(); break;

      case 'e':
      case 'E':
        await askEnv(); break;

      case '0':
      case 'q':
      case 'Q':
        console.log(`\n  ${GR}Goodbye!${R}\n`);
        process.exit(0);
    }
  }
}

main();
