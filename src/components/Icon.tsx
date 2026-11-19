import type { ReactNode } from 'react';

export type IconName =
  | 'arrow-left' | 'settings' | 'sound' | 'sound-off' | 'bulb' | 'video'
  | 'plus' | 'minus' | 'reset' | 'close' | 'check' | 'sparkles' | 'gallery' | 'search';

const paths: Record<IconName, ReactNode> = {
  'arrow-left': <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.37.38.7.6 1 .28.3.66.45 1.1.4h.1v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
  sound: <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></>,
  'sound-off': <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m17 9 5 5M22 9l-5 5"/></>,
  bulb: <><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.2 14.8A7 7 0 1 1 15.8 14.8C14.8 15.5 15 17 15 18H9c0-1 .2-2.5-.8-3.2Z"/></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 6 3-6 3V9Z"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  minus: <path d="M5 12h14"/>,
  reset: <><path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 .5-7L4 10"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  sparkles: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/><path d="m5 13 .7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z"/></>,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
};

export const Icon = ({ name, size = 24 }: { name: IconName; size?: number }) => (
  <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>
);
