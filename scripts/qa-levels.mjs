import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLevels, validateLevels } from './levels.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qaRoot = resolve(projectRoot, 'qa');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const card = ({ metadata, compiled }) => {
  const [, , width, height] = compiled.viewBox.split(' ');
  return `<article class="card">
    <img src="../public/generated/thumbnails/${encodeURIComponent(metadata.id)}.png" alt="" loading="lazy">
    <div class="copy">
      <code>${escapeHtml(metadata.id)}</code>
      <h2>${escapeHtml(metadata.title.ru)}</h2>
      <p class="en">${escapeHtml(metadata.title.en)}</p>
      <dl>
        <div><dt>Category</dt><dd>${escapeHtml(metadata.category)}</dd></div>
        <div><dt>Grid</dt><dd>${width}×${height}</dd></div>
        <div><dt>Colors</dt><dd>${compiled.colors.length}</dd></div>
        <div><dt>Pixels</dt><dd>${compiled.regions.length}</dd></div>
        <div><dt>Difficulty</dt><dd>${metadata.difficulty}</dd></div>
        <div><dt>Content</dt><dd>v${metadata.contentVersion}</dd></div>
      </dl>
    </div>
  </article>`;
};

export const buildQaGallery = async () => {
  if (qaRoot !== resolve(projectRoot, 'qa') || !qaRoot.startsWith(projectRoot + sep)) {
    throw new Error('Refusing to replace QA output outside this project');
  }
  await buildLevels();
  const levels = await validateLevels();
  const totalPixels = levels.reduce((sum, level) => sum + level.compiled.regions.length, 0);
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Numbi level QA</title>
  <style>
    :root{font-family:Inter,system-ui,sans-serif;color:#30323b;background:#f4f1fb}*{box-sizing:border-box}
    body{margin:0;padding:24px}.header{max-width:1500px;margin:0 auto 22px}.header h1{margin:0 0 6px}
    .header p{margin:0;color:#686a78}.grid{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
    .card{overflow:hidden;border:1px solid #dfdbea;border-radius:18px;background:#fff;box-shadow:0 8px 24px #493b7112}
    img{width:100%;aspect-ratio:1.25;display:block;object-fit:contain;background:#faf8ff;image-rendering:auto}
    .copy{padding:14px}code{color:#6c58df;font-weight:800}h2{margin:8px 0 2px;font-size:1.1rem}.en{margin:0 0 12px;color:#747687}
    dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}dl div{display:flex;justify-content:space-between;gap:6px;border-bottom:1px solid #efedf4}
    dt{color:#747687}dd{margin:0;font-weight:750}@media(max-width:420px){body{padding:12px}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header class="header"><h1>Numbi level QA</h1><p>${levels.length} levels · ${totalPixels} playable pixels · generated ${escapeHtml(new Date().toISOString())}</p></header>
  <main class="grid">${levels.map(card).join('\n')}</main>
</body>
</html>\n`;
  await rm(qaRoot, { recursive: true, force: true });
  await mkdir(qaRoot, { recursive: true });
  const target = resolve(qaRoot, 'catalog.html');
  await writeFile(target, html);
  return { target, levelCount: levels.length, totalPixels };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildQaGallery().then(({ target, levelCount }) => {
    console.log(`QA gallery: ${target} (${levelCount} levels).`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
