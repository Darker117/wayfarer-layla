import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Compass, Mountain, Orbit, Moon, Sparkles } from 'lucide-react';
import type { Theme } from './domain';
export function Mark({ small = false }: { small?: boolean }) { return <span className={'brand-mark ' + (small ? 'small' : '')}><Compass size={small ? 21 : 29} strokeWidth={1.3}/></span>; }
export function Scene({ theme, className = '' }: { theme: Theme; className?: string }) {
  return <div className={`scene scene-${theme} ${className}`} aria-hidden="true">
    <div className="scene-stars"/><div className="scene-orb"/>
    <svg viewBox="0 0 600 280" preserveAspectRatio="xMidYMax slice"><path className="ridge-back" d="M0 190 65 115 104 159 160 90 250 182 311 121 403 200 482 104 600 201V300H0Z"/><path className="ridge-front" d="M0 240 98 194 176 231 287 161 408 239 497 191 600 222V300H0Z"/><path className="river" d="M300 170C450 214 204 220 300 285H390C180 223 479 219 300 170Z"/><g className="trees"><path d="m42 241 28-81 28 81H79v44H62v-44Zm65 20 21-63 22 63h-15v28h-13v-28Zm384-13 29-88 30 88h-21v40h-18v-40Zm-49 19 18-61 20 61h-13v21h-14v-21Z"/></g></svg>
    <span className="scene-emblem">{theme === 'ocean' ? <Orbit/> : theme === 'dusk' ? <Moon/> : theme === 'ember' ? <Sparkles/> : <Mountain/>}</span>
  </div>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = old; previous?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21}/></button></header>{children}</div></div>, document.body);
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) { return <div className="empty">{icon}<h2>{title}</h2><p>{text}</p>{children}</div>; }
export const timeAgo = (time: number) => { const d = Math.max(0, Date.now() - time); return d < 60000 ? 'Just now' : d < 3600000 ? `${Math.floor(d / 60000)} min ago` : d < 86400000 ? `${Math.floor(d / 3600000)} hr ago` : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
