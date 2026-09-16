import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { buildTestGraph, selectTests } from '../../scripts/test-selection/graph.mjs';
import { collectRepositoryState, createRepositoryPlan, parseArgs, runnerCommands, runCommands } from '../../scripts/test-selection/run.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../../scripts/test-selection/run.mjs', import.meta.url));

function repositoryFiles(extra = {}) {
  return {
    'src/shared/math.js': 'export const value = 1;',
    'src/feature/index.user.js': "export { value } from '../shared/math.js';",
    'src/other.js': 'export const other = 2;',
    'scripts/build-userscript.mjs': "export const TARGETS = { feature: { entry: 'src/feature/index.user.js', output: 'scripts/feature.user.js' } };",
    'scripts/feature.user.js': '// Generated install artifact.',
    'test/unit/math.test.js': "import '../../src/shared/math.js';",
    'test/unit/other.test.js': "import '../../src/other.js';",
    'test/dom/form.test.js': "import './form-helper.js';",
    'test/dom/form-helper.js': "export const fixture = new URL('../fixtures/form.html', import.meta.url);",
    'test/fixtures/form.html': '<form></form>',
    'e2e/app/specs/page.pw.js': "import '../helpers/page.js';",
    'e2e/app/helpers/page.js': "export const file = new URL('../../../scripts/feature.user.js', import.meta.url);",
    'playwright.config.js': "export default { testDir: './e2e/app/specs', testMatch: '**/*.pw.js', snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}' };",
    'e2e/app/specs/page.pw.js-snapshots/panel.json': '{"visible":true}',
    'docs/guide.md': '# Guide',
    ...extra,
  };
}

async function graphFor(files) {
  return buildTestGraph({ files: Object.keys(files), readText: async (path) => {
    assert.equal(Object.hasOwn(files, path), true, 'Unexpected graph read: ' + path);
    return files[path];
  } });
}

async function createRepository(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'userscripts-selection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = repositoryFiles({ '.nvmrc': process.versions.node + '\n', ...extra });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), content);
  }
  await execute('git', ['init', '--quiet'], { cwd: root });
  await execute('git', ['add', '--all'], { cwd: root });
  await execute('git', ['-c', 'user.name=Selection Test', '-c', 'user.email=selection@example.invalid', 'commit', '--quiet', '-m', 'Initial test fixture'], { cwd: root });
  return root;
}

test('user selects direct and generated-artifact consumers of a shared source change', async () => {
  // Given independent tests and an artifact built transitively from the shared module.
  const graph = await graphFor(repositoryFiles());

  // When the shared module changes.
  const plan = selectTests(graph, ['src/shared/math.js']);

  // Then the direct Node test and browser artifact consumer run without unrelated tests.
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/math.test.js']);
  assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
  assert.deepEqual(plan.changedFiles, ['src/shared/math.js']);
});

test('user selects the DOM consumer of a statically referenced HTML fixture', async () => {
  // Given a helper whose fixture URL is resolved relative to import.meta.url.
  const graph = await graphFor(repositoryFiles());

  // When the fixture changes.
  const plan = selectTests(graph, ['test/fixtures/form.html']);

  // Then the transitive DOM test runs by its actual filename.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/dom/form.test.js']);
  assert.deepEqual(plan.browserTests, []);
});

test('user preserves encoded filename variants in static URL dependencies', async () => {
  // Given literal URL inputs for filenames containing spaces and a newline.
  const source = "new URL('../fixtures/first%20file.json', import.meta.url); new URL('../fixtures/second%0Afile.json', import.meta.url);";
  const graph = await graphFor(repositoryFiles({
    'test/unit/templates.test.js': source,
    'test/fixtures/first file.json': '{}',
    'test/fixtures/second\nfile.json': '{}',
  }));

  // When the newline-containing fixture changes.
  const plan = selectTests(graph, ['test/fixtures/second\nfile.json']);

  // Then URL decoding selects its test and preserves the exact path bytes.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/templates.test.js']);
  assert.deepEqual(plan.changedFiles, ['test/fixtures/second\nfile.json']);
});

