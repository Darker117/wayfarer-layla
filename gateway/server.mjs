import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { buildWorkflow, validateRequest, dimensions, idPattern, segmentDurations } from './workflow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['completed', 'error', 'cancelled']);
const fail = (status, message) => Object.assign(new Error(message), { status });
const boundedText = async (req, limit) => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'Request is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
};
const jsonBody = async req => { try { return JSON.parse((await boundedText(req, 20000)).toString()); } catch (e) { throw e.status ? e : fail(400, 'Invalid JSON.'); } };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const safeEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class MCP {
  constructor(python) {
    this.failed = false;
    this.pending = new Map();
    this.child = spawn(python, [join(here, 'mcp_client.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { const data = JSON.parse(line), p = this.pending.get(data.id); if (p) { clearTimeout(p.timer); this.pending.delete(data.id); data.error ? p.reject(new Error(data.error)) : p.resolve(data.result); } } catch { /* non-protocol output is never exposed */ }
    });
    const stop = () => { this.failed = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Local Comfy MCP is unavailable. Restart the gateway after checking its installation.')); } this.pending.clear(); };
    this.child.on('error', stop); this.child.on('exit', stop);
    this.child.stdin.on('error', stop);
  }
  call(name, args = {}) {
    if (this.failed) return Promise.reject(new Error('Local Comfy MCP is unavailable. Restart the gateway.'));
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Comfy MCP timed out. Check the desktop before retrying.')); }, 120000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, name, args }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Local Comfy MCP is unavailable.')); } });
    });
  }
  close() { this.child.kill(); }
}

