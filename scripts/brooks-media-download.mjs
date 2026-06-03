import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_KINDS = new Set(['zhSubtitle', 'enSubtitle', 'video', 'oldVariants']);
const CAPTION_KINDS = ['enSubtitle', 'zhSubtitle'];
const ARCHIVE_DIR_BY_VARIANT = {
  video: 'videos',
  'subtitle:en': 'subtitles-en',
  'subtitle:zh': 'subtitles-zh',
  'subtitle:unknown': 'subtitles-unknown',
};

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
    confirmVideoDownload: false,
    refreshCaptionsWithVideo: false,
    archiveOldVariantsDir: null,
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
    } else if (arg === '--confirm-video-download') {
      parsed = parseBooleanFlag(argv, index);
      options.confirmVideoDownload = parsed.value;
    } else if (arg === '--with-captions') {
      parsed = parseBooleanFlag(argv, index);
      options.refreshCaptionsWithVideo = parsed.value;
    } else if (arg === '--archive-old-variants') {
      parsed = parseValueFlag(argv, index, arg);
      options.archiveOldVariantsDir = parsed.value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index = parsed.nextIndex;
  }

  if (!options.auditPath) {
    throw new Error('Usage: node scripts/brooks-media-download.mjs --audit <audit.json> [--local <media-dir>] [--only zhSubtitle|enSubtitle|video|oldVariants] [--limit <n>] [--dry-run] [--overwrite] [--confirm-video-download] [--with-captions] [--archive-old-variants <dir>]');
  }
  if (!SUPPORTED_KINDS.has(options.only)) {
    throw new Error('--only currently supports zhSubtitle, enSubtitle, video, or oldVariants');
  }
  if (options.refreshCaptionsWithVideo && options.only !== 'video') {
    throw new Error('--with-captions is only supported with --only video');
  }
  if (options.archiveOldVariantsDir && !['video', 'oldVariants'].includes(options.only)) {
    throw new Error('--archive-old-variants is only supported with --only video or --only oldVariants');
  }
  if (options.archiveOldVariantsDir && options.only === 'video' && !options.refreshCaptionsWithVideo) {
    throw new Error('--archive-old-variants requires --with-captions so old files are moved only after the new video and captions refresh together');
  }
  if (options.only === 'oldVariants' && !options.archiveOldVariantsDir) {
    throw new Error('--only oldVariants requires --archive-old-variants <dir>');
  }
  return options;
}

