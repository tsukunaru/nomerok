import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../services/levels.ts';

interface LazyThumbnailProps {
  readonly path: string;
  readonly alt: string;
  readonly fallback: string;
  readonly className: string;
  readonly eager?: boolean;
}

export const LazyThumbnail = ({ path, alt, fallback, className, eager = false }: LazyThumbnailProps) => {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setShouldLoad(eager);
    setLoaded(false);
    setFailed(false);
  }, [eager, path]);

  useEffect(() => {
    if (shouldLoad) return;
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: '320px' });
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <span className={`${className} thumbnail-frame ${loaded ? 'is-loaded' : ''} ${failed ? 'is-failed' : ''}`} ref={frameRef}>
      {!loaded && !failed && <span className="thumbnail-skeleton" aria-hidden="true" />}
      {shouldLoad && !failed && (
        <img
          src={assetUrl(path)}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {failed && <span className="thumbnail-fallback">{fallback}</span>}
    </span>
  );
};