test('user runs every test when a template-derived fixture has no independently verified edge', async () => {
  // Given a runtime template whose array values are deliberately not treated as a complete domain.
  const graph = await graphFor(repositoryFiles({
    'test/unit/templates.test.js': "const names = ['first', 'second']; for (const name of names) new URL(`../fixtures/${name}.json`, import.meta.url);",
    'test/fixtures/first.json': '{}',
    'test/fixtures/second.json': '{}',
  }));

  // When one of those fixtures changes without another static dependency edge.
  const plan = selectTests(graph, ['test/fixtures/second.json']);

  // Then incomplete runtime value analysis cannot turn an unmapped fixture into an empty plan.
  assert.equal(plan.mode, 'full');
  assert.equal(plan.nodeTests.includes('test/unit/templates.test.js'), true);
  assert.match(plan.reasons.join('\n'), /Unmapped runtime change/);
});

for (const mutation of [
  'names.push(process.argv[2]);',
  'names[0] = process.argv[2];',
  'const alias = names; alias.push(process.argv[2]);',
  'changeNames(names);',
]) {
  test(`user keeps unknown fixture consumers after the path list changes through ${mutation}`, async () => {
    // Given a known consumer and a fixture path domain that can change before iteration.
    const graph = await graphFor(repositoryFiles({
      'test/unit/mutable.test.js': "import { readFile } from 'node:fs/promises'; const names = ['first']; " + mutation + "; for (const name of names) await readFile(new URL(`../fixtures/${name}.json`, import.meta.url));",
      'test/fixtures/first.json': '{}',
    }));

    // When another known fixture changes and may be read through the modified path list.
    const plan = selectTests(graph, ['test/fixtures/form.html']);

    // Then the unproved fixture consumer is retained instead of trusting its initializer forever.
    assert.equal(plan.mode, 'affected');
    assert.deepEqual(plan.nodeTests, ['test/dom/form.test.js', 'test/unit/mutable.test.js']);
    assert.match(plan.reasons.join('\n'), /Unresolved/);
  });
}

test('user selects the owner of a derived Playwright snapshot', async () => {
  // Given the verified Playwright snapshot template and its derived snapshot directory.
  const graph = await graphFor(repositoryFiles());

  // When the panel snapshot changes without a source import referring to it.
  const plan = selectTests(graph, ['e2e/app/specs/page.pw.js-snapshots/panel.json']);

  // Then its browser spec runs even though the snapshot dependency is implicit.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
  assert.deepEqual(plan.nodeTests, []);
});

test('user discovers nested browser specs in both affected and full plans', async () => {
  // Given a new spec and snapshot below a nested directory matched by Playwright.
  const spec = 'e2e/app/specs/nested/new.pw.js';
  const snapshot = spec + '-snapshots/panel.json';
  const graph = await graphFor(repositoryFiles({ [spec]: '', [snapshot]: '{}' }));

  // When the snapshot changes and when an explicit full run is requested.
  const affected = selectTests(graph, [snapshot]);
  const full = selectTests(graph, [], { full: true });

  // Then the owning nested spec is selected and no full plan loses it during discovery.
  assert.equal(affected.mode, 'affected');
  assert.deepEqual(affected.browserTests, [spec]);
  assert.equal(full.mode, 'full');
  assert.deepEqual(full.browserTests, [spec, 'e2e/app/specs/page.pw.js']);
});

