import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const releaseRoot = resolve(projectRoot, 'release');
const archivePath = resolve(releaseRoot, 'numbi-yandex-final.zip');

const walk = async (folder = distRoot) => {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

export const validateEntries = (entries) => {
  const normalized = Object.fromEntries(Object.entries(entries)
    .map(([name, bytes]) => [name.replaceAll('\\', '/'), bytes]));
  const names = Object.keys(normalized);
  const required = [
    names.includes('index.html'),
    names.some((name) => name.startsWith('assets/') && name.endsWith('.js')),
    names.some((name) => name.startsWith('assets/') && name.endsWith('.css')),
    names.includes('generated/levels-manifest.json'),
  ];
  if (required.some((present) => !present)) throw new Error('ZIP validation failed: required runtime files are missing');
  const indexHtml = new TextDecoder().decode(normalized['index.html']);
  if (!/<script\b[^>]*\btype=["']module["']/i.test(indexHtml) || !/<script\b[^>]*\bnomodule(?:\s|=|>)/i.test(indexHtml)) {
    throw new Error('ZIP validation failed: modern or legacy browser entry is missing');
  }
  const forbidden = names.find((name) =>
    name.startsWith('/') || name.startsWith('../') ||
    name.startsWith('dist/') ||
    /(^|\/)(?:node_modules|content|qa|src|tests?|release|\.cache)(?:\/|$)/i.test(name) ||
    /(^|\/)source\.(?:png|jpe?g|webp)$/i.test(name) ||
    /\.(?:map|webp|zip)$/i.test(name));
  if (forbidden) throw new Error('ZIP validation failed: forbidden entry ' + forbidden);
  return [...new Set(names.map((name) => name.split('/')[0]))].sort();
};

export const packageYandex = async () => {
  if (releaseRoot !== resolve(projectRoot, 'release') || !releaseRoot.startsWith(projectRoot + sep)) {
    throw new Error('Refusing to replace release files outside this project');
  }
  const paths = await walk();
  const input = {};
  for (const path of paths) {
    input[relative(distRoot, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
  const archive = zipSync(input, { level: 9 });
  const topLevel = validateEntries(unzipSync(archive));
  await mkdir(releaseRoot, { recursive: true });
  await writeFile(archivePath, archive);
  validateEntries(unzipSync(new Uint8Array(await readFile(archivePath))));
  return { archivePath, bytes: archive.byteLength, topLevel, fileCount: Object.keys(input).length };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageYandex().then((result) => {
    console.log(`Yandex package validation: OK (${result.fileCount} files, ${(result.bytes / 1024 / 1024).toFixed(2)} MB).`);
    console.log('ZIP top-level paths: ' + result.topLevel.join(', '));
    console.log('Release: ' + result.archivePath);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
