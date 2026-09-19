import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Keep following explicit: new tokens must not reclaim a reader's scroll. */
export function useStoryScroll(story: RefObject<HTMLDivElement | null>, end: RefObject<HTMLDivElement | null>, composer: RefObject<HTMLDivElement | null>, active: boolean) {
  const following = useRef(true), readingThinking = useRef(false), generating = useRef(active);
  generating.current = active;
  const [layout, setLayout] = useState({ space: 260, top: 0, left: 0, visible: false });
  const actions = useRef({ jump: (_smooth: boolean) => {}, refresh: () => {} });

  useLayoutEffect(() => {
    let idle: number | undefined, frame = 0, jumping = false, lastY = window.scrollY;
    const viewport = window.visualViewport;
    const geometry = () => {
      const box = composer.current?.getBoundingClientRect();
      const visualTop = viewport?.offsetTop ?? 0;
      const visualBottom = visualTop + (viewport?.height ?? innerHeight);
      const bottom = Math.min(box?.top ?? visualBottom, visualBottom);
      const gap = (end.current?.getBoundingClientRect().bottom ?? bottom) - bottom + 24;
      return { box, gap, bottom, visualTop };
    };
    const update = () => {
      const { box, gap, bottom, visualTop } = geometry();
      const width = Math.min(box?.width ?? innerWidth, 688);
      const right = box ? box.left + (box.width + width) / 2 : innerWidth;
      const next = { space: Math.ceil(innerHeight - bottom + 24), top: bottom - 60, left: right - 60, visible: gap > 64 && bottom - visualTop > 160 };
      setLayout(old => Object.keys(next).every(k => old[k as keyof typeof old] === next[k as keyof typeof next]) ? old : next);
    };
    const scrollLatest = (smooth: boolean) => {
      const { gap } = geometry();
      window.scrollTo({ top: Math.max(0, window.scrollY + gap), behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
    };
    const settle = () => {
      clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (jumping) { jumping = false; scrollLatest(false); }
        update();
      }, 180);
    };
    const trackScroll = () => { update(); settle(); };
    const onScroll = () => {
      if (!jumping && window.scrollY < lastY - 1) following.current = false;
      if (!jumping && geometry().gap <= 64 && !readingThinking.current) following.current = true;
      lastY = window.scrollY;
      trackScroll();
    };
    const pause = () => { following.current = false; jumping = false; trackScroll(); };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pause(); else trackScroll(); };
    const onTouch = (event: TouchEvent) => { if ((event.target as Element).closest('.story-column')) pause(); };
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('input,textarea,select,[contenteditable]')) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause();
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        update();
        if (generating.current && following.current && !readingThinking.current && !jumping) scrollLatest(false);
      });
    };
    actions.current = {
      jump(smooth) { following.current = true; readingThinking.current = false; jumping = true; trackScroll(); scrollLatest(smooth); },
      refresh,
    };
    const observer = new ResizeObserver(refresh);
    if (story.current) observer.observe(story.current);
    if (composer.current) observer.observe(composer.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', refresh);
    viewport?.addEventListener('resize', refresh);
    viewport?.addEventListener('scroll', refresh);
    update();
    return () => {
      clearTimeout(idle); cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('scroll', onScroll); window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouch); window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', refresh);
      viewport?.removeEventListener('resize', refresh); viewport?.removeEventListener('scroll', refresh);
      actions.current = { jump: () => {}, refresh: () => {} };
    };
  }, [story, end, composer]);
  useLayoutEffect(() => { actions.current.refresh(); }, [active]);
  return {
    layout,
    jumpToLatest: () => actions.current.jump(true),
    beginFollowing: () => { following.current = true; readingThinking.current = false; },
    finishFollowing: () => { if (following.current && !readingThinking.current) actions.current.jump(false); },
    setReadingThinking: (expanded: boolean) => { readingThinking.current = expanded; following.current = !expanded; if (!expanded) actions.current.jump(false); },
  };
}