for (const { name, source } of [
  { name: 'an unresolved dynamic import', source: "await import(process.argv[2]);" },
  { name: 'an unbounded template path', source: "await import(`../../src/${process.argv[2]}.js`);" },
  { name: 'a directory input', source: "import { readdir } from 'node:fs/promises'; await readdir(new URL('../fixtures/', import.meta.url));" },
  { name: 'an unresolved file-read input', source: "import { readFile as read } from 'node:fs/promises'; await read(process.argv[2]);" },
  { name: 'a shadowed reader argument', source: "import { readFile } from 'node:fs/promises'; const path = '../../src/other.js'; function load(path) { return readFile(path); } load(process.argv[2]);" },
  { name: 'a reader assigned to another name', source: "import { readFile } from 'node:fs/promises'; const read = readFile; await read(process.argv[2]);" },
  { name: 'a destructured namespace reader', source: "import * as fs from 'node:fs/promises'; const { readFile: read } = fs; await read(process.argv[2]);" },
  { name: 'a dynamically imported filesystem module', source: "const fs = await import('node:fs/promises'); await fs.readFile(process.argv[2]);" },
  { name: 'a required filesystem module', source: "const fs = require('fs'); fs.readFileSync(process.argv[2]);" },
  { name: 'an alias created by the Node module loader', source: "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load(process.argv[2]);" },
  { name: 'an alias created by the unprefixed module loader', source: "import { createRequire } from 'module'; const load = createRequire(import.meta.url); load(process.argv[2]);" },
  { name: 'a subprocess with runtime-dependent inputs', source: "import { execFile } from 'node:child_process'; execFile(process.execPath, [process.argv[2]]);" },
  { name: 'a module embedded in a data URL', source: "await import('data:text/javascript,export const loaded = true;');" },
]) {
  test(`user retains complete uncertain consumers when the graph contains ${name}`, async () => {
    // Given one known consumer plus a second consumer whose dependency set is incomplete.
    const graph = await graphFor(repositoryFiles({ 'test/unit/dynamic.test.js': source }));

    // When a source with some known consumers changes.
    const plan = selectTests(graph, ['src/shared/math.js']);

    // Then the uncertain file and known consumers run while independent test files stay excluded.
    assert.equal(plan.mode, 'affected');
    assert.deepEqual(plan.nodeTests, ['test/unit/dynamic.test.js', 'test/unit/math.test.js']);
    assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
    assert.match(plan.reasons.join('\n'), /Unresolved|Directory input/);
  });
}

test('user retains every test that reaches an unresolved intermediate reader', async () => {
  // Given two test roots sharing a helper with an unknown file input and other independent roots.
  const graph = await graphFor(repositoryFiles({
    'test/helpers/reader.js': "import { readFile } from 'node:fs/promises'; await readFile(process.argv[2]);",
    'test/unit/unknown-a.test.js': "import '../helpers/reader.js';",
    'test/dom/unknown-b.test.js': "import '../helpers/reader.js';",
  }));

  // When a statically known independent source changes.
  const plan = selectTests(graph, ['src/other.js']);

  // Then reverse dependency traversal includes both unknown consumers and the known affected test.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/dom/unknown-b.test.js', 'test/unit/other.test.js', 'test/unit/unknown-a.test.js']);
  assert.deepEqual(plan.browserTests, []);
});

test('user retains unknown readers when an apparently unconsumed Markdown file changes', async () => {
  // Given a reader whose runtime path could include documentation.
  const graph = await graphFor(repositoryFiles({
    'test/unit/dynamic.test.js': "import { readFile } from 'node:fs/promises'; await readFile(process.argv[2]);",
  }));

  // When only the documentation file changes.
  const plan = selectTests(graph, ['docs/guide.md']);

  // Then Markdown alone is insufficient evidence to skip an unknown runtime consumer.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/dynamic.test.js']);
  assert.deepEqual(plan.browserTests, []);
});

for (const build of [
  'export const TARGETS = loadTargets();',
  "export const TARGETS = { feature: { entry: '../outside.js', output: 'scripts/feature.user.js' } };",
  "export const TARGETS = { feature: { entry: 'src/feature/index.ts', output: 'scripts/feature.user.js' } };",
  "export const TARGETS = { first: { entry: 'src/feature/index.user.js', output: 'scripts/feature.user.js' }, second: { entry: 'src/other.js', output: 'scripts/feature.user.js' } };",
]) {
  test(`user runs every test when the exported artifact mapping is invalid ${build}`, async () => {
    // Given a build mapping that cannot prove a unique supported source for every artifact.
    const graph = await graphFor(repositoryFiles({ 'scripts/build-userscript.mjs': build }));

    // When a source with a known direct consumer changes.
    const plan = selectTests(graph, ['src/shared/math.js']);

    // Then a global artifact-graph error cannot be reduced to the visible direct consumers.
    assert.equal(plan.mode, 'full');
    assert.deepEqual(plan.nodeTests, ['test/dom/form.test.js', 'test/unit/math.test.js', 'test/unit/other.test.js']);
    assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
    assert.match(plan.reasons.join('\n'), /Build/);
  });
}

