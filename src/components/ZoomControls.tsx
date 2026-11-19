import type { Translations } from '../i18n/types.ts';
import { Icon } from './Icon.tsx';

export const ZoomControls = ({
  scale,
  resetScale,
  t,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  resetScale: number;
  t: Translations;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) => (
  <div className="zoom-controls">
    <button className="tool-button" onClick={onZoomOut} disabled={scale <= 1} aria-label={t.zoomOut}><Icon name="minus" /></button>
    <button className="tool-button zoom-value" onClick={onReset} disabled={scale === resetScale} aria-label={t.resetZoom}>{scale.toFixed(1)}×</button>
    <button className="tool-button" onClick={onZoomIn} disabled={scale >= 12} aria-label={t.zoomIn}><Icon name="plus" /></button>
  </div>
);
