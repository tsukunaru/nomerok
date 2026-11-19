import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDistRoot = resolve(projectRoot, 'dist');
const megabyte = 1_000_000;
export const YANDEX_INTERNAL_LIMIT_BYTES = 95_000_000;

const walk = async (root, folder = root) => {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push({
      path,
      name: relative(root, path).replaceAll('\\', '/'),
      bytes: (await readFile(path)).byteLength,
    });
  }
  return files;
};

const categoryFor = (name) => {
  if (name.startsWith('generated/levels/')) return 'levels';
  if (name.startsWith('generated/thumbnails/')) return 'thumbnails';
  if (['.html', '.css', '.js'].includes(extname(name).toLowerCase())) return 'app';
  return 'other';
};

const formatMb = (bytes) => (bytes / megabyte).toFixed(2) + ' MB';

export const classifyYandexSize = (bytes) => bytes >= YANDEX_INTERNAL_LIMIT_BYTES ? 'failure'
  : bytes >= 80_000_000 ? 'strong-warning'
    : bytes >= 70_000_000 ? 'warning'
      : 'healthy';

export const auditYandexSize = async (distRoot = defaultDistRoot) => {
  const files = await walk(distRoot);
  const categories = { app: 0, levels: 0, thumbnails: 0, other: 0 };
  files.forEach((file) => { categories[categoryFor(file.name)] += file.bytes; });
  const total = Object.values(categories).reduce((sum, bytes) => sum + bytes, 0);
  let levelCount = 0;
  try {
    levelCount = JSON.parse(await readFile(resolve(distRoot, 'generated/levels-manifest.json'), 'utf8')).length;
  } catch {
    // Packaging validation reports a missing manifest more specifically.
  }
  const perLevelBytes = levelCount ? (categories.levels + categories.thumbnails) / levelCount : 0;
  const estimated300 = categories.app + categories.other + perLevelBytes * 300;
  const status = classifyYandexSize(total);
  return { files, categories, total, levelCount, estimated300, status };
};

export const printYandexSizeReport = (report) => {
  console.log('Yandex Games build size');
  console.log(`HTML/CSS/JS:  ${formatMb(report.categories.app)}`);
  console.log(`Levels:        ${formatMb(report.categories.levels)}`);
  console.log(`Thumbnails:    ${formatMb(report.categories.thumbnails)}`);
  console.log(`Other:         ${formatMb(report.categories.other)}`);
  console.log('--------------------------------');
  console.log(`TOTAL:         ${formatMb(report.total)}`);
  console.log(`Internal limit: ${formatMb(YANDEX_INTERNAL_LIMIT_BYTES)}`);
  const labels = {
    healthy: '✅ healthy',
    warning: '⚠ warning (70–80 MB)',
    'strong-warning': '⚠ strong warning (80–95 MB)',
    failure: '❌ failure: internal 95 MB limit reached',
  };
  console.log(`Status:        ${labels[report.status]}`);
  if (report.levelCount) console.log(`Estimated 300-level runtime size: ~${formatMb(report.estimated300)}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditYandexSize().then((report) => {
    printYandexSizeReport(report);
    if (report.status === 'failure') process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