export async function createGateway(options = {}) {
  const dataDir = options.dataDir ?? join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'WayfarerVideo');
  await mkdir(dataDir, { recursive: true });
  const statePath = join(dataDir, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Gateway state cannot be read. Restore its local state before starting.'); state = { clients: {}, jobs: {}, uploads: {} }; }
  const template = JSON.parse(await readFile(join(here, 'fasth3.json'), 'utf8'));
  const companionPage = await readFile(join(here, 'companion.html'), 'utf8');
  state.pairingCodes ??= {};
  let persistence = Promise.resolve();
  const save = () => { const snapshot = JSON.stringify(state); persistence = persistence.then(async () => { await writeFile(statePath + '.tmp', snapshot, { mode: 0o600 }); await rename(statePath + '.tmp', statePath); }); return persistence; };
  const comfy = options.comfyUrl || 'http://127.0.0.1:8188';
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(comfy)) throw new Error('ComfyUI must remain loopback-only.');
  const mcp = options.mcp ?? new MCP(process.env.WAYFARER_MCP_PYTHON || join(process.env.LOCALAPPDATA || '', 'comfy-mcp-tools', 'Scripts', 'python.exe'));
  const ffmpeg = options.ffmpeg || process.env.WAYFARER_FFMPEG || 'ffmpeg';
  const ffprobe = options.ffprobe || process.env.WAYFARER_FFPROBE || 'ffprobe';
  let ready = false, starting, closed = false;
  const running = new Set(), children = new Map(), failures = new Map();
  const origins = new Set(options.origins ?? (process.env.WAYFARER_ORIGINS || 'null,http://127.0.0.1:5173,http://localhost:5173').split(','));
  const request = async (path, opts = {}) => {
    const response = await fetch(comfy + path, { ...opts, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('ComfyUI request failed.');
    return response;
  };
  const initialize = async () => {
    if (ready) return;
    if (starting) return starting;
    starting = (async () => {
      const info = await mcp.call('server_info');
      if (!info.server?.running || info.server.url.replace(/\/$/, '') !== comfy || (info.comfy_target?.host && !['127.0.0.1', 'localhost'].includes(info.comfy_target.host))) throw new Error('Comfy MCP must target the running local ComfyUI.');
      ready = true;
    })().finally(() => { starting = null; });
    return starting;
  };
  const publicJob = job => ({ id: job.id, adventureId: job.adventureId, state: job.state, resolution: job.resolution, duration: job.duration, createdAt: job.createdAt, updatedAt: job.updatedAt, progress: job.progress, message: job.message, segment: (job.segmentIndex || 0)+1, segments: job.segments?.length || 1 });
  const update = async (job, values) => { if (job.cancelRequested && values.state !== 'cancelled') return; if (terminal.has(job.state) && values.state !== job.state) return; Object.assign(job, values, { updatedAt: Date.now() }); await save(); };
  const command = (job, program, args) => new Promise((resolve, reject) => {
    if (job.cancelRequested || job.state === 'cancelled') return reject(new Error('Cancelled'));
    const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer=setTimeout(()=>{child.kill();reject(new Error('Media processing timed out.'));},300000);timer.unref();
    let output = ''; children.set(job.id, child);
    child.stdout.on('data', x => { if (output.length < 50000) output += x; });
    child.on('error', () => {clearTimeout(timer);reject(new Error('FFmpeg tools are unavailable. Check the desktop installation.'));});
    child.on('close', code => { clearTimeout(timer); children.delete(job.id); code === 0 ? resolve(output) : reject(new Error('Video or image processing failed.')); });
  });
  const segment = job => job.segments[job.segmentIndex || 0];
  const segmentLabel = job => `Part ${(job.segmentIndex || 0)+1} of ${job.segments.length}`;
  async function prepareImage(job) {
    let source, seek=[];
    if (job.segmentIndex > 0) {
      source=join(dataDir,job.segments[job.segmentIndex-1].file); seek=['-sseof','-1'];
    } else {
      if (!job.imageId) return undefined;
      const upload=state.uploads[job.imageId];
      if (!upload || upload.owner!==job.owner || upload.adventureId!==job.adventureId) throw new Error('Starting image expired; choose it again.');
      source=join(dataDir,upload.file);
    }
    const part=segment(job), [w,h]=dimensions[job.resolution], output=join(dataDir,part.id+'.png');
    const frameArgs=job.segmentIndex>0?['-update','1']:['-frames:v','1'];
    await command(job,ffmpeg,['-v','error','-y',...seek,'-i',source,...frameArgs,'-vf',`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,output]);
    if((await stat(output)).size===0)throw new Error('No starting frame was decoded.');
    if(job.cancelRequested)return;
    const form=new FormData();form.set('image',new Blob([await readFile(output)],{type:'image/png'}),`${part.id}.png`);form.set('subfolder','wayfarer');form.set('overwrite','false');
    const result=await(await request('/upload/image',{method:'POST',body:form})).json();
    await unlink(output).catch(()=>{});
    return `${result.subfolder?result.subfolder+'/':''}${result.name}`;
  }
  async function verifyOutput(job,file,duration) {
    const probe=JSON.parse(await command(job,ffprobe,['-v','error','-show_streams','-show_format','-of','json',file]));
    const video=probe.streams.find(x=>x.codec_type==='video'),audio=probe.streams.find(x=>x.codec_type==='audio');
    if(Math.abs(Number(probe.format.duration)-duration)>.15 || video?.codec_name!=='h264' || video?.display_aspect_ratio!=='16:9' || !audio)throw new Error('Output failed duration, audio or display checks.');
  }
  async function assemble(job) {
    if(job.cancelRequested)return;
    await update(job,{state:'encoding',message:'Joining generated segments and audio…',progress:undefined});
    const list=join(dataDir,job.id+'-concat.txt'),output=join(dataDir,job.id+'.mp4');
    await writeFile(list,job.segments.map(p=>`file '${p.file}'`).join('\n'));
    await command(job,ffmpeg,['-v','error','-y','-f','concat','-safe','1','-i',list,'-t',String(job.duration),'-map','0:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-af','aresample=async=1:first_pts=0','-movflags','+faststart',output]);
    await verifyOutput(job,output,job.duration);
    if(!job.cancelRequested){delete job.prompt;await update(job,{state:'completed',message:'Ready to play · H.264 with audio',output:job.id+'.mp4'});}
    await unlink(list).catch(()=>{});
  }
  async function encode(job,history) {
    if(job.cancelRequested || job.state==='cancelled' || running.has(job.id))return;
    running.add(job.id);let next=false;
    try {
      const part=segment(job);
      await update(job,{state:'encoding',progress:undefined,message:segmentLabel(job)+' · encoding video and audio…'});
      if(job.cancelRequested)return;
      const output=history.outputs?.['19'];
      const media=[...(output?.images||[]),...(output?.gifs||[]),...(output?.videos||[])].find(x=>x.filename?.endsWith('.mp4')&&x.type==='output');
      if(!media || media.subfolder!=='wayfarer' || !media.filename.startsWith(part.id+'_') || !/^[\w.-]+$/.test(media.filename))throw new Error('Owned workflow did not return a video.');
      const response=await request('/view?'+new URLSearchParams({filename:media.filename,subfolder:media.subfolder,type:'output'}));
      if(Number(response.headers.get('content-length')||0)>512*1024*1024)throw new Error('Source exceeds gateway size limit.');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>512*1024*1024)throw new Error('Source too large.');chunks.push(Buffer.from(chunk));}
      if(job.cancelRequested)return;
      const source=join(dataDir,part.id+'-source.mp4'),file=part.id+'-part.mp4',outputFile=join(dataDir,file);
      await writeFile(source,Buffer.concat(chunks));
      const filter=job.resolution==='720p'?'crop=1280:720,setsar=1':'crop=852:480,setsar=640/639:max=10000';
      await command(job,ffmpeg,['-v','error','-y','-i',source,'-t',String(part.duration),'-vf',filter,'-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',outputFile]);
      await unlink(source).catch(()=>{});await verifyOutput(job,outputFile,part.duration);
      if(job.cancelRequested)return;
      Object.assign(part,{file,state:'completed',promptId:job.promptId,clientId:job.clientId});
      if(job.segmentIndex+1 < job.segments.length){
        job.segmentIndex++;delete job.promptId;delete job.clientId;
        sockets.get(job.id)?.close();sockets.delete(job.id);
        await update(job,{state:'preparing',message:segmentLabel(job)+' · continuing from the previous frame…'});next=true;
      } else {await save();await assemble(job);}
    }catch{if(!job.cancelRequested)await update(job,{state:'error',message:'Video export failed. Retry export to reuse the finished source, or check FFmpeg on the desktop.'});}
    finally{running.delete(job.id);}
    if(next && !job.cancelRequested && !closed)void submit(job);
  }
  async function submit(job) {
    try {
      await initialize();
      const imageName = await prepareImage(job);
      if (job.cancelRequested || job.state === 'cancelled') return;
      const part=segment(job);
      const graph = buildWorkflow(template, { id: part.id, adventureId: job.adventureId, prompt:job.prompt, resolution: job.resolution, duration: part.duration, ...(job.imageId ? { imageId: job.imageId } : {}) }, imageName);
      if(job.segmentIndex>0)graph['9'].inputs.prompt+='\nContinue the visible scene from the supplied starting frame. Maintain subject appearance, setting, camera direction and motion. No title cards or scene reset.';
      const path = join(dataDir, part.id + '.json'); await writeFile(path, JSON.stringify(graph));
      const verdict = await mcp.call('validate_workflow', { workflow_path: path });
      if (verdict.valid !== true) throw new Error('Workflow validation failed. Check required FastH3 models and nodes.');
      if (job.cancelRequested || job.state === 'cancelled') return;
      await update(job, { state: 'preparing', message: 'Submitting to local ComfyUI…', submitting: true });
      if (job.cancelRequested || job.state === 'cancelled') return;
      const result = await mcp.call('run_workflow', { workflow_path: path, wait: false });
      if (typeof result.prompt_id !== 'string' || !idPattern.test(result.prompt_id)) throw new Error('ComfyUI did not return a job ID. Check the desktop queue before retrying.');
      job.promptId = result.prompt_id; job.clientId = result.client_id; delete job.submitting;
      if (job.cancelRequested || job.state === 'cancelled') await cancel(job);
      else { await update(job, { state: 'queued', message: segmentLabel(job)+' · queued on your desktop' }); connectEvents(job); }
      await unlink(path).catch(() => {});
    } catch (e) { if (job.state !== 'cancelled') await update(job, { state: 'error', message: e.message.startsWith('Workflow validation') ? e.message : 'Local generation could not start. Check Comfy MCP, models and the desktop queue before retrying.' }); }
  }
  async function retryExport(id) {
    const job=state.jobs[id];
    if (!job || job.state !== 'error' || !job.promptId || job.cancelRequested) throw fail(409,'No finished source is available for export recovery.');
    const history=(await(await request('/history/'+encodeURIComponent(job.promptId))).json())[job.promptId];
    if (!history?.status?.completed || history.status.status_str !== 'success') throw fail(409,'ComfyUI has no completed source for this clip.');
    job.state='encoding'; await save(); await encode(job,history); return publicJob(job);
  }
  async function resumeIncomplete(id) {
    const job=state.jobs[id];
    if(!job || job.state!=='error' || job.promptId || job.submitting || !job.prompt || job.cancelRequested)throw fail(409,'This clip cannot be safely resumed. Check its desktop queue first.');
    job.state='preparing';job.message='Resuming the next unfinished segment…';await save();void submit(job);return publicJob(job);
  }
  async function cancel(job) {
    job.cancelRequested = true;
    children.get(job.id)?.kill();
    // This endpoint atomically targets exactly one Comfy job; never /interrupt.
    if (job.promptId && !terminal.has(job.state)) await request(`/api/jobs/${encodeURIComponent(job.promptId)}/cancel`, { method: 'POST' });
    else if (job.promptId && job.state === 'cancelled') await request(`/api/jobs/${encodeURIComponent(job.promptId)}/cancel`, { method: 'POST' });
    await update(job, { state: 'cancelled', message: 'Cancelled', progress: undefined });
  }
  async function poll() {
    if (closed) return;
    for (const job of Object.values(state.jobs)) {
      if (!job.promptId || terminal.has(job.state) || running.has(job.id)) continue;
      try {
        const history = (await (await request('/history/' + encodeURIComponent(job.promptId))).json())[job.promptId];
        if (history) {
          if (history.status?.status_str === 'error') await update(job, { state: 'error', message: 'ComfyUI generation failed. Check desktop memory and model diagnostics.' });
          else if (history.status?.completed) void encode(job, history);
        } else {
          const q = await (await request('/queue')).json();
          if (q.queue_running?.some(x => x[1] === job.promptId) && !['sampling', 'encoding'].includes(job.state)) await update(job, { state: 'preparing', message: 'ComfyUI is preparing or generating the clip…' });
          else if (!q.queue_running?.some(x => x[1] === job.promptId) && !q.queue_pending?.some(x => x[1] === job.promptId)) await update(job, { state: 'error', message: 'Job is no longer in ComfyUI. It may have been cancelled on the desktop.' });
        }
      } catch { /* transient network loss keeps persisted job reconnectable */ }
    }
  }
  const sockets = new Map();
  function connectEvents(owned) {
    if (closed || options.noEvents || !owned.clientId || terminal.has(owned.state) || sockets.has(owned.id)) return;
    const websocket = new WebSocket(comfy.replace('http:', 'ws:') + '/ws?clientId=' + encodeURIComponent(owned.clientId));
    sockets.set(owned.id,websocket);
    websocket.addEventListener('message', e => {
      if (typeof e.data !== 'string') return;
      try {
        const { type, data } = JSON.parse(e.data);
        const job = owned.promptId === data.prompt_id && !terminal.has(owned.state) ? owned : undefined;
        if (!job) return;
        if (type === 'progress') void update(job, { state: 'sampling', progress: { value: data.value, max: data.max }, message: segmentLabel(job)+' · rendering the scene…' });
        if (type === 'executing' && ['16','17','18','19'].includes(data.node)) void update(job, { state: 'encoding', progress: undefined, message: segmentLabel(job)+' · decoding video and audio…' });
      } catch { /* binary previews and unrelated events are not retained */ }
    });
    websocket.addEventListener('error', () => {});
    websocket.addEventListener('close', () => { if(sockets.get(owned.id)===websocket)sockets.delete(owned.id); if (!closed && !terminal.has(owned.state)) setTimeout(() => connectEvents(owned), 5000).unref(); });
  }
  for(const job of Object.values(state.jobs)){
    if(!job.segments && job.promptId){job.segments=[{id:job.id,duration:job.duration,state:'pending'}];job.segmentIndex=0;}
    if(!terminal.has(job.state) && !job.promptId){
      if(job.submitting || !job.prompt)await update(job,{state:'error',message:'Gateway restarted during submission. Check the desktop queue before trying again.'});
      else setTimeout(()=>{if(!closed && !job.cancelRequested)void submit(job);},100).unref();
    }
  }
  const interval = setInterval(() => { if (!poll.busy) { poll.busy = true; poll().finally(() => { poll.busy = false; }); } for (const [id, socket] of sockets) if (terminal.has(state.jobs[id]?.state) || !state.jobs[id]) socket.close(); }, options.pollIntervalMs || 2000); interval.unref();
  for (const job of Object.values(state.jobs)) connectEvents(job);
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return json(res, 403, { error: 'Origin is not allowed by the desktop gateway.' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Adventure-Id'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname;
      if (path === '/pair' && req.method === 'POST') {
        const now = Date.now(), key = req.socket.remoteAddress, attempts = (failures.get(key) || []).filter(t => t > now - 60000);
        if (attempts.length >= 5) throw fail(429, 'Wait a minute before pairing again.');
        attempts.push(now); failures.set(key, attempts);
        const body = await jsonBody(req);
        const pairing = Object.values(state.pairingCodes).find(item => safeEqual(body.code, item.code));
        if (!pairing || (pairing.expires !== null && pairing.expires <= now)) throw fail(401, 'Connection code is incorrect, expired or deleted.');
        const token = randomBytes(32).toString('base64url'), owner = hash(token);
        state.clients[owner] = { createdAt: now, codeId: pairing.id }; await save(); return json(res, 200, { token });
      }
      const auth = req.headers.authorization || '', owner = hash(auth.startsWith('Bearer ') ? auth.slice(7) : '');
      if (!state.clients[owner]) throw fail(401, 'Pair this device with the desktop gateway.');
      if (path === '/connection' && req.method === 'DELETE') { delete state.clients[owner]; await save(); return json(res, 200, { disconnected: true }); }
      if (path === '/health' && req.method === 'GET') {
        await initialize(); await request('/system_stats');
        return json(res, 200, { ok: true, model: 'Local FastH3 · 8 steps', resolutions: ['480p','720p'], duration: { min:1,max:225,step:1 }, segmentSeconds:15, strategy:'Sequential generated segments with last-frame guidance. Joins may be visible or audible.' });
      }
      if (path === '/uploads' && req.method === 'POST') {
        const adventureId = req.headers['x-adventure-id'];
        if (!idPattern.test(adventureId || '') || !['image/png','image/jpeg','image/webp'].includes(req.headers['content-type'])) throw fail(400, 'Choose a PNG, JPEG or WebP image.');
        if (Object.values(state.uploads).filter(x => x.owner === owner).length >= 30) throw fail(429, 'Remove unused starting images before adding more.');
        const bytes = await boundedText(req, 10 * 1024 * 1024);
        if (!(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.subarray(0,3).equals(Buffer.from([255,216,255])) || (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'))) throw fail(400, 'Image signature is invalid.');
        const id = randomUUID(), file = id + '.image'; await writeFile(join(dataDir,file), bytes);
        // Decode and bound dimensions before any workflow can consume uploaded content.
        try {
          const probe = JSON.parse(await command({ id }, ffprobe, ['-v','error','-show_streams','-of','json',join(dataDir,file)]));
          const s = probe.streams?.[0]; if (!s || !['png','mjpeg','webp'].includes(s.codec_name) || s.width * s.height > 24000000 || s.width < 16 || s.height < 16) throw new Error('Invalid image');
        } catch { await unlink(join(dataDir,file)).catch(()=>{});throw fail(400,'Choose a decodable PNG, JPEG or WebP between 16 pixels and 24 megapixels.'); }
        state.uploads[id] = { owner, adventureId, file, createdAt: Date.now() }; await save(); return json(res,201,{ id });
      }
      const uploadMatch = path.match(/^\/uploads\/([\w-]+)$/);
      if (uploadMatch && req.method === 'DELETE') {
        const item = state.uploads[uploadMatch[1]];
        if (!item || item.owner !== owner || item.adventureId !== req.headers['x-adventure-id']) throw fail(404,'Image not found.');
        if (Object.values(state.jobs).some(j => j.imageId === uploadMatch[1] && !terminal.has(j.state))) throw fail(409,'This starting image is in use.');
        await unlink(join(dataDir,item.file)).catch(() => {}); delete state.uploads[uploadMatch[1]]; await save(); return json(res,200,{ removed:true });
      }
      if (path === '/jobs' && req.method === 'POST') {
        let body; try { body = validateRequest(await jsonBody(req)); } catch (e) { throw fail(400,e.message); }
        const previous = state.jobs[body.id];
        if (previous) { if (previous.owner !== owner || previous.adventureId !== body.adventureId) throw fail(409,'Job identity is unavailable.'); return json(res,200,publicJob(previous)); }
        if (Object.values(state.jobs).filter(j => !terminal.has(j.state)).length >= 2) throw fail(429,'The gateway already has two active clips. Wait for one to finish.');
        if (Object.keys(state.jobs).length >= 200) throw fail(429,'Remove old clips before generating more.');
        if (body.imageId && (state.uploads[body.imageId]?.owner !== owner || state.uploads[body.imageId]?.adventureId !== body.adventureId)) throw fail(400,'Starting image does not belong to this adventure.');
        const job = { ...body, owner, segmentIndex:0, segments:segmentDurations(body.duration).map(duration=>({id:randomUUID(),duration,state:'pending'})), state: 'preparing', message: 'Preparing local workflow…', createdAt: Date.now(), updatedAt: Date.now() };
        state.jobs[job.id] = job; await save(); json(res,202,publicJob(job)); void submit(job); return;
      }
      if (path === '/jobs' && req.method === 'GET') return json(res,200,Object.values(state.jobs).filter(j => j.owner === owner && j.adventureId === url.searchParams.get('adventureId')).map(publicJob));
      const match = path.match(/^\/jobs\/([\w-]+)(?:\/(cancel|video|retry-export|resume))?$/);
      if (!match) throw fail(404,'Endpoint not found.');
      let job = state.jobs[match[1]];
      if (!job && match[2] === 'cancel' && req.method === 'POST' && idPattern.test(req.headers['x-adventure-id'] || '') && Object.keys(state.jobs).length < 200) {
        job = { id:match[1], owner, adventureId:req.headers['x-adventure-id'], state:'cancelled', cancelRequested:true, message:'Cancelled before submission', createdAt:Date.now(), updatedAt:Date.now() };
        state.jobs[job.id] = job; await save();
      }
      if (!job || job.owner !== owner || job.adventureId !== req.headers['x-adventure-id']) throw fail(404,'Clip not found in this adventure.');
      if (match[2] === 'cancel' && req.method === 'POST') { if (!terminal.has(job.state)) await cancel(job); return json(res,200,publicJob(job)); }
      if (match[2] === 'retry-export' && req.method === 'POST') { await retryExport(job.id); return json(res,200,publicJob(job)); }
      if (match[2] === 'resume' && req.method === 'POST') return json(res,200,await resumeIncomplete(job.id));
      if (match[2] === 'video' && req.method === 'GET') {
        if (job.state !== 'completed' || !job.output) throw fail(409,'Video is not ready.');
        const file = join(dataDir,job.output), size = (await stat(file)).size;
        res.writeHead(200,{ 'Content-Type':'video/mp4','Content-Length':size,'Content-Disposition':`attachment; filename="wayfarer-${job.id}.mp4"` }); createReadStream(file).pipe(res); return;
      }
      if (!match[2] && req.method === 'DELETE') {
        if (!terminal.has(job.state)) throw fail(409,'Cancel the clip before removing it.');
        for(const id of [job.id,...(job.segments||[]).map(p=>p.id)])for (const suffix of ['.mp4','-part.mp4','-source.mp4','.json','.png','-concat.txt']) await unlink(join(dataDir,id + suffix)).catch(() => {});
        delete state.jobs[job.id]; await save(); return json(res,200,{ removed:true });
      }
      if (!match[2] && req.method === 'GET') return json(res,200,publicJob(job));
      throw fail(404,'Endpoint not found.');
    } catch(e) { if (!res.headersSent) json(res,e.status || 503,{ error:e.status ? e.message : 'Desktop video service is unavailable. Check ComfyUI, MCP and FFmpeg on the desktop.' }); else res.destroy(); }
  };
  const server = http.createServer((req,res) => { void handler(req,res); }); server.requestTimeout = 30000; server.headersTimeout = 10000;
  const pairingHandler = async (req,res) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return json(res,403,{ error:'Use the local desktop pairing page.' });
    res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200,{ 'Content-Type':'text/html' }); return res.end(companionPage);
    }
    if (req.headers['x-wayfarer-local'] !== '1') return json(res,403,{error:'Open the PC Companion page to manage connection codes.'});
    if (req.url === '/codes' && req.method === 'GET') return json(res,200,Object.values(state.pairingCodes).map(item => ({...item, devices:Object.values(state.clients).filter(client=>client.codeId===item.id).length})));
    if (req.url === '/code' && req.method === 'POST') {
      const raw = await boundedText(req,2000);
      let body; try { body = raw.length ? JSON.parse(raw.toString()) : {}; } catch { throw fail(400,'Choose a valid code duration.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>key!=='durationMinutes')) throw fail(400,'Choose a valid code duration.');
      const minutes = body.durationMinutes ?? null;
      if (![null,10,20,30].includes(minutes)) throw fail(400,'Choose 10, 20 or 30 minutes, or Forever.');
      const createdAt=Date.now(), id=randomUUID();
      const item={id,code:randomBytes(9).toString('base64url'),createdAt,expires:minutes===null?null:createdAt+minutes*60000};
      state.pairingCodes[id]=item; await save(); return json(res,200,item);
    }
    const codeMatch=req.url?.match(/^\/codes\/([\w-]+)$/);
    if (codeMatch && req.method === 'DELETE') {
      if (!state.pairingCodes[codeMatch[1]]) throw fail(404,'Connection code was already deleted.');
      delete state.pairingCodes[codeMatch[1]];
      let disconnected=0;
      for(const [owner,client] of Object.entries(state.clients)) if(client.codeId===codeMatch[1]){delete state.clients[owner];disconnected++;}
      await save(); return json(res,200,{deleted:true,disconnected});
    }
    return json(res,404,{});
  };
  const pairingServer = http.createServer((req,res) => { void pairingHandler(req,res).catch(e => { if(!res.headersSent) json(res,e.status||503,{error:e.status?e.message:'The companion could not save your connection codes. Try again.'});else res.destroy(); }); });
  pairingServer.requestTimeout=10000; pairingServer.headersTimeout=10000;
  return { server, pairingServer, state, initialize, retryExport, resumeIncomplete, async close() { closed = true; clearInterval(interval); for (const socket of sockets.values()) socket.close(); server.closeAllConnections(); pairingServer.closeAllConnections(); await Promise.all([new Promise(r => server.close(r)),new Promise(r => pairingServer.close(r))]); mcp.close?.(); for (const p of children.values()) p.kill(); await persistence; } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = await createGateway();
  gateway.server.listen(8787,'127.0.0.1',() => console.log('Wayfarer PC Companion API: http://127.0.0.1:8787'));
  gateway.pairingServer.listen(8788,'127.0.0.1',() => console.log('Wayfarer PC Companion: http://127.0.0.1:8788'));
  const shutdown = () => gateway.close().then(() => process.exit(0)); process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
}