test('user runs every test when the configured snapshot layout is unsupported', async () => {
  // Given a snapshot layout that cannot derive an owning spec from the stored filename.
  const graph = await graphFor(repositoryFiles({
    'playwright.config.js': "export default { testDir: './e2e/app/specs', testMatch: '**/*.pw.js', snapshotPathTemplate: 'custom/{arg}{ext}' };",
  }));

  // When a known source changes while global snapshot ownership is unresolved.
  const plan = selectTests(graph, ['src/shared/math.js']);

  // Then the global layout uncertainty selects all test roots explicitly.
  assert.equal(plan.mode, 'full');
  assert.deepEqual(plan.nodeTests, ['test/dom/form.test.js', 'test/unit/math.test.js', 'test/unit/other.test.js']);
  assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
  assert.match(plan.reasons.join('\n'), /snapshot layout/);
});

test('user runs every test when Playwright root discovery no longer matches its configuration', async () => {
  // Given a narrower configured test pattern than the supported recursive spec inventory.
  const graph = await graphFor(repositoryFiles({
    'playwright.config.js': "export default { testDir: './e2e/app/specs', testMatch: '*.pw.js', snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}' };",
  }));

  // When a known source changes under that unverified discovery contract.
  const plan = selectTests(graph, ['src/other.js']);

  // Then the root mismatch is explicit global work rather than a partial plan.
  assert.equal(plan.mode, 'full');
  assert.deepEqual(plan.nodeTests, ['test/dom/form.test.js', 'test/unit/math.test.js', 'test/unit/other.test.js']);
  assert.match(plan.reasons.join('\n'), /test root configuration/);
});

test('user retains the consumer of an unsupported executable dependency', async () => {
  // Given a test importing TypeScript whose transitive imports the JavaScript parser cannot prove.
  const graph = await graphFor(repositoryFiles({
    'test/unit/typed.test.js': "import '../../src/typed.ts';",
    'src/typed.ts': "export { other } from './other.js';",
  }));

  // When a separately known source changes and might also feed the unsupported module.
  const plan = selectTests(graph, ['src/other.js']);

  // Then the unsupported branch remains a complete test-file consumer in the plan.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/other.test.js', 'test/unit/typed.test.js']);
  assert.match(plan.reasons.join('\n'), /Unsupported module dependency/);
});

for (const changed of ['unrecognized.json', 'test/fixtures/unknown.html', 'images/unknown.png', 'src/unused.js']) {
  test(`user runs all tests for an unmapped runtime change ${changed}`, async () => {
    // Given a repository file with no proven consumers in the graph.
    const graph = await graphFor(repositoryFiles({ [changed]: '' }));

    // When that runtime file changes.
    const plan = selectTests(graph, [changed]);

    // Then an unmapped file is explicit full-suite work rather than a silent skip.
    assert.equal(plan.mode, 'full');
    assert.match(plan.reasons.join('\n'), /Unmapped runtime change/);
    assert.equal(plan.nodeTests.length, 3);
  });
}

