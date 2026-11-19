const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export const gridDimensions = (viewBox: string) => {
  const values = viewBox.trim().split(/[\s,]+/).map(Number);
  return { width: values[2] || 1, height: values[3] || 1 };
};

export const initialScaleForGrid = (gridSize: number) => {
  if (gridSize <= 20) return 1;
  if (gridSize <= 24) return 1.3;
  if (gridSize <= 27) return 1.55;
  return Math.min(5, Math.max(1.8, gridSize / 20));
};

export const numberSizeForGrid = (gridSize: number) =>
  clamp(.56 - Math.max(0, gridSize - 20) * .006, .5, .56);

interface CameraGeometry {
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly scale: number;
}

const renderedArtworkSize = ({ boxWidth, boxHeight, viewBoxWidth, viewBoxHeight }: CameraGeometry) => {
  const artworkRatio = viewBoxWidth / viewBoxHeight;
  const boxRatio = boxWidth / boxHeight;
  return artworkRatio >= boxRatio
    ? { width: boxWidth, height: boxWidth / artworkRatio }
    : { width: boxHeight * artworkRatio, height: boxHeight };
};

export const cameraBounds = (geometry: CameraGeometry) => {
  const rendered = renderedArtworkSize(geometry);
  return {
    x: Math.max(0, rendered.width * geometry.scale * (1 - 1 / geometry.viewBoxWidth) / 2),
    y: Math.max(0, rendered.height * geometry.scale * (1 - 1 / geometry.viewBoxHeight) / 2),
  };
};

export const boundCameraOffset = (
  offset: { readonly x: number; readonly y: number },
  geometry: CameraGeometry,
) => {
  const bounds = cameraBounds(geometry);
  return {
    x: clamp(offset.x, -bounds.x, bounds.x),
    y: clamp(offset.y, -bounds.y, bounds.y),
  };
};

export const cameraOffsetForPoint = (
  point: { readonly x: number; readonly y: number },
  geometry: CameraGeometry,
) => {
  const rendered = renderedArtworkSize(geometry);
  return boundCameraOffset({
    x: -(point.x / geometry.viewBoxWidth - .5) * rendered.width * geometry.scale,
    y: -(point.y / geometry.viewBoxHeight - .5) * rendered.height * geometry.scale,
  }, geometry);
};
