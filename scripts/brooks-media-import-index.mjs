import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readdir, readFile, rename, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DOWNLOADS_DIR = join(homedir(), 'Downloads');
const DEFAULT_REPORTS_DIR = getDefaultBrooksReportsDir();

export function getDefaultBrooksReportsDir(home = homedir()) {
  return join(home, 'PA', 'brooks-media-sync', 'reports');
}

function parseArgs(argv) {
  const options = {
    downloadsDir: DEFAULT_DOWNLOADS_DIR,
    reportsDir: DEFAULT_REPORTS_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--downloads') {
      if (!value) throw new Error('Missing value for --downloads');
      options.downloadsDir = value;
      index += 1;
    } else if (arg === '--reports') {
      if (!value) throw new Error('Missing value for --reports');
      options.reportsDir = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function isBrooksMediaIndexName(name) {
  return /^brooks-media-index-.+\.json$/.test(name);
}

function normalizeTimestampForFilename(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Brooks media index exportedAt: ${value}`);
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
}

function assertBrooksMediaIndex(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.records)) {
    throw new Error('Not a Brooks media index JSON');
  }
  if (payload.completed !== true) {
    throw new Error('Brooks media index is not complete');
  }
  if (!payload.exportedAt) {
    throw new Error('Brooks media index is missing exportedAt');
  }
}

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function readCandidate(path) {
  const content = await readFile(path, 'utf8');
  const payload = JSON.parse(content);
  assertBrooksMediaIndex(payload);
  const fileStat = await stat(path);
  return {
    path,
    content,
    payload,
    mtimeMs: fileStat.mtimeMs,
  };
}

export function buildBrooksMediaIndexReportName(payload, { hash = null } = {}) {
  const base = `brooks-media-index-${normalizeTimestampForFilename(payload.exportedAt)}`;
  return hash ? `${base}-${hash}.json` : `${base}.json`;
}

export async function importLatestBrooksMediaIndex({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  reportsDir = DEFAULT_REPORTS_DIR,
} = {}) {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const candidateNames = entries
    .filter(entry => entry.isFile() && isBrooksMediaIndexName(entry.name))
    .map(entry => entry.name);
  if (!candidateNames.length) {
    throw new Error(`No brooks-media-index JSON files found in ${downloadsDir}`);
  }

  const candidates = [];
  for (const name of candidateNames) {
    try {
      candidates.push(await readCandidate(join(downloadsDir, name)));
    } catch {
      // Ignore stale or unrelated files that only happen to match the filename prefix.
    }
  }
  if (!candidates.length) {
    throw new Error(`No complete Brooks media index JSON files found in ${downloadsDir}`);
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || basename(b.path).localeCompare(basename(a.path)));

  const source = candidates[0];
  await mkdir(reportsDir, { recursive: true });
  let targetPath = join(reportsDir, buildBrooksMediaIndexReportName(source.payload));
  try {
    const existing = await readFile(targetPath, 'utf8');
    if (existing === source.content) {
      await rm(source.path);
      return {
        status: 'duplicate',
        sourcePath: source.path,
        targetPath,
      };
    }
    const hash = contentHash(source.content).slice(0, 8);
    targetPath = join(reportsDir, buildBrooksMediaIndexReportName(source.payload, { hash }));
    try {
      await readFile(targetPath, 'utf8');
      throw new Error(`${targetPath} already exists`);
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    }
    await writeFile(targetPath, source.content, { flag: 'wx' });
    await rm(source.path);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await rename(source.path, targetPath);
    } else {
      throw error;
    }
  }

  return {
    status: 'moved',
    sourcePath: source.path,
    targetPath,
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const result = await importLatestBrooksMediaIndex(parseArgs(argv));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