for (const changed of ['package.json', 'package-lock.json', '.nvmrc', '.github/workflows/check.yml', 'playwright.config.js', 'eslint.config.js', 'scripts/test-policy/rules.js', 'scripts/test-coverage/report.mjs', 'scripts/test-selection/graph.mjs']) {
  test(`user runs all tests after infrastructure changes to ${changed}`, async () => {
    // Given the current test inventory and an infrastructure change.
    const graph = await graphFor(repositoryFiles());

    // When the infrastructure change is classified.
    const plan = selectTests(graph, [changed]);

    // Then all actual Node and browser roots are selected with an infrastructure reason.
    assert.equal(plan.mode, 'full');
    assert.match(plan.reasons.join('\n'), /Infrastructure changed/);
    assert.deepEqual(plan.nodeTests, ['test/dom/form.test.js', 'test/unit/math.test.js', 'test/unit/other.test.js']);
    assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
  });
}

test('user skips only documentation that has no runtime consumer', async () => {
  // Given an unconsumed documentation file in an otherwise complete dependency graph.
  const graph = await graphFor(repositoryFiles());

  // When only that documentation changes.
  const plan = selectTests(graph, ['docs/guide.md']);

  // Then the plan explicitly reports that no runtime tests are affected.
  assert.equal(plan.mode, 'none');
  assert.deepEqual(plan.nodeTests, []);
  assert.deepEqual(plan.browserTests, []);
  assert.match(plan.reasons.join('\n'), /documentation/i);
});

test('user skips a clean checkout while still allowing an explicit full run', async () => {
  // Given a valid dependency graph without any changed paths.
  const graph = await graphFor(repositoryFiles());

  // When the empty change set is selected normally and with the full-run override.
  const clean = selectTests(graph, []);
  const full = selectTests(graph, [], { full: true });

  // Then normal selection is explicitly empty and the override includes every discovered root.
  assert.equal(clean.mode, 'none');
  assert.deepEqual(clean.nodeTests, []);
  assert.deepEqual(clean.browserTests, []);
  assert.deepEqual(clean.reasons, ['No changed files']);
  assert.equal(full.mode, 'full');
  assert.deepEqual(full.nodeTests, ['test/dom/form.test.js', 'test/unit/math.test.js', 'test/unit/other.test.js']);
  assert.deepEqual(full.browserTests, ['e2e/app/specs/page.pw.js']);
});

test('user still tests documentation consumed at runtime', async () => {
  // Given a Node test that reads a Markdown fixture from the documentation directory.
  const graph = await graphFor(repositoryFiles({
    'test/unit/docs.test.js': "import { readFile } from 'node:fs/promises'; await readFile(new URL('../../docs/guide.md', import.meta.url));",
  }));

  // When the consumed Markdown changes.
  const plan = selectTests(graph, ['docs/guide.md']);

  // Then its runtime consumer runs instead of treating the extension as sufficient to skip.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/docs.test.js']);
});

test('user runs all remaining tests after a tracked source is deleted or renamed', async () => {
  // Given a current checkout where a source moved and an unrelated new test was discovered.
  const files = repositoryFiles({ 'src/new-name.js': 'export const other = 2;', 'test/unit/new.test.js': '' });
  delete files['src/other.js'];
  const graph = await graphFor(files);

  // When both old and new paths are included in the change set.
  const plan = selectTests(graph, ['src/other.js', 'src/new-name.js']);

  // Then deletion cannot lose its old consumers and the newly discovered test is included.
  assert.equal(plan.mode, 'full');
  assert.equal(plan.nodeTests.includes('test/unit/new.test.js'), true);
  assert.equal(plan.nodeTests.includes('test/unit/other.test.js'), true);
});

test('user selects a newly discovered test even before it is tracked', async () => {
  // Given a new test root in the current filesystem inventory.
  const graph = await graphFor(repositoryFiles({ 'test/unit/new file.test.js': '' }));

  // When the new test itself is the changed file.
  const plan = selectTests(graph, ['test/unit/new file.test.js']);

  // Then the exact new filename is selected directly.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/new file.test.js']);
});

