import { useEffect, useRef, useState } from 'react';
import { Download, Film, Share2 } from 'lucide-react';
import { hasNativeBridge, layla, withTimeout } from './host';
import type { VideoConnection, VideoJob } from './video';
import { comfyVideoUrl } from './comfy';

/** Video messages share the story timeline, without entering narrator or script history. */
export function VideoClip({ job, input, connection, onAction, view, suspended = false }: {
  job: VideoJob; input?: string; connection: VideoConnection; suspended?: boolean;
  view: 'story' | 'manager';
  onAction: (job: VideoJob, action: 'cancel' | 'remove' | 'forget') => Promise<void>;
}) {
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [media, setMedia] = useState<{ url: string } | null>(null);
  const [error, setError] = useState(''), [working, setWorking] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '240px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (job.state !== 'completed' || !visible || suspended) return;
    setError('');
    try { setMedia({url:comfyVideoUrl(connection,job)}); } catch(err) { setError((err as Error).message); }
    // Native range requests stream long clips without buffering the whole MP4 in WebView RAM.
    return () => setMedia(null);
  }, [job.id, job.adventureId, job.state, connection.url, visible, retry, suspended]);
  async function act(fn: () => Promise<void>) {
    setWorking(true); setError('');
    try { await fn(); } catch (err) { setError((err as Error).message); }
    finally { setWorking(false); }
  }
  async function save(share = false) {
    if (!media) return;
    const response = await fetch(media.url,{signal:AbortSignal.timeout(120000),credentials:'omit'});
    if(!response.ok)throw new Error('The video could not be downloaded from ComfyUI.');
    const limit = hasNativeBridge() ? 64 : 256;
    if(Number(response.headers.get('Content-Length')) > limit*1024*1024)throw new Error(`Save clips over ${limit} MB from ComfyUI on your PC.`);
    const blob = await response.blob();
    if(blob.size > limit*1024*1024)throw new Error(`Save clips over ${limit} MB from ComfyUI on your PC.`);
    const filename = `wayfarer-${job.id}.mp4`, file = new File([blob], filename, { type: 'video/mp4' });
    if (share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Wayfarer scene' }); return; }
    if (hasNativeBridge()) {
      if (file.size > 64 * 1024 * 1024) throw new Error('Use the desktop output for clips over 64 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const result = await withTimeout(signal => layla.utils.saveFile(filename, data, true, { signal }), 60000);
      if (!result.success) throw new Error(result.message || 'Layla could not save the clip.');
    } else { const url=URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),60000); }
  }
  const terminal = ['completed', 'error', 'cancelled'].includes(job.state);
  const manage = view === 'manager';
  return <article ref={container} className="story-turn video-response" aria-label="Video response" data-video-id={job.id}>
    {manage && <div className="player-action"><span><Film size={16}/></span><p><strong className="action-kind">Video</strong>{input || 'A video of your story'}</p></div>}
    <div className={manage ? 'video-clip' : 'video-story-clip'}>
      {manage && <div className="video-clip-heading"><strong>{job.resolution ? `${job.resolution} · ${job.duration}s · 16:9` : 'Video request'}</strong><span className="eyebrow">{job.state}</span></div>}
      {job.state === 'completed' && <div className="video-screen">{media
        ? <video aria-label="Generated adventure video" controls playsInline preload="metadata" src={media.url} onError={()=>{setMedia(null);setError('The video could not be played. Check the PC connection or its ComfyUI output folder.');}} controlsList={manage ? undefined : 'nodownload noremoteplayback'} onContextMenu={manage ? undefined : event => event.preventDefault()}/>
        : <div className="video-placeholder"><Film size={28}/><span role="status">{error ? 'Video is ready on your desktop' : 'Loading your video…'}</span></div>}</div>}
      {(manage || job.state !== 'completed') && <p role="status">{job.message}</p>}
      {!terminal && job.progress && <progress value={job.progress.value} max={job.progress.max} aria-label="Video rendering progress"/>}
      {error && <p className="error" role="alert">{error}</p>}
      {!manage && (error || job.state === 'error') && <p className="subtle">Open Video settings to manage this clip.</p>}
      {manage && <div className="toolbar">
        {!terminal && <button className="button" disabled={working} onClick={() => void act(() => onAction(job, 'cancel'))}>Cancel clip</button>}
        {job.state === 'preparing' && <><p className="subtle">Check ComfyUI before clearing this record. Clearing tracking does not cancel a render.</p><button className="text-button" disabled={working} onClick={() => void act(() => onAction(job, 'forget'))}>Clear unconfirmed clip</button></>}
        {job.state === 'completed' && !media && error && <button className="button" onClick={() => setRetry(value => value + 1)}>Retry video playback</button>}
        {media && <><button className="button" disabled={working} onClick={() => void act(() => save())}><Download size={16}/>Save video</button><button className="button" disabled={working} onClick={() => void act(() => save(true))}><Share2 size={16}/>Share / save</button></>}
        {terminal && <button className="text-button" disabled={working} onClick={() => void act(() => onAction(job, 'remove'))}>Remove clip</button>}
      </div>}
    </div>
  </article>;
}
