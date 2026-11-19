import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

interface ModalProps {
  open: boolean;
  title: string;
  closeLabel: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}

export const Modal = ({ open, title, closeLabel, children, className = '', onClose }: ModalProps) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') ?? []);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('keydown', closeOnEscape); if (previous?.isConnected) previous.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={closeLabel}><Icon name="close" /></button>
        </header>
        {children}
      </section>
    </div>
  );
};