function shellQuote(value) {
  return "'" + String(value || '').replace(/'/g, "'\\''") + "'";
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

function deriveEnglishCaptionUrl(url) {
  return String(url || '').replace(/\/CN\.vtt(?:$|[?#])/i, match => match.replace(/CN\.vtt/i, 'EN.vtt'));
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
  refreshCaptionsWithVideo = false,
  archiveOldVariantsDir = null,
}) {
  if (!SUPPORTED_KINDS.has(only)) {
    throw new Error('only currently supports zhSubtitle, enSubtitle, video, or oldVariants');
  }
  const targetDir = localDir || audit.localDir;
  if (!targetDir) {
    throw new Error('Missing local media directory');
  }

  if (only === 'oldVariants') {
    if (!archiveOldVariantsDir) {
      throw new Error('oldVariants tasks require archiveOldVariantsDir');
    }
    const tasks = [];
    for (const item of audit.items || []) {
      const oldVariantFiles = buildOldVariantArchiveFiles({ item, archiveOldVariantsDir });
      if (!oldVariantFiles.length) {
        continue;
      }
      tasks.push({
        index: item.index,
        base: item.base || '',
        kind: 'oldVariants',
        output: item.base || String(item.index || ''),
        oldVariantFiles,
      });
      if (limit && tasks.length >= limit) {
        break;
      }
    }
    return tasks;
  }

  const tasks = [];
  for (const item of audit.downloadPlan || []) {
    if (!Array.isArray(item.needs) || !item.needs.includes(only)) {
      continue;
    }
    const download = item.downloads && item.downloads[only];
    const sourceUrl = only === 'video' ? download && download.m3u8 : download && download.url;
    if (!download || !sourceUrl) {
      continue;
    }
    const output = safeOutputName(download.output);
    const targetPath = join(targetDir, output);
    const ytDlpArgs = only === 'video'
      ? [
          '--referer',
          download.referer || '',
          '-N',
          '16',
          '-o',
          targetPath,
          sourceUrl,
        ]
      : null;
    if (!overwrite && existingNames.has(output)) {
      continue;
    }
    const task = {
      index: item.index,
      base: item.base || '',
      kind: only,
      url: sourceUrl,
      comparison: only === 'zhSubtitle' && item.downloads && item.downloads.enSubtitle && item.downloads.enSubtitle.url
        ? {
            kind: 'enSubtitle',
            url: item.downloads.enSubtitle.url,
          }
        : only === 'zhSubtitle'
          ? {
              kind: 'enSubtitle',
              url: deriveEnglishCaptionUrl(sourceUrl),
            }
          : null,
      output,
      targetPath,
      ytDlpArgs,
      ytDlpCommand: only === 'video'
        ? [
            'yt-dlp',
            '--referer',
            shellQuote(download.referer || ''),
            '-N',
            '16',
            '-o',
            shellQuote(targetPath),
            shellQuote(sourceUrl),
          ].join(' ')
        : null,
    };
    if (only === 'video' && refreshCaptionsWithVideo) {
      task.captionTasks = CAPTION_KINDS
        .map(kind => buildCaptionRefreshTask({ item, kind, targetDir }))
        .filter(Boolean);
    }
    if (only === 'video' && archiveOldVariantsDir) {
      task.oldVariantFiles = buildOldVariantArchiveFiles({ item, archiveOldVariantsDir });
    }
    tasks.push(task);
    if (limit && tasks.length >= limit) {
      break;
    }
  }
  return tasks;
}

function variantArchiveSubdir(file) {
  const key = file.kind === 'subtitle' ? `subtitle:${file.lang || 'unknown'}` : file.kind;
  return ARCHIVE_DIR_BY_VARIANT[key] || 'other';
}

function buildOldVariantArchiveFiles({ item, archiveOldVariantsDir }) {
  return (item.local && Array.isArray(item.local.variants) ? item.local.variants : [])
    .map(file => ({
      kind: file.kind,
      lang: file.lang,
      name: safeOutputName(file.name),
      sourcePath: file.path,
      targetPath: join(archiveOldVariantsDir, variantArchiveSubdir(file), safeOutputName(file.name)),
    }));
}

function buildCaptionRefreshTask({ item, kind, targetDir }) {
  const download = item.downloads && item.downloads[kind];
  if (!download || !download.url) {
    return null;
  }
  const output = safeOutputName(download.output);
  const comparison = kind === 'zhSubtitle' && item.downloads && item.downloads.enSubtitle && item.downloads.enSubtitle.url
    ? {
        kind: 'enSubtitle',
        url: item.downloads.enSubtitle.url,
      }
    : kind === 'zhSubtitle'
      ? {
          kind: 'enSubtitle',
          url: deriveEnglishCaptionUrl(download.url),
        }
      : null;
  return {
    index: item.index,
    base: item.base || '',
    kind,
    url: download.url,
    comparison,
    output,
    targetPath: join(targetDir, output),
    ytDlpArgs: null,
    ytDlpCommand: null,
  };
}

export function getYtDlpAvailability({ commandExists = null } = {}) {
  const command = 'yt-dlp';
  if (commandExists) {
    return {
      available: !!commandExists(command),
      command,
    };
  }
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
  });
  return {
    available: result.status === 0,
    command,
  };
}

export function downloadBrooksVideoTask(task, { spawnImpl = spawnSync } = {}) {
  const result = spawnImpl('yt-dlp', task.ytDlpArgs, {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${task.output} video download failed with yt-dlp exit code ${result.status}`);
  }
  return {
    status: 'downloaded',
    output: task.output,
  };
}

export async function archiveBrooksOldVariantFiles(task) {
  const files = task.oldVariantFiles || [];
  if (!files.length) {
    return {
      status: 'skipped',
      count: 0,
      outputs: [],
    };
  }

  for (const file of files) {
    if (!file.sourcePath || !file.targetPath) {
      throw new Error(`${file.name || task.output} has incomplete archive paths`);
    }
    if (!await pathExists(file.sourcePath)) {
      throw new Error(`${file.sourcePath} does not exist`);
    }
    if (await pathExists(file.targetPath)) {
      throw new Error(`${file.targetPath} already exists`);
    }
  }

  for (const file of files) {
    await mkdir(dirname(file.targetPath), { recursive: true });
    await rename(file.sourcePath, file.targetPath);
  }

  return {
    status: 'archived',
    count: files.length,
    outputs: files.map(file => file.name),
  };
}

export async function preflightBrooksOldVariantArchiveTasks(tasks) {
  const targetPaths = new Set();
  const files = tasks.flatMap(task => task.oldVariantFiles || []);
  for (const file of files) {
    if (!file.sourcePath || !file.targetPath) {
      throw new Error(`${file.name || 'old variant'} has incomplete archive paths`);
    }
    if (targetPaths.has(file.targetPath)) {
      throw new Error(`Duplicate archive target: ${file.targetPath}`);
    }
    targetPaths.add(file.targetPath);
    if (!await pathExists(file.sourcePath)) {
      throw new Error(`${file.sourcePath} does not exist`);
    }
    if (await pathExists(file.targetPath)) {
      throw new Error(`${file.targetPath} already exists`);
    }
  }

  return {
    files: files.length,
  };
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
    if (task.kind === 'zhSubtitle' && response.status === 404 && task.comparison && task.comparison.url) {
      const comparisonResponse = await fetchImpl(task.comparison.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'text/vtt,text/plain,*/*',
        },
      });
      if (comparisonResponse.ok) {
        return {
          status: 'unavailable',
          output: task.output,
          reason: 'zhSubtitleNotPublished',
          httpStatus: response.status,
          comparison: {
            kind: task.comparison.kind,
            status: comparisonResponse.status,
          },
        };
      }
    }
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
    refreshCaptionsWithVideo: options.refreshCaptionsWithVideo,
    archiveOldVariantsDir: options.archiveOldVariantsDir,
  });

  if (options.dryRun) {
    const ytDlp = options.only === 'video' ? getYtDlpAvailability() : null;
    console.log(JSON.stringify({
      dryRun: true,
      only: options.only,
      localDir,
      count: tasks.length,
      outputs: tasks.map(task => task.output),
      captionOutputs: options.refreshCaptionsWithVideo
        ? tasks.flatMap(task => (task.captionTasks || []).map(captionTask => captionTask.output))
        : undefined,
      archiveOutputs: options.archiveOldVariantsDir
        ? tasks.flatMap(task => (task.oldVariantFiles || []).map(file => file.name))
        : undefined,
      ytDlp,
      commands: options.only === 'video' ? tasks.map(task => task.ytDlpCommand) : undefined,
    }, null, 2));
    return;
  }

  if (options.only === 'oldVariants') {
    const preflight = await preflightBrooksOldVariantArchiveTasks(tasks);
    const archiveResults = [];
    for (const task of tasks) {
      try {
        const archiveResult = await archiveBrooksOldVariantFiles(task);
        archiveResults.push(archiveResult);
        console.log(`${archiveResult.status}: ${archiveResult.count} old variant files for ${task.output}`);
      } catch (error) {
        archiveResults.push({
          status: 'failed',
          output: task.output,
          error: error.message,
        });
        console.error(`failed: archive old variants for ${task.output}: ${error.message}`);
      }
    }
    const failedArchives = archiveResults.filter(result => result.status === 'failed');
    console.log(JSON.stringify({
      only: options.only,
      tasks: tasks.length,
      preflight,
      archivedOldVariants: {
        total: archiveResults.reduce((sum, result) => sum + (result.count || 0), 0),
        archivedTasks: archiveResults.filter(result => result.status === 'archived').length,
        skippedTasks: archiveResults.filter(result => result.status === 'skipped').length,
        failed: failedArchives.length,
      },
    }, null, 2));
    if (failedArchives.length) {
      process.exitCode = 1;
    }
    return;
  }

  if (options.only === 'video') {
    const ytDlp = getYtDlpAvailability();
    if (!ytDlp.available) {
      throw new Error('yt-dlp is required for video downloads. Install yt-dlp first, or run with --dry-run to inspect planned commands.');
    }
    if (!options.confirmVideoDownload) {
      throw new Error('Video download requires --confirm-video-download. Run with --dry-run first, then use --limit 1 --confirm-video-download for a sample.');
    }
    const results = [];
    const captionResults = [];
    const archiveResults = [];
    for (const task of tasks) {
      const result = downloadBrooksVideoTask(task);
      results.push(result);
      console.log(`${result.status}: ${result.output}`);
      const taskCaptionResults = [];
      if (options.refreshCaptionsWithVideo) {
        for (const captionTask of task.captionTasks || []) {
          try {
            const captionResult = await downloadBrooksMediaTask(captionTask, { overwrite: true });
            captionResults.push(captionResult);
            taskCaptionResults.push(captionResult);
            if (captionResult.status === 'unavailable' && captionResult.reason === 'zhSubtitleNotPublished') {
              console.log(`unavailable: ${captionResult.output} (CN ${captionResult.httpStatus}, EN ${captionResult.comparison.status}; Chinese subtitle is not published yet)`);
            } else {
              console.log(`${captionResult.status}: ${captionResult.output}`);
            }
          } catch (error) {
            captionResults.push({
              status: 'failed',
              output: captionTask.output,
              error: error.message,
            });
            taskCaptionResults.push({
              status: 'failed',
              output: captionTask.output,
              error: error.message,
            });
            console.error(`failed: ${captionTask.output}: ${error.message}`);
          }
        }
      }
      if (options.archiveOldVariantsDir) {
        const captionsReady = (task.captionTasks || []).length === CAPTION_KINDS.length
          && taskCaptionResults.length === CAPTION_KINDS.length
          && taskCaptionResults.every(captionResult => captionResult.status === 'downloaded');
        if (captionsReady) {
          try {
            const archiveResult = await archiveBrooksOldVariantFiles(task);
            archiveResults.push(archiveResult);
            console.log(`${archiveResult.status}: ${archiveResult.count} old variant files for ${task.output}`);
          } catch (error) {
            archiveResults.push({
              status: 'failed',
              output: task.output,
              error: error.message,
            });
            console.error(`failed: archive old variants for ${task.output}: ${error.message}`);
          }
        } else {
          const archiveResult = {
            status: 'skipped',
            output: task.output,
            reason: 'captions-not-refreshed',
            count: 0,
          };
          archiveResults.push(archiveResult);
          console.log(`skipped: archive old variants for ${task.output} (captions were not fully refreshed)`);
        }
      }
    }
    const failedCaptions = captionResults.filter(result => result.status === 'failed');
    const failedArchives = archiveResults.filter(result => result.status === 'failed');
    console.log(JSON.stringify({
      only: options.only,
      total: results.length,
      downloaded: results.length,
      captionRefresh: options.refreshCaptionsWithVideo
        ? {
            total: captionResults.length,
            downloaded: captionResults.filter(result => result.status === 'downloaded').length,
            skipped: captionResults.filter(result => result.status === 'skipped').length,
            unavailable: captionResults.filter(result => result.status === 'unavailable').length,
            failed: failedCaptions.length,
          }
        : undefined,
      archivedOldVariants: options.archiveOldVariantsDir
        ? {
            total: archiveResults.reduce((sum, result) => sum + (result.count || 0), 0),
            archivedTasks: archiveResults.filter(result => result.status === 'archived').length,
            skippedTasks: archiveResults.filter(result => result.status === 'skipped').length,
            failed: failedArchives.length,
          }
        : undefined,
      failed: 0,
    }, null, 2));
    if (failedCaptions.length || failedArchives.length) {
      process.exitCode = 1;
    }
    return;
  }

  const results = [];
  for (const task of tasks) {
    try {
      const result = await downloadBrooksMediaTask(task, { overwrite: options.overwrite });
      results.push(result);
      if (result.status === 'unavailable' && result.reason === 'zhSubtitleNotPublished') {
        console.log(`unavailable: ${result.output} (CN ${result.httpStatus}, EN ${result.comparison.status}; Chinese subtitle is not published yet)`);
      } else {
        console.log(`${result.status}: ${result.output}`);
      }
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
    unavailable: results.filter(result => result.status === 'unavailable').length,
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
