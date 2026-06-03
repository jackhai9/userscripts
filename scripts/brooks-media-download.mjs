import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_KINDS = new Set(['zhSubtitle', 'enSubtitle']);

function parseBooleanFlag(args, index) {
  return {
    value: true,
    nextIndex: index,
  };
}

function parseValueFlag(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }
  return {
    value,
    nextIndex: index + 1,
  };
}

function parseArgs(argv) {
  const options = {
    only: 'zhSubtitle',
    dryRun: false,
    overwrite: false,
    limit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let parsed;
    if (arg === '--audit') {
      parsed = parseValueFlag(argv, index, arg);
      options.auditPath = parsed.value;
    } else if (arg === '--local') {
      parsed = parseValueFlag(argv, index, arg);
      options.localDir = parsed.value;
    } else if (arg === '--only') {
      parsed = parseValueFlag(argv, index, arg);
      options.only = parsed.value;
    } else if (arg === '--limit') {
      parsed = parseValueFlag(argv, index, arg);
      options.limit = Number(parsed.value);
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new Error('--limit must be a positive integer');
      }
    } else if (arg === '--dry-run') {
      parsed = parseBooleanFlag(argv, index);
      options.dryRun = parsed.value;
    } else if (arg === '--overwrite') {
      parsed = parseBooleanFlag(argv, index);
      options.overwrite = parsed.value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index = parsed.nextIndex;
  }

  if (!options.auditPath) {
    throw new Error('Usage: node scripts/brooks-media-download.mjs --audit <audit.json> [--local <media-dir>] [--only zhSubtitle|enSubtitle] [--limit <n>] [--dry-run] [--overwrite]');
  }
  if (!SUPPORTED_KINDS.has(options.only)) {
    throw new Error('--only currently supports zhSubtitle or enSubtitle');
  }
  return options;
}

function safeOutputName(output) {
  const name = String(output || '').trim();
  if (!name) {
    throw new Error('Download output is empty');
  }
  if (name.includes('\0') || basename(name) !== name) {
    throw new Error(`Unsafe download output: ${name}`);
  }
  return name;
}

async function listExistingNames(localDir) {
  try {
    const entries = await readdir(localDir, { withFileTypes: true });
    return new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function assertValidVtt(content, output) {
  const text = String(content || '').replace(/^\uFEFF/, '').trimStart();
  if (!text.startsWith('WEBVTT')) {
    throw new Error(`${output} is not a VTT file`);
  }
}

export function buildBrooksMediaDownloadTasks({
  audit,
  only = 'zhSubtitle',
  localDir = null,
  existingNames = new Set(),
  limit = null,
  overwrite = false,
}) {
  if (!SUPPORTED_KINDS.has(only)) {
    throw new Error('only currently supports zhSubtitle or enSubtitle');
  }
  const targetDir = localDir || audit.localDir;
  if (!targetDir) {
    throw new Error('Missing local media directory');
  }

  const tasks = [];
  for (const item of audit.downloadPlan || []) {
    if (!Array.isArray(item.needs) || !item.needs.includes(only)) {
      continue;
    }
    const download = item.downloads && item.downloads[only];
    if (!download || !download.url) {
      continue;
    }
    const output = safeOutputName(download.output);
    if (!overwrite && existingNames.has(output)) {
      continue;
    }
    tasks.push({
      index: item.index,
      base: item.base || '',
      kind: only,
      url: download.url,
      output,
      targetPath: join(targetDir, output),
    });
    if (limit && tasks.length >= limit) {
      break;
    }
  }
  return tasks;
}

export async function downloadBrooksMediaTask(task, { fetchImpl = globalThis.fetch, overwrite = false } = {}) {
  if (!fetchImpl) {
    throw new Error('fetch is not available in this Node.js runtime');
  }
  if (!overwrite && await pathExists(task.targetPath)) {
    return {
      status: 'skipped',
      output: task.output,
      reason: 'exists',
    };
  }

  const response = await fetchImpl(task.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'text/vtt,text/plain,*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`${task.output} download failed with HTTP ${response.status}`);
  }

  const content = await response.text();
  if (task.kind === 'zhSubtitle' || task.kind === 'enSubtitle') {
    assertValidVtt(content, task.output);
  }

  await mkdir(dirname(task.targetPath), { recursive: true });
  const tempPath = `${task.targetPath}.part`;
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, task.targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  return {
    status: 'downloaded',
    output: task.output,
    bytes: Buffer.byteLength(content),
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const audit = JSON.parse(await readFile(options.auditPath, 'utf8'));
  const localDir = options.localDir || audit.localDir;
  const existingNames = await listExistingNames(localDir);
  const tasks = buildBrooksMediaDownloadTasks({
    audit,
    only: options.only,
    localDir,
    existingNames,
    limit: options.limit,
    overwrite: options.overwrite,
  });

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      only: options.only,
      localDir,
      count: tasks.length,
      outputs: tasks.map(task => task.output),
    }, null, 2));
    return;
  }

  const results = [];
  for (const task of tasks) {
    try {
      const result = await downloadBrooksMediaTask(task, { overwrite: options.overwrite });
      results.push(result);
      console.log(`${result.status}: ${result.output}`);
    } catch (error) {
      results.push({
        status: 'failed',
        output: task.output,
        error: error.message,
      });
      console.error(`failed: ${task.output}: ${error.message}`);
    }
  }

  const failed = results.filter(result => result.status === 'failed');
  console.log(JSON.stringify({
    only: options.only,
    total: results.length,
    downloaded: results.filter(result => result.status === 'downloaded').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    failed: failed.length,
  }, null, 2));
  if (failed.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
