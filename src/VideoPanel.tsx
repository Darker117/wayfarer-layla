import { useEffect, useRef, useState } from 'react';
import { Film, Settings2, Download, Share2, X } from 'lucide-react';
import type { Adventure } from './domain';
import { uid } from './domain';
import { Field, Modal } from './ui';
import { hasNativeBridge, layla, withTimeout } from './host';
import { connectionUrl, prepareVideoPrompt, validateVideoDuration, readVideoConnection, readVideoPreferences, saveVideoConnection, saveVideoPreferences, videoPrompt, videoRequest, type VideoConnection, type VideoJob, type VideoPreferences } from './video';

export function useVideo(adventure: Adventure, draft: string, storyBusy: boolean) {
  const [open,setOpen] = useState(false), [prefs,setPrefs] = useState(() => readVideoPreferences(adventure.id));
  const [connection,setConnection] = useState(readVideoConnection), [jobs,setJobs] = useState<VideoJob[]>([]), [error,setError] = useState('');
  const [phase,setPhase] = useState(''), [enhancing,setEnhancing] = useState(false), [preview,setPreview] = useState('');
  const [uploading,setUploading] = useState(false), [connectionStatus,setConnectionStatus] = useState('');
  const [gatewayUrl,setGatewayUrl] = useState(connection?.url || ''), [code,setCode] = useState('');
  const lock = useRef(false), abort = useRef<AbortController | null>(null), alive = useRef(true), cancelled = useRef(false);
  const pendingKey = 'wayfarer-video-pending:' + adventure.id;
  const [pending,setPending] = useState(() => { try { const p=JSON.parse(localStorage.getItem(pendingKey)||'null'); return p?.body?.id ? p : null; } catch { return null; } });
  const pendingRef = useRef(pending); pendingRef.current = pending;
  function persistPending(value: typeof pending) { if(value) localStorage.setItem(pendingKey,JSON.stringify(value)); else localStorage.removeItem(pendingKey); pendingRef.current=value; setPending(value); }
  const [media,setMedia] = useState<{ id: string; blob: Blob; url: string } | null>(null);
  const [mediaBusy,setMediaBusy] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]);
  function changePrefs(value: Partial<VideoPreferences>) {
    const next = { ...prefs,...value }; setPrefs(next);
    try { saveVideoPreferences(adventure.id,next); } catch { setError('Video preferences could not be saved on this device.'); }
  }
  async function refresh(c = connection) {
    if (!c) return;
    const result = await videoRequest(c, '/jobs?adventureId=' + encodeURIComponent(adventure.id));
    const rows = await result.json() as VideoJob[];
    const p = pendingRef.current;
    if (p && !lock.current && rows.some(j=>j.id===p.body.id)) {
      if (p.cancel) await videoRequest(c,`/jobs/${p.body.id}/cancel`,{method:'POST'},adventure.id);
      persistPending(null);
    }
    if (alive.current) { setJobs(rows.sort((a,b) => b.createdAt - a.createdAt)); setConnectionStatus('Connected to your desktop'); }
  }
  useEffect(() => {
    if (!connection) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { await refresh(connection); } catch { if (!stopped) setConnectionStatus('Desktop unreachable · reconnecting…'); } if (!stopped) timer = setTimeout(tick,3000); };
    void tick(); return () => { stopped = true; clearTimeout(timer); };
  }, [connection, adventure.id]);
  async function start() {
    if (lock.current) return;
    setOpen(true); setError('');
    if (pendingRef.current) { await recoverPending(); return; }
    if (!draft.trim()) { setError('Write your video scene in the story composer first.'); return; }
    if (!connection) { setError('Pair the desktop gateway, then press Video again. Your draft is still in the composer.'); return; }
    if ((prefs.enhance || prefs.durationMode==='ai') && storyBusy) { setError('Wait for the story model to finish before enhancing a video prompt.'); return; }
    lock.current = true; cancelled.current = false;
    setEnhancing(prefs.enhance || prefs.durationMode==='ai');
    const controller = new AbortController(); abort.current = controller;
    try {
      setPhase('Checking desktop connection…');
      await videoRequest(connection,'/health',{ signal:controller.signal });
      let prompt = videoPrompt(draft,adventure,prefs), duration=prefs.duration; setPreview(prompt);
      if(prefs.durationMode==='manual') validateVideoDuration(duration);
      if (prefs.enhance || prefs.durationMode==='ai') {
        setEnhancing(true); setPhase(prefs.enhance ? 'Planning your video with Layla…' : 'Layla is choosing the scene length…');
        const plan = await prepareVideoPrompt(prompt,prefs,controller.signal); prompt=plan.prompt; duration=plan.duration;
        setEnhancing(false);
      }
      if (controller.signal.aborted) return;
      // The SDK model call is finished. Later clip cancellation must never abort a new story call.
      abort.current=null;
      setPreview(prompt); setPhase('Sending to your desktop…');
      const id = uid();
      // Persist identity before submission. Lost HTTP replies are recovered by listing owned jobs.
      const body = { id, adventureId:adventure.id, prompt, resolution:prefs.resolution, duration, ...(prefs.imageId ? { imageId:prefs.imageId } : {}) };
      persistPending({body,cancel:false,gatewayUrl:connection.url});
      const response = await videoRequest(connection,'/jobs',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
      const job = await response.json() as VideoJob;
      if (cancelled.current) await videoRequest(connection,`/jobs/${job.id}/cancel`,{ method:'POST' },adventure.id);
      persistPending(null);
      await refresh();
    } catch(e) {
      if (alive.current) setError(controller.signal.aborted ? 'Video preparation cancelled. Your draft is unchanged.' : (e as Error).message + ' Your draft is unchanged. If submission lost its connection, check the recovered clips before retrying.');
    } finally { if (alive.current) { setPhase(''); setEnhancing(false); } lock.current = false; abort.current = null; }
  }
  async function action(fn: () => Promise<void>) { setError(''); try { await fn(); } catch(e) { setError((e as Error).message); } }
  async function recoverPending() {
    if (!connection || !pendingRef.current || lock.current) return;
    lock.current=true; setPhase('Recovering the previous submission…');
    await action(async()=>{
      const p=pendingRef.current;
      if (p.gatewayUrl !== connection.url) throw new Error('Reconnect the desktop used for this pending submission.');
      if(p.cancel) await videoRequest(connection,`/jobs/${p.body.id}/cancel`,{method:'POST'},adventure.id);
      else await videoRequest(connection,'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p.body)});
      persistPending(null); await refresh();
    });
    lock.current=false; setPhase('');
  }
  async function cancelPreparation() {
    cancelled.current=true; abort.current?.abort();
    const p=pendingRef.current;
    if (p && connection) { persistPending({...p,cancel:true}); await action(async()=>{await videoRequest(connection,`/jobs/${p.body.id}/cancel`,{method:'POST'},adventure.id);persistPending(null);await refresh();}); }
  }
  async function pair() {
    await action(async () => {
      if (pendingRef.current || lock.current || active) throw new Error('Finish or cancel pending clips before changing the desktop connection.');
      const url = connectionUrl(gatewayUrl);
      const response = await fetch(url + '/pair',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.trim()}),signal:AbortSignal.timeout(15000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Pairing failed.');
      const next = { url,token:result.token }; saveVideoConnection(next); setConnection(next); setCode(''); setConnectionStatus('Paired with your desktop');
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!connection) { setError('Pair your desktop before uploading a starting image.'); return; }
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Choose a PNG, JPEG or WebP up to 10 MB.'); return; }
    setUploading(true);
    await action(async () => {
      const old = prefs.imageId;
      const result = await (await videoRequest(connection,'/uploads',{ method:'POST',headers:{'Content-Type':file.type},body:file },adventure.id)).json();
      changePrefs({ imageId:result.id,imageName:file.name });
      if (old) await videoRequest(connection,`/uploads/${old}`,{method:'DELETE'},adventure.id).catch(() => {});
    }); setUploading(false);
  }
  async function load(job: VideoJob) {
    if (!connection) return; setMediaBusy(true);
    await action(async () => {
      const response = await videoRequest(connection,`/jobs/${job.id}/video`,{signal:AbortSignal.timeout(120000)},adventure.id);
      if (Number(response.headers.get('Content-Length')) > 128 * 1024 * 1024) throw new Error('This clip is too large for mobile playback. Use the desktop gateway output.');
      const blob = await response.blob(); if (alive.current) setMedia({ id:job.id,blob,url:URL.createObjectURL(blob) });
    }); setMediaBusy(false);
  }
  async function saveMedia(share = false) {
    if (!media) return;
    await action(async () => {
      const filename = `wayfarer-${media.id}.mp4`, file = new File([media.blob],filename,{type:'video/mp4'});
      if (share && navigator.canShare?.({files:[file]})) { await navigator.share({files:[file],title:'Wayfarer scene'}); return; }
      if (hasNativeBridge()) {
        if (file.size > 64 * 1024 * 1024) throw new Error('Use the desktop output for clips over 64 MB.');
        const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
        const result = await withTimeout(signal => layla.utils.saveFile(filename,data,true,{signal}),60000);
        if (!result.success) throw new Error(result.message || 'Layla could not save the clip.');
      } else { const link = document.createElement('a'); link.href=media.url; link.download=filename; link.click(); }
    });
  }
  const active = jobs.some(j => !['completed','error','cancelled'].includes(j.state));
  let currentPreview = 'Write a scene in the composer first.';
  try { if(draft.trim()) currentPreview=videoPrompt(draft,adventure,prefs); } catch(e) { currentPreview=(e as Error).message; }
  return {
    enhancing, start, open, setOpen,
    button: <button type="button" className="video-action" disabled={!!phase || uploading || (storyBusy && (prefs.enhance || prefs.durationMode==='ai'))} onClick={() => void start()} title="Turn the composer text into a video"><Film size={15}/>Video</button>,
    settingsButton: <button type="button" aria-label="Video settings and clips" onClick={() => setOpen(true)}><Settings2 size={13}/>{phase ? 'Preparing video…' : active ? 'Video in progress' : 'Video settings'}</button>,
    panel: open && <Modal title="Video studio" wide onClose={() => setOpen(false)}><div className="form-body video-studio">
      <div className="video-intro"><span className="video-emblem"><Film size={25}/></span><div><span className="eyebrow">Your story, in motion</span><p>Write a scene in the composer and press Video. Clips render on your desktop while you keep exploring.</p></div></div>
      {phase && <div className="notice" role="status"><span className="pulse-dot"/>{phase}<button className="button" onClick={() => void cancelPreparation()}>Cancel video preparation</button></div>}
      {pending && !phase && <div className="notice">A previous submission needs recovery.<div className="toolbar"><button className="button" onClick={()=>void recoverPending()}>Recover submission</button><button className="button" onClick={()=>void cancelPreparation()}>Cancel pending submission</button></div></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="video-grid"><Field label="Resolution"><select value={prefs.resolution} disabled={!!phase} onChange={e=>changePrefs({resolution:e.target.value as VideoPreferences['resolution']})}><option>480p</option><option>720p</option></select></Field><Field label="Length"><select value={prefs.durationMode} disabled={!!phase} onChange={e=>changePrefs({durationMode:e.target.value as VideoPreferences['durationMode']})}><option value="manual">Manual</option><option value="ai">AI chosen</option></select></Field></div>
      <Field label="Duration in seconds" hint={prefs.durationMode==='ai'?'Layla chooses a length from the scene, even when enhancement is off.':'1–225 seconds · up to 3 minutes 45 seconds. Videos over 15 seconds use connected generated segments.'}>{prefs.durationMode==='manual'?<input type="number" min="1" step="1" value={prefs.duration || ''} disabled={!!phase} onChange={e=>changePrefs({duration:Number(e.target.value)})}/>:<p>Chosen length appears with the submitted clip.</p>}</Field>
      <label className="video-toggle"><input type="checkbox" checked={prefs.enhance} disabled={!!phase} onChange={e=>changePrefs({enhance:e.target.checked})}/><span><strong>Enhance with AI</strong><small>{prefs.enhance ? 'Layla refines your scene before rendering.' : 'Send your scene directly. No AI rewrite.'}</small></span></label>
      <label className="video-toggle"><input type="checkbox" checked={prefs.context} disabled={!!phase} onChange={e=>changePrefs({context:e.target.checked})}/><span><strong>Use public story context</strong><small>Private Think input and model reasoning are excluded.</small></span></label>
      {prefs.context && <Field label="Recent completed turns"><select value={prefs.turns} disabled={!!phase} onChange={e=>changePrefs({turns:Number(e.target.value) as VideoPreferences['turns']})}>{[1,3,6].map(n=><option key={n} value={n}>Last {n} {n===1?'turn':'turns'}</option>)}</select></Field>}
      <Field label="Video style" hint="Optional · saved for this adventure on this device"><textarea rows={2} maxLength={2000} value={prefs.style} disabled={!!phase} placeholder="Soft film grain, warm light, slow camera movement…" onChange={e=>changePrefs({style:e.target.value})}/></Field>
      <div className="video-image"><Field label="Starting image" hint="Optional · without an image, FastH3 generates from text"><input aria-label="Upload starting image" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading || !!phase} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></Field>{uploading && <span role="status">Uploading image…</span>}{prefs.imageId && <div className="toolbar"><span>{prefs.imageName}</span><button className="icon-button" aria-label="Remove starting image" disabled={!!phase || uploading} onClick={()=>void action(async()=>{if(connection) await videoRequest(connection,`/uploads/${prefs.imageId}`,{method:'DELETE'},adventure.id);changePrefs({imageId:undefined,imageName:undefined});})}><X size={16}/></button></div>}</div>
      <p className="subtle">16:9 · audio included. Longer clips and 720p need more time and memory; generation time varies. Segment joins may be visible or audible.</p>
      <details><summary>{preview ? 'Prompt sent / being prepared' : 'Preview current video prompt'}</summary><pre className="inspect video-prompt">{preview || currentPreview}</pre><p className="subtle">Edit the composer text or video settings before pressing Video.</p></details>
      <details open={!connection}><summary>Desktop connection</summary><p className="subtle">Start Wayfarer PC Companion on your PC, then create a connection code. Use your private Tailscale HTTPS address when connecting from your phone.</p><Field label="Gateway address"><input type="url" value={gatewayUrl} placeholder="https://your-desktop.your-tailnet.ts.net" onChange={e=>setGatewayUrl(e.target.value)}/></Field><Field label="Pairing code"><input type="password" autoComplete="off" value={code} onChange={e=>setCode(e.target.value)}/></Field><div className="toolbar"><button className="button" onClick={()=>void pair()}>Pair desktop</button>{connection && <><button className="button" onClick={()=>void action(async()=>{await videoRequest(connection,'/health');setConnectionStatus('Connected · local video gateway');})}>Test connection</button><button className="text-button" onClick={()=>void action(async()=>{if(pendingRef.current || lock.current || active)throw new Error('Finish or cancel pending clips before disconnecting.');await videoRequest(connection,'/connection',{method:'DELETE'});saveVideoConnection(null);setConnection(null);setJobs([]);setMedia(null);setConnectionStatus('Disconnected');})}>Disconnect</button></>}</div><p className="subtle" role="status">{connectionStatus}</p></details>
      <section className="video-clips"><h3>Adventure clips</h3>{!jobs.length && <p className="subtle">Your clips will appear here. Closing this panel does not stop a render.</p>}{jobs.map(job=><article className="video-clip" key={job.id}><div className="video-clip-heading"><strong>{job.resolution ? `${job.resolution} · ${job.duration}s` : 'Video request'}</strong><span className="eyebrow">{job.state}</span></div><p role="status">{job.message}</p>{job.progress && <progress value={job.progress.value} max={job.progress.max} aria-label="Video rendering progress"/>}<div className="toolbar">{!['completed','error','cancelled'].includes(job.state) && <button className="button" onClick={()=>void action(async()=>{if(connection) await videoRequest(connection,`/jobs/${job.id}/cancel`,{method:'POST'},adventure.id);await refresh();})}>Cancel clip</button>}{job.state==='error' && <><button className="button" onClick={()=>void action(async()=>{if(connection)await videoRequest(connection,`/jobs/${job.id}/resume`,{method:'POST'},adventure.id);await refresh();})}>Resume remaining parts</button><button className="button" onClick={()=>void action(async()=>{if(connection)await videoRequest(connection,`/jobs/${job.id}/retry-export`,{method:'POST',signal:AbortSignal.timeout(120000)},adventure.id);await refresh();})}>Retry export</button></>}{job.state==='completed' && <button className="button" disabled={mediaBusy} onClick={()=>void load(job)}>{mediaBusy ? 'Loading…' : 'Play clip'}</button>}{['completed','error','cancelled'].includes(job.state) && <button className="text-button" onClick={()=>void action(async()=>{if(connection) await videoRequest(connection,`/jobs/${job.id}`,{method:'DELETE'},adventure.id);if(media?.id===job.id)setMedia(null);await refresh();})}>Remove clip</button>}</div>{media?.id===job.id && <><video aria-label="Generated adventure video" controls playsInline src={media.url}/><div className="toolbar"><button className="button" onClick={()=>void saveMedia()}><Download size={16}/>Save video</button><button className="button" onClick={()=>void saveMedia(true)}><Share2 size={16}/>Share / save</button></div></>}</article>)}</section>
    </div></Modal>,
  };
}