test('user never reads protected configuration while constructing the dependency graph', async () => {
  // Given a test that names a protected config path and a reader that records content access.
  const files = repositoryFiles({ 'test/unit/protected.test.js': "await import('../../.codex/config.toml');", '.codex/config.toml': '' });
  const reads = [];

  // When the graph is constructed and the changed source is classified.
  const graph = await buildTestGraph({ files: Object.keys(files), readText: async (path) => { reads.push(path); return files[path]; } });
  const plan = selectTests(graph, ['src/shared/math.js']);

  // Then protected contents are never requested and their uncertain consumer still runs.
  assert.equal(reads.includes('.codex/config.toml'), false);
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/math.test.js', 'test/unit/protected.test.js']);
  assert.match(plan.reasons.join('\n'), /Protected dependency/);
});

test('user collects staged unstaged and untracked paths without splitting spaces or newlines', async (t) => {
  // Given a test-owned Git repository with staged, unstaged, renamed, and untracked changes.
  const root = await createRepository(t);
  await writeFile(join(root, 'src/shared/math.js'), 'export const value = 2;');
  await execute('git', ['add', 'src/shared/math.js'], { cwd: root });
  await writeFile(join(root, 'docs/guide.md'), '# Updated');
  await rename(join(root, 'src/other.js'), join(root, 'src/renamed.js'));
  const newTest = 'test/unit/new \nfile.test.js';
  await writeFile(join(root, newTest), '');

  // When the local change set and actual file inventory are collected.
  const state = await collectRepositoryState(root);

  // Then every change preserves its exact path and deleted tests or files are not invented as current roots.
  assert.deepEqual(state.changedFiles, ['docs/guide.md', 'src/other.js', 'src/renamed.js', 'src/shared/math.js', newTest].sort());
  assert.equal(state.files.includes(newTest), true);
  assert.equal(state.files.includes('src/other.js'), false);
});

test('user can compare changes against an explicit committed base', async (t) => {
  // Given a test-owned repository with a later committed source change.
  const root = await createRepository(t);
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const base = stdout.trim();
  await writeFile(join(root, 'src/shared/math.js'), 'export const value = 2;');
  await execute('git', ['add', '--all'], { cwd: root });
  await execute('git', ['-c', 'user.name=Selection Test', '-c', 'user.email=selection@example.invalid', 'commit', '--quiet', '-m', 'Change shared source'], { cwd: root });

  // When selection compares the current checkout with the supplied base commit.
  const plan = await createRepositoryPlan({ root, base });

  // Then the committed source change still selects its Node and browser consumers.
  assert.deepEqual(plan.changedFiles, ['src/shared/math.js']);
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/math.test.js']);
  assert.deepEqual(plan.browserTests, ['e2e/app/specs/page.pw.js']);
});

for (const args of [['--base'], ['--base', ''], ['--base', '0000000000000000000000000000000000000000'], ['--unknown']]) {
  test(`user gets an explicit argument error for ${JSON.stringify(args)}`, () => {
    // Given a missing base, zero base, or unsupported CLI option.
    const input = [...args];

    // When CLI arguments are parsed.
    const parse = () => parseArgs(input);

    // Then the selector refuses the invalid request instead of planning an empty run.
    assert.throws(parse, /base|argument|option/i);
  });
}

test('user gets an explicit error when a comparison base cannot resolve to a commit', async (t) => {
  // Given a test-owned repository and a nonexistent base reference.
  const root = await createRepository(t);

  // When the selector tries to collect changes from that base.
  const collect = collectRepositoryState(root, { base: 'missing-base' });

  // Then unavailable history is reported instead of silently dropping changes.
  await assert.rejects(collect, /base.*commit/i);
});

test('user receives only the JSON plan from list mode without running selected tests', async (t) => {
  // Given a changed fixture test that would throw if the CLI executed it.
  const root = await createRepository(t);
  await writeFile(join(root, 'test/unit/math.test.js'), "throw new Error('must not execute in list mode');");

  // When the CLI is invoked in list mode through an argument array.
  const { stdout, stderr } = await execute(process.execPath, [cli, '--list'], { cwd: root });
  const plan = JSON.parse(stdout);

  // Then stdout is one valid plan and the throwing test is only selected, not executed.
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.nodeTests, ['test/unit/math.test.js']);
  assert.equal(stderr, '');
});

