import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { boundCameraOffset, cameraOffsetForPoint } from '../game/camera.ts';

interface ZoomPanOptions {
  readonly initialScale: number;
  readonly resetKey: string;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly disabled?: boolean;
  readonly onTap: (regionId: string) => void;
  readonly onPaintStroke: (regionIds: readonly string[]) => void;
}

type Gesture = {
  pointerId: number;
  mode: 'pending-paint' | 'paint' | 'pan';
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  firstRegionId: string | null;
  seen: Set<string>;
  queued: string[];
};

type Pinch = {
  startDistance: number;
  startScale: number;
  startCenterX: number;
  startCenterY: number;
  baseX: number;
  baseY: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
const hasPointerEvents = () => typeof window.PointerEvent === 'function';
const mousePointerId = -1;

export const useZoomPan = ({
  initialScale,
  resetKey,
  viewBoxWidth,
  viewBoxHeight,
  disabled = false,
  onTap,
  onPaintStroke,
}: ZoomPanOptions) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  const paintFrame = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);
  const spacePressed = useRef(false);
  const lastTouchAt = useRef(0);
  const [scale, setScale] = useState(initialScale);
  const scaleRef = useRef(scale);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [transitioning, setTransitioning] = useState(false);

  const geometry = useCallback((nextScale = scaleRef.current) => ({
    boxWidth: transformRef.current?.clientWidth ?? viewportRef.current?.clientWidth ?? 1,
    boxHeight: transformRef.current?.clientHeight ?? viewportRef.current?.clientHeight ?? 1,
    viewBoxWidth,
    viewBoxHeight,
    scale: nextScale,
  }), [viewBoxHeight, viewBoxWidth]);

  const setBoundOffset = useCallback((next: { x: number; y: number }, nextScale = scaleRef.current) => {
    setOffset(boundCameraOffset(next, geometry(nextScale)));
  }, [geometry]);

  const flushPaint = useCallback(() => {
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    paintFrame.current = null;
    const active = gesture.current;
    if (!active?.queued.length) return;
    onPaintStroke(active.queued.splice(0));
  }, [onPaintStroke]);

  const queueRegion = useCallback((regionId: string | null) => {
    const active = gesture.current;
    if (!active || !regionId || active.seen.has(regionId)) return;
    active.seen.add(regionId);
    active.queued.push(regionId);
    paintFrame.current ??= requestAnimationFrame(flushPaint);
  }, [flushPaint]);

  const regionAt = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    const element = document.elementFromPoint(clientX, clientY);
    const region = element instanceof Element ? element.closest<SVGGElement>('[data-region-id]') : null;
    return viewport && region && viewport.contains(region) ? region.dataset.regionId ?? null : null;
  }, []);

  const pinchPoints = () => [...pointers.current.values()].slice(0, 2);

  const startPinch = useCallback(() => {
    const [first, second] = pinchPoints();
    if (!first || !second) return;
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    paintFrame.current = null;
    gesture.current = null;
    pinch.current = {
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startScale: scaleRef.current,
      startCenterX: (first.x + second.x) / 2,
      startCenterY: (first.y + second.y) / 2,
      baseX: offset.x,
      baseY: offset.y,
    };
    setTransitioning(false);
  }, [offset]);

  const changeScale = useCallback((amount: number) => {
    setScale((current) => {
      const next = clamp(Math.round((current + amount) * 20) / 20, 1, 12);
      scaleRef.current = next;
      setBoundOffset(offset, next);
      return next;
    });
  }, [offset, setBoundOffset]);

  const reset = useCallback(() => {
    scaleRef.current = initialScale;
    setScale(initialScale);
    setOffset({ x: 0, y: 0 });
  }, [initialScale]);

  const focusPoint = useCallback((x: number, y: number) => {
    const nextScale = Math.max(scaleRef.current, 2);
    scaleRef.current = nextScale;
    setTransitioning(true);
    setScale(nextScale);
    setOffset(cameraOffsetForPoint({ x, y }, geometry(nextScale)));
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setTransitioning(false), 420);
  }, [geometry]);

  useEffect(() => {
    reset();
    gesture.current = null;
    pointers.current.clear();
    pinch.current = null;
  }, [reset, resetKey]);

  useEffect(() => {
    if (!disabled) return;
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    paintFrame.current = null;
    gesture.current = null;
    pointers.current.clear();
    pinch.current = null;
  }, [disabled]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) spacePressed.current = true;
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressed.current = false;
    };
    const blur = () => { spacePressed.current = false; };
    addEventListener('keydown', keyDown);
    addEventListener('keyup', keyUp);
    addEventListener('blur', blur);
    return () => {
      removeEventListener('keydown', keyDown);
      removeEventListener('keyup', keyUp);
      removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => () => {
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
  }, []);

  const beginInput = useCallback((pointerId: number, clientX: number, clientY: number, button: number, touch: boolean) => {
    if (disabled || (button !== 0 && button !== 1)) return false;
    if (touch) {
      pointers.current.set(pointerId, { x: clientX, y: clientY });
      if (pointers.current.size >= 2) {
        startPinch();
        return true;
      }
    }
    const regionId = regionAt(clientX, clientY);
    const pan = button === 1 || spacePressed.current || !regionId;
    if (pan && scaleRef.current <= 1) return false;
    gesture.current = {
      pointerId,
      mode: pan ? 'pan' : 'pending-paint',
      startX: clientX,
      startY: clientY,
      baseX: offset.x,
      baseY: offset.y,
      firstRegionId: regionId,
      seen: new Set(),
      queued: [],
    };
    return true;
  }, [disabled, offset, regionAt, startPinch]);

  const moveInput = useCallback((pointerId: number, clientX: number, clientY: number) => {
    if (pointers.current.has(pointerId)) {
      pointers.current.set(pointerId, { x: clientX, y: clientY });
    }
    const activePinch = pinch.current;
    if (activePinch && pointers.current.size >= 2) {
      const [first, second] = pinchPoints();
      const nextScale = clamp(
        activePinch.startScale * Math.hypot(second.x - first.x, second.y - first.y) / activePinch.startDistance,
        1,
        12,
      );
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const viewport = viewportRef.current?.getBoundingClientRect();
      const viewportCenterX = (viewport?.left ?? 0) + (viewport?.width ?? 0) / 2;
      const viewportCenterY = (viewport?.top ?? 0) + (viewport?.height ?? 0) / 2;
      const contentX = (activePinch.startCenterX - viewportCenterX - activePinch.baseX) / activePinch.startScale;
      const contentY = (activePinch.startCenterY - viewportCenterY - activePinch.baseY) / activePinch.startScale;
      scaleRef.current = nextScale;
      setScale(nextScale);
      setBoundOffset({
        x: centerX - viewportCenterX - contentX * nextScale,
        y: centerY - viewportCenterY - contentY * nextScale,
      }, nextScale);
      return true;
    }
    const active = gesture.current;
    if (!active || active.pointerId !== pointerId) return false;
    const dx = clientX - active.startX;
    const dy = clientY - active.startY;
    if (active.mode === 'pan') {
      setTransitioning(false);
      setBoundOffset({ x: active.baseX + dx, y: active.baseY + dy });
      return true;
    }
    if (active.mode === 'pending-paint' && Math.hypot(dx, dy) > 6) {
      active.mode = 'paint';
      queueRegion(active.firstRegionId);
    }
    if (active.mode === 'paint') queueRegion(regionAt(clientX, clientY));
    return true;
  }, [queueRegion, regionAt, setBoundOffset]);

  const finishInput = useCallback((pointerId: number, clientX: number, clientY: number, cancelled = false) => {
    const wasPinching = Boolean(pinch.current);
    pointers.current.delete(pointerId);
    if (wasPinching) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    const active = gesture.current;
    if (!active || active.pointerId !== pointerId) return;
    if (active.mode === 'paint') {
      if (!cancelled) queueRegion(regionAt(clientX, clientY));
      flushPaint();
    } else if (!cancelled && active.mode === 'pending-paint' && active.firstRegionId) {
      onTap(active.firstRegionId);
    }
    gesture.current = null;
  }, [flushPaint, onTap, queueRegion, regionAt]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasPointerEvents() || (event.pointerType !== 'touch' && !event.isPrimary)) return;
    const handled = beginInput(event.pointerId, event.clientX, event.clientY, event.button, event.pointerType === 'touch');
    if (!handled && event.pointerType !== 'touch') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [beginInput]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasPointerEvents()) return;
    if (moveInput(event.pointerId, event.clientX, event.clientY)) event.preventDefault();
  }, [moveInput]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!hasPointerEvents()) return;
    finishInput(event.pointerId, event.clientX, event.clientY, cancelled);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [finishInput]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || hasPointerEvents()) return;
    const start = (event: TouchEvent) => {
      lastTouchAt.current = Date.now();
      let handled = false;
      for (const touch of Array.from(event.changedTouches)) {
        handled = beginInput(touch.identifier, touch.clientX, touch.clientY, 0, true) || handled;
      }
      if (handled) event.preventDefault();
    };
    const move = (event: TouchEvent) => {
      lastTouchAt.current = Date.now();
      let handled = false;
      for (const touch of Array.from(event.changedTouches)) {
        handled = moveInput(touch.identifier, touch.clientX, touch.clientY) || handled;
      }
      if (handled) event.preventDefault();
    };
    const finish = (event: TouchEvent, cancelled = false) => {
      lastTouchAt.current = Date.now();
      for (const touch of Array.from(event.changedTouches)) {
        finishInput(touch.identifier, touch.clientX, touch.clientY, cancelled);
      }
      event.preventDefault();
    };
    const cancel = (event: TouchEvent) => finish(event, true);
    viewport.addEventListener('touchstart', start, { passive: false });
    viewport.addEventListener('touchmove', move, { passive: false });
    viewport.addEventListener('touchend', finish, { passive: false });
    viewport.addEventListener('touchcancel', cancel, { passive: false });
    return () => {
      viewport.removeEventListener('touchstart', start);
      viewport.removeEventListener('touchmove', move);
      viewport.removeEventListener('touchend', finish);
      viewport.removeEventListener('touchcancel', cancel);
    };
  }, [beginInput, finishInput, moveInput]);

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (hasPointerEvents() || Date.now() - lastTouchAt.current < 700) return;
    if (beginInput(mousePointerId, event.clientX, event.clientY, event.button, false)) event.preventDefault();
  }, [beginInput]);

  const onMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!hasPointerEvents() && moveInput(mousePointerId, event.clientX, event.clientY)) event.preventDefault();
  }, [moveInput]);

  const finishMouse = useCallback((event: ReactMouseEvent<HTMLDivElement>, cancelled = false) => {
    if (hasPointerEvents()) return;
    finishInput(mousePointerId, event.clientX, event.clientY, cancelled);
  }, [finishInput]);

  return {
    viewportRef,
    transformRef,
    scale,
    transitioning,
    transformStyle: { transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` },
    zoomIn: () => changeScale(.5),
    zoomOut: () => changeScale(-.5),
    reset,
    focusPoint,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event),
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finishPointer(event, true),
      onMouseDown,
      onMouseMove,
      onMouseUp: (event: ReactMouseEvent<HTMLDivElement>) => finishMouse(event),
      onMouseLeave: (event: ReactMouseEvent<HTMLDivElement>) => finishMouse(event, true),
    },
  };
};
