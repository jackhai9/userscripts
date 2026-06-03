import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importLatestBrooksMediaIndex } from './brooks-media-import-index.mjs';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm']);
const SUBTITLE_EXTENSIONS = new Set(['.vtt', '.srt']);

export function titleKey(value) {
  return String(value || '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripVersionSuffix(value) {
  return String(value || '')
    .replace(/\s+(?:v|version)\s*\d+\s*$/i, '')
    .trim();
}

function stripOutputExtension(value) {
  return String(value || '').replace(/\.%\((?:ext)\)s$/i, '').trim();
}

function shellQuote(value) {
  return "'" + String(value || '').replace(/'/g, "'\\''") + "'";
}

export function buildYtDlpCommand({ referer, output, m3u8 }) {
  return [
    'yt-dlp',
    '--referer',
    shellQuote(referer),
    '-N',
    '16',
    '-o',
    shellQuote(output),
    shellQuote(m3u8),
  ].join(' ');
}

function removeTrailingMediaMarker(value) {
  return String(value || '').replace(/\.(?:mp4|mkv|webm)$/i, '');
}

function splitKnownExtension(name) {
  const lower = name.toLowerCase();
  for (const extension of [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS]) {
    if (lower.endsWith(extension)) {
      return {
        stem: name.slice(0, -extension.length),
        extension,
      };
    }
  }
  return null;
}

export function parseLocalMediaFile(path) {
  const name = basename(path);
  const parsed = splitKnownExtension(name);
  if (!parsed) {
    return null;
  }

  let base = parsed.stem;
  let kind = 'video';
  let lang = null;

  if (SUBTITLE_EXTENSIONS.has(parsed.extension)) {
    kind = 'subtitle';
    const langMatch = base.match(/\.(en|zh)$/i);
    if (langMatch) {
      lang = langMatch[1].toLowerCase();
      base = base.slice(0, -langMatch[0].length);
    } else {
      lang = 'unknown';
    }
  }

  base = removeTrailingMediaMarker(base);
  const key = titleKey(base);
  return {
    path,
    name,
    kind,
    lang,
    base,
    key,
    seriesKey: titleKey(stripVersionSuffix(base)),
  };
}

function groupLocalFiles(localFiles) {
  const parsed = localFiles
    .map(parseLocalMediaFile)
    .filter(Boolean);
  const byKey = new Map();
  const bySeriesKey = new Map();

  for (const file of parsed) {
    if (!byKey.has(file.key)) {
      byKey.set(file.key, []);
    }
    byKey.get(file.key).push(file);

    if (!bySeriesKey.has(file.seriesKey)) {
      bySeriesKey.set(file.seriesKey, []);
    }
    bySeriesKey.get(file.seriesKey).push(file);
  }

  return { parsed, byKey, bySeriesKey };
}

function summarizeFiles(files) {
  return files.map(file => ({
    name: file.name,
    path: file.path,
    kind: file.kind,
    lang: file.lang,
    base: file.base,
  }));
}

function filesByKind(files, kind, lang = null) {
  return files.filter(file => file.kind === kind && (lang === null || file.lang === lang));
}

function buildDownloads(record, base, needs) {
  const downloads = {};
  if (needs.includes('video')) {
    downloads.video = {
      m3u8: record.m3u8 || '',
      referer: record.referer || '',
      output: `${base}.%(ext)s`,
      ytDlpCommand: buildYtDlpCommand({
        referer: record.referer || '',
        output: `${base}.%(ext)s`,
        m3u8: record.m3u8 || '',
      }),
    };
  }
  if (needs.includes('video') || needs.includes('enSubtitle')) {
    downloads.enSubtitle = {
      url: record.en || '',
      output: `${base}.en.vtt`,
    };
  }
  if (needs.includes('video') || needs.includes('zhSubtitle')) {
    downloads.zhSubtitle = {
      url: record.cn || '',
      output: `${base}.zh.vtt`,
    };
  }
  return downloads;
}

export function auditBrooksMediaIndex({ index, indexPath, localDir, localFiles, generatedAt = new Date().toISOString() }) {
  const records = index.records || [];
  const groups = groupLocalFiles(localFiles);
  const items = records.map(record => {
    const base = removeTrailingMediaMarker(stripOutputExtension(record.output || record.mediaTitle || record.title || ''));
    const key = titleKey(base);
    const seriesKey = titleKey(stripVersionSuffix(base));
    const exactFiles = groups.byKey.get(key) || [];
    const variantFiles = (groups.bySeriesKey.get(seriesKey) || []).filter(file => file.key !== key);

    const currentVideo = filesByKind(exactFiles, 'video');
    const currentEn = filesByKind(exactFiles, 'subtitle', 'en');
    const currentZh = filesByKind(exactFiles, 'subtitle', 'zh');
    const needs = [];
    if (!currentVideo.length) needs.push('video');
    if (!currentEn.length) needs.push('enSubtitle');
    if (!currentZh.length) needs.push('zhSubtitle');

    return {
      index: record.index,
      pageUrl: record.pageUrl || record.url || '',
      videoId: record.videoId || '',
      base,
      output: `${base}.%(ext)s`,
      currentComplete: needs.length === 0,
      needs,
      local: {
        current: {
          video: summarizeFiles(currentVideo),
          enSubtitle: summarizeFiles(currentEn),
          zhSubtitle: summarizeFiles(currentZh),
        },
        variants: summarizeFiles(variantFiles),
      },
      downloads: buildDownloads(record, base, needs),
    };
  });

  const summary = {
    records: records.length,
    completed: !!index.completed,
    failures: (index.failures || []).length,
    missingIndexes: (index.missingIndexes || []).length,
    localFiles: groups.parsed.length,
    currentComplete: items.filter(item => item.currentComplete).length,
    missingCurrentVideo: items.filter(item => item.needs.includes('video')).length,
    missingCurrentEn: items.filter(item => item.needs.includes('enSubtitle')).length,
    missingCurrentZh: items.filter(item => item.needs.includes('zhSubtitle')).length,
    needingAnyDownload: items.filter(item => item.needs.length > 0).length,
    withLocalVariants: items.filter(item => item.local.variants.length > 0).length,
  };

  return {
    generatedAt,
    indexPath,
    localDir,
    summary,
    downloadPlan: items.filter(item => item.needs.length > 0),
    items,
  };
}

async function listLocalFiles(localDir) {
  const entries = await readdir(localDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => join(localDir, entry.name));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--index') {
      args.indexPath = argv[++index];
    } else if (arg === '--local') {
      args.localDir = argv[++index];
    } else if (arg === '--output') {
      args.outputPath = argv[++index];
    } else if (arg === '--downloads') {
      args.downloadsDir = argv[++index];
    } else if (arg === '--reports') {
      args.reportsDir = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.indexPath || !args.localDir || !args.outputPath) {
    throw new Error('Usage: node scripts/brooks-media-audit.mjs --index <index.json> --local <media-dir> --output <audit.json>');
  }
  return args;
}

export async function runCli(argv = process.argv.slice(2)) {
  let { indexPath, localDir, outputPath, downloadsDir, reportsDir } = parseArgs(argv);
  if (indexPath === 'latest') {
    const imported = await importLatestBrooksMediaIndex({ downloadsDir, reportsDir });
    indexPath = imported.targetPath;
    console.log(`Imported latest Brooks media index: ${imported.status} ${indexPath}`);
  }
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const localFiles = await listLocalFiles(localDir);
  const audit = auditBrooksMediaIndex({
    index,
    indexPath,
    localDir,
    localFiles,
  });
  await writeFile(outputPath, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify(audit.summary, null, 2));
  console.log(`Wrote ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