test('user executes exact Node paths and escaped browser path filters without a shell', () => {
  // Given selected filenames containing spaces, newlines, and regular-expression characters.
  const plan = { nodeTests: ['test/unit/a \nfile.test.js'], browserTests: ['e2e/app/specs/panel[one].pw.js'] };

  // When child-process commands are constructed.
  const commands = runnerCommands(plan, { nodeExecutable: '/runtime/node', playwrightCli: '/runtime/playwright/cli.js' });

  // Then Node receives literal paths in its payload and Playwright treats brackets literally.
  assert.deepEqual(commands, [
    { command: '/runtime/node', args: [
      fileURLToPath(new URL('../../scripts/test-selection/node-runner.mjs', import.meta.url)),
      JSON.stringify({ files: ['test/unit/a \nfile.test.js'] }),
    ] },
    { command: '/runtime/node', args: ['/runtime/playwright/cli.js', 'test', '(?:^|/)e2e/app/specs/panel\\[one\\]\\.pw\\.js$'] },
  ]);
});

test('user sees a failed selected runner stop execution before later commands', async (t) => {
  // Given a test-owned directory and two commands where the first exits unsuccessfully.
  const root = await createRepository(t);
  const commands = [
    { command: process.execPath, args: ['-e', 'process.exit(7)'] },
    { command: 'a-later-command-that-must-not-run', args: [] },
  ];

  // When selected runners execute in sequence.
  const execution = runCommands(commands, { root });

  // Then the first failed exit is reported rather than continuing to another runner.
  await assert.rejects(execution, /exit code 7/);
});

for (const [kind, selected, other] of [
  ['brackets', 'case[one].test.js', 'caseo.test.js'],
  ['asterisks', 'case*.test.js', 'casex.test.js'],
  ['question marks', 'case?.test.js', 'casex.test.js'],
  ['braces', 'case{one,two}.test.js', 'caseone.test.js'],
  ['spaces and newlines', 'case (one)\nfile.test.js', 'unselected.test.js'],
]) {
  test(`user executes the literal selected filename containing ${kind}`, async (t) => {
    // Given a selected literal filename and an unrelated file that must never execute.
    const root = await mkdtemp(join(tmpdir(), 'userscripts-exact-node-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, selected), `
      import test from 'node:test';
      import { writeFileSync } from 'node:fs';
      test('user executes the selected file', () => writeFileSync('executed.txt', ${JSON.stringify(selected)}));
    `);
    await writeFile(join(root, other), "throw new Error('unselected file executed');");
    const [command] = runnerCommands({ nodeTests: [selected], browserTests: [] });

    // When the actual selected runner starts outside the parent test runner's environment.
    const { stdout } = await execute(command.command, command.args, { cwd: root, env: {} });

    // Then only the literal file's test executes successfully.
    assert.equal(await readFile(join(root, 'executed.txt'), 'utf8'), selected);
    assert.match(stdout, /pass 1/);
    assert.match(stdout, /fail 0/);
  });
}

for (const kind of ['failed', 'missing']) {
  test(`user receives a failing exit when the exact selected test file is ${kind}`, async (t) => {
    // Given a selected file is absent or contains a real failing assertion.
    const root = await mkdtemp(join(tmpdir(), 'userscripts-exact-node-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    if (kind === 'failed') await writeFile(join(root, 'selected.test.js'), `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      test('user sees a failing assertion', () => assert.fail('intentional runner failure'));
    `);
    const [command] = runnerCommands({ nodeTests: ['selected.test.js'], browserTests: [] });

    // When the actual selected runner attempts that exact file.
    const execution = execute(command.command, command.args, { cwd: root, env: {} });

    // Then the child process reports failure instead of a successful empty selection.
    await assert.rejects(execution, error => {
      assert.equal(error.code, 1);
      assert.match(error.stdout + error.stderr, kind === 'failed' ? /intentional runner failure/ : /selected\.test\.js/);
      return true;
    });
  });
}
