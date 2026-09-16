import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, COVERAGE_DIRECTORY, assertProjectNodeVersion } from './config.mjs';
import { buildCoverageReport } from './report.mjs';
import { assessBranchCoverage } from './gates.mjs';
import { exactNodeArgs } from '../test-selection/node-runner.mjs';

export async function nodeTestFiles() {
  async function walk(directory) {
    const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => {
      const path = directory + '/' + entry.name;
      return entry.isDirectory() ? walk(path) : [path];
    }));
    return files.flat();
  }
  return [...await walk('test/unit'), ...await walk('test/dom')]
    .filter((path) => path.endsWith('.test.js')).sort();
}

export function runNode(args, environment = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) accept();
      else reject(new Error('Test subprocess failed: exit=' + code + ', signal=' + signal));
    });
  });
}

export async function runCoverage(mode, { reportOnly = false, requireTarget = false } = {}) {
  if (!['all', 'node'].includes(mode)) throw new Error('Coverage mode must be all or node');
  if (requireTarget && (reportOnly || mode === 'node')) {
    throw new Error('The final coverage target requires a complete gated run');
  }
  await assertProjectNodeVersion();
  const policy = mode === 'all' && !reportOnly
    ? JSON.parse(await readFile(new URL('./branch-policy.json', import.meta.url), 'utf8'))
    : null;
  await mkdir(COVERAGE_DIRECTORY, { recursive: true });
  const runDirectory = await mkdtemp(resolve(COVERAGE_DIRECTORY, 'run-'));
  process.stdout.write('Coverage run: ' + runDirectory + '\n');
  const nodeDirectory = resolve(runDirectory, 'node');
  const browserDirectory = mode === 'all' ? resolve(runDirectory, 'browser') : null;
  await mkdir(nodeDirectory);
  if (browserDirectory !== null) await mkdir(browserDirectory);
  const expectedNodeTests = await nodeTestFiles();
  await runNode(exactNodeArgs(expectedNodeTests, {
    execArgv: ['--import', new URL('./collect-node.mjs', import.meta.url).href],
    reportFile: resolve(runDirectory, 'node-results.txt'),
  }), { USERSCRIPTS_NODE_COVERAGE_DIRECTORY: nodeDirectory });
  if (browserDirectory !== null) {
    await runNode(['./node_modules/@playwright/test/cli.js', 'test',
      '--reporter=dot,html,./scripts/test-coverage/browser-reporter.mjs'], {
      USERSCRIPTS_BROWSER_COVERAGE_DIRECTORY: browserDirectory,
      PLAYWRIGHT_HTML_OPEN: 'never',
      PLAYWRIGHT_HTML_OUTPUT_DIR: resolve(ROOT, 'playwright-report'),
    });
  }
  const outputDirectory = resolve(runDirectory, 'report');
  const result = await buildCoverageReport({ nodeDirectory, browserDirectory, outputDirectory, expectedNodeTests });
  result.summary.gate = policy === null ? null
    : assessBranchCoverage(result.summary, policy, { requireTarget });
  await writeFile(resolve(outputDirectory, 'coverage-summary.json'), JSON.stringify(result.summary, null, 2) + '\n');
  await writeFile(resolve(COVERAGE_DIRECTORY, 'latest.json'), JSON.stringify({
    runDirectory, outputDirectory, reportPath: result.reportPath,
    layers: result.summary.layers,
    completedAt: new Date().toISOString(),
    gatePassed: result.summary.gate?.passed ?? null,
    meetsBranchTarget: result.summary.meetsBranchTarget,
  }, null, 2) + '\n');
  process.stdout.write('Coverage report: ' + result.reportPath + '\n');
  process.stdout.write('Branch target: ' + result.summary.targetBranches + '%; measured: '
    + result.summary.summary.branches.pct + '% (' + result.summary.layers.join(' + ') + ')\n');
  if (result.summary.gate !== null) {
    if (!result.summary.gate.passed) {
      throw new Error('Coverage gate failed:\n' + result.summary.gate.failures.join('\n'));
    }
    process.stdout.write('Staged coverage gate passed. Final target met: ' + result.summary.gate.targetMet + '\n');
  } else {
    process.stdout.write('Diagnostic report: thresholds were not enforced.\n');
  }
  return result;
}

if (import.meta.main) {
  const mode = process.argv[2] ?? 'all';
  const flags = process.argv.slice(3);
  if (flags.some((flag) => !['--report-only', '--require-target'].includes(flag))
    || new Set(flags).size !== flags.length) throw new Error('Unknown or duplicate coverage flag');
  await runCoverage(mode, { reportOnly: flags.includes('--report-only'), requireTarget: flags.includes('--require-target') });
}
