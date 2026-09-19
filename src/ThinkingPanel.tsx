import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function ThinkingPanel({ text, busy, onExpandedChange }: { text: string; busy: boolean; onExpandedChange: (expanded: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId(), panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null), follow = useRef(true);
  useLayoutEffect(() => { if (expanded) panel.current?.scrollIntoView({ block: 'nearest' }); }, [expanded]);
  useLayoutEffect(() => {
    if (expanded && follow.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, expanded]);
  return <section ref={panel} className="thinking-panel" aria-label="Model thinking">
    <button type="button" className="thinking-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => { follow.current = true; setExpanded(!expanded); onExpandedChange(!expanded); }}>
      <ChevronDown size={16} className={expanded ? 'expanded' : ''}/>
      <span>{expanded ? 'Hide thinking' : 'Show thinking'}</span>
      <small>{busy ? 'Live' : 'Finished'}</small>
    </button>
    {expanded && <div id={id} className="thinking-body" ref={body} tabIndex={0} role="region" aria-label="Thinking from your Layla model" onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32; }}>
      <p className="thinking-caption">From your Layla model · available until you leave this story or start another turn.</p>
      <div>{text}</div>
    </div>}
  </section>;
}
