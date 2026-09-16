import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { buildTestGraph, isProtectedPath, selectTests } from './graph.mjs';
import { exactNodeArgs } from './node-runner.mjs';

const execute = promisify(execFile);
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;

function validateBase(base) {
  if (typeof base !== 'string' || !base.trim() || base.startsWith('-') || /^0+$/.test(base)) {
    throw new Error('A nonempty, nonzero comparison base is required');
  }
}

export function parseArgs(argv) {
  const options = { base: 'HEAD', full: false, list: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--base', '--full', '--list'].includes(argument) || seen.has(argument)) {
      throw new Error('Unknown or repeated test-selection argument: ' + argument);
    }
    seen.add(argument);
    if (argument === '--base') {
      options.base = argv[++index];
      validateBase(options.base);
    } else options[argument.slice(2)] = true;
  }
  return options;
}

async function git(root, args) {
  const { stdout } = await execute('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT });
  return stdout;
}

function nulPaths(output) {
  if (output && !output.endsWith('\0')) throw new Error('Git returned an incomplete NUL-delimited path list');
  return output ? output.slice(0, -1).split('\0') : [];
}

/** A rename is deliberately represented as deletion plus addition so old consumers cannot disappear. */
export async function collectRepositoryState(root, { base = 'HEAD' } = {}) {
  validateBase(base);
  let commit;
  try { commit = (await git(root, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'])).trim(); }
  catch { throw new Error('Comparison base does not resolve to an available commit: ' + JSON.stringify(base)); }
  const [diff, untracked, listed] = await Promise.all([
    git(root, ['diff', '--name-only', '--no-renames', '-z', commit, '--']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
  ]);
  const files = [];
  for (const path of new Set(nulPaths(listed))) {
    try {
      const stat = await lstat(resolve(root, path));
      if (stat.isFile() || stat.isSymbolicLink()) files.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { files: files.sort(), changedFiles: [...new Set([...nulPaths(diff), ...nulPaths(untracked)])].sort() };
}

async function readRepositoryText(root, path) {
  if (isProtectedPath(path) || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error('Refusing to read an unsafe selection input: ' + JSON.stringify(path));
  }
  const handle = await open(resolve(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile('utf8'); }
  finally { await handle.close(); }
}

export async function createRepositoryPlan({ root, base = 'HEAD', full = false }) {
  const state = await collectRepositoryState(root, { base });
  const graph = await buildTestGraph({ files: state.files, readText: (path) => readRepositoryText(root, path) });
  return selectTests(graph, state.changedFiles, { full });
}

function literalBrowserFilter(path) {
  return '(?:^|/)' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
}

export function runnerCommands(plan, { nodeExecutable = process.execPath, playwrightCli } = {}) {
  const commands = [];
  if (plan.nodeTests.length) commands.push({ command: nodeExecutable, args: exactNodeArgs(plan.nodeTests) });
  if (plan.browserTests.length) {
    if (!playwrightCli) throw new Error('The Playwright CLI path is required for selected browser tests');
    commands.push({ command: nodeExecutable, args: [playwrightCli, 'test', ...plan.browserTests.map(literalBrowserFilter)] });
  }
  return commands;
}

/** Runner failures end the sequence; selected test paths are never interpolated into a shell command. */
export async function runCommands(commands, { root }) {
  for (const { command, args } of commands) {
    await new Promise((complete, reject) => {
      const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) complete();
        else reject(new Error('Selected test runner failed with ' + (signal ? 'signal ' + signal : 'exit code ' + code)));
      });
    });
  }
}

export async function main(argv, { root = process.cwd() } = {}) {
  const options = parseArgs(argv);
  const expectedNode = (await readRepositoryText(root, '.nvmrc')).trim().replace(/^v/, '');
  if (expectedNode !== process.versions.node) throw new Error('Use project Node ' + expectedNode + '; received ' + process.versions.node);
  const plan = await createRepositoryPlan({ root, base: options.base, full: options.full });
  if (options.list) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    return plan;
  }
  process.stdout.write('[test-selection] ' + JSON.stringify({
    mode: plan.mode, nodeTests: plan.nodeTests.length, browserTests: plan.browserTests.length, reasons: plan.reasons,
  }) + '\n');
  let playwrightCli;
  if (plan.browserTests.length) {
    const require = createRequire(pathToFileURL(resolve(root, 'package.json')));
    playwrightCli = require.resolve('@playwright/test/cli');
  }
  await runCommands(runnerCommands(plan, { playwrightCli }), { root });
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write('[test-selection] ' + error.message + '\n');
    process.exitCode = 1;
  });
}
