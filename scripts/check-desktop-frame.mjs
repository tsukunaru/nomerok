export const desktopViewports = [
  [1920, 1080], [2560, 1080], [3440, 1440], [1280, 600], [1024, 768], [800, 600],
  [800, 1200], [600, 1200], [500, 1200], [400, 1000], [320, 1000],
];

export const desktopAppFrame = (viewportWidth, viewportHeight) => {
  const width = Math.min(viewportWidth, 1400, viewportHeight * 2);
  const height = Math.min(viewportHeight, width * 2);
  return { width, height, ratio: Math.max(width, height) / Math.min(width, height) };
};

export const checkDesktopFrames = () => desktopViewports.map(([viewportWidth, viewportHeight]) => {
  const frame = desktopAppFrame(viewportWidth, viewportHeight);
  if (frame.ratio > 2) throw new Error(`${viewportWidth}x${viewportHeight} produced ratio ${frame.ratio}`);
  return { viewportWidth, viewportHeight, ...frame };
});

if (process.argv[1]?.endsWith('check-desktop-frame.mjs')) {
  console.log('Desktop viewport\tApp frame\tRatio\tResult');
  for (const row of checkDesktopFrames()) {
    console.log(`${row.viewportWidth}x${row.viewportHeight}\t${row.width}x${row.height}\t${row.ratio.toFixed(3)}\tPASS`);
  }
}
