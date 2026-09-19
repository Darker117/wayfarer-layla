import { useEffect, useRef, useState } from 'react';
import { Download, Film, Share2 } from 'lucide-react';
import { hasNativeBridge, layla, withTimeout } from './host';
import { videoRequest, type VideoConnection, type VideoJob } from './video';

/** Video messages share the story timeline, without entering narrator or script history. */
export function VideoClip({ job, input, connection, onAction, view, suspended = false }: {
  job: VideoJob; input?: string; connection: VideoConnection; suspended?: boolean;
  view: 'story' | 'manager';
  onAction: (job: VideoJob, action: 'cancel' | 'resume' | 'retry-export' | 'remove') => Promise<void>;
}) {
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [media, setMedia] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState(''), [working, setWorking] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '240px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (job.state !== 'completed' || !visible || suspended) return;
    const controller = new AbortController();
    let url: string | undefined;
    setError('');
    void (async () => {
      try {
        const response = await videoRequest(connection, `/jobs/${job.id}/video`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
        }, job.adventureId);
        if (Number(response.headers.get('Content-Length')) > 128 * 1024 * 1024) throw new Error('This clip is too large for mobile playback. Use the desktop output.');
        const blob = await response.blob();
        if (blob.size > 128 * 1024 * 1024) throw new Error('This clip is too large for mobile playback. Use the desktop output.');
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setMedia({ blob, url });
      } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
    })();
    // Offscreen clips release their buffers; a long adventure must not retain every video in RAM.
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); setMedia(null); };
  }, [job.id, job.adventureId, job.state, connection.url, connection.token, visible, retry, suspended]);
  async function act(fn: () => Promise<void>) {
    setWorking(true); setError('');
    try { await fn(); } catch (err) { setError((err as Error).message); }
    finally { setWorking(false); }
  }
  async function save(share = false) {
    if (!media) return;
    const filename = `wayfarer-${job.id}.mp4`, file = new File([media.blob], filename, { type: 'video/mp4' });
    if (share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Wayfarer scene' }); return; }
    if (hasNativeBridge()) {
      if (file.size > 64 * 1024 * 1024) throw new Error('Use the desktop output for clips over 64 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const result = await withTimeout(signal => layla.utils.saveFile(filename, data, true, { signal }), 60000);
      if (!result.success) throw new Error(result.message || 'Layla could not save the clip.');
    } else { const link = document.createElement('a'); link.href = media.url; link.download = filename; link.click(); }
  }
  const terminal = ['completed', 'error', 'cancelled'].includes(job.state);
  const manage = view === 'manager';
  return <article ref={container} className="story-turn video-response" aria-label="Video response" data-video-id={job.id}>
    {manage && <div className="player-action"><span><Film size={16}/></span><p><strong className="action-kind">Video</strong>{input || 'A video of your story'}</p></div>}
    <div className={manage ? 'video-clip' : 'video-story-clip'}>
      {manage && <div className="video-clip-heading"><strong>{job.resolution ? `${job.resolution} · ${job.duration}s · 16:9` : 'Video request'}</strong><span className="eyebrow">{job.state}</span></div>}
      {job.state === 'completed' && <div className="video-screen">{media
        ? <video aria-label="Generated adventure video" controls playsInline preload="metadata" src={media.url} controlsList={manage ? undefined : 'nodownload noremoteplayback'} onContextMenu={manage ? undefined : event => event.preventDefault()}/>
        : <div className="video-placeholder"><Film size={28}/><span role="status">{error ? 'Video is ready on your desktop' : 'Loading your video…'}</span></div>}</div>}
      {(manage || job.state !== 'completed') && <p role="status">{job.message}</p>}
      {!terminal && job.progress && <progress value={job.progress.value} max={job.progress.max} aria-label="Video rendering progress"/>}
      {error && <p className="error" role="alert">{error}</p>}
      {!manage && (error || job.state === 'error') && <p className="subtle">Open Video settings to manage this clip.</p>}
      {manage && <div className="toolbar">
        {!terminal && <button className="button" disabled={working} onClick={() => void act(() => onAction(job, 'cancel'))}>Cancel clip</button>}
        {job.state === 'error' && <><button className="button" disabled={working} onClick={() => void act(() => onAction(job, 'resume'))}>Resume remaining parts</button><button className="button" disabled={working} onClick={() => void act(() => onAction(job, 'retry-export'))}>Retry export</button></>}
        {job.state === 'completed' && !media && error && <button className="button" onClick={() => setRetry(value => value + 1)}>Retry video playback</button>}
        {media && <><button className="button" disabled={working} onClick={() => void act(() => save())}><Download size={16}/>Save video</button><button className="button" disabled={working} onClick={() => void act(() => save(true))}><Share2 size={16}/>Share / save</button></>}
        {terminal && <button className="text-button" disabled={working} onClick={() => void act(() => onAction(job, 'remove'))}>Remove clip</button>}
      </div>}
    </div>
  </article>;
}
