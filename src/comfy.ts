import { buildComfyWorkflow, videoId, uuidPattern, type ComfyScene } from './comfyWorkflow';
import type { VideoConnection, VideoJob } from './video';

interface OutputFile { filename: string; subfolder: string; type: 'output' }
interface SavedJob extends VideoJob { output?: OutputFile; cancelWanted?: boolean }
const storeKey = (c: VideoConnection) => 'wayfarer-comfy-jobs-v1:' + c.url;
function readJobs(c: VideoConnection): SavedJob[] {
  const raw = localStorage.getItem(storeKey(c));
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Video records could not be opened. They have not been overwritten.');
  return value;
}
function saveJob(c: VideoConnection, job: SavedJob) {
  const jobs = readJobs(c), index = jobs.findIndex(j => j.id === job.id);
  if (index < 0) jobs.push(job); else jobs[index] = job;
  localStorage.setItem(storeKey(c), JSON.stringify(jobs));
}
function ownedJob(c: VideoConnection, id: string, adventureId: string) {
  const job = readJobs(c).find(j => j.id === id && j.adventureId === adventureId);
  if (!job || !uuidPattern.test(id)) throw new Error('This clip does not belong to this adventure and PC connection.');
  return job;
}
export class ComfyRejection extends Error {}
export async function comfyFetch(c: VideoConnection, path: string, options: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(c.url + path, { ...options, signal: options.signal ?? AbortSignal.timeout(20000), credentials:'omit' }); }
  catch (e) {
    if (options.signal?.aborted) throw e;
    throw new Error('ComfyUI could not be reached. Check that it is running, the PC address is correct, and ComfyUI allows connections from Layla.');
  }
  if (!response.ok) {
    let detail = `ComfyUI returned ${response.status}.`;
    try { const data = await response.json(); detail = typeof data.error === 'string' ? data.error : data.error?.message || detail;
      if (data.node_errors) detail += ' ' + Object.values(data.node_errors).flatMap((node: any) => (node.errors || []).map((e: any) => e.details || e.message)).join(' ').slice(0,1000);
    } catch { /* non-JSON response */ }
    if (response.status >= 400 && response.status < 500) throw new ComfyRejection(detail);
    throw new Error(detail);
  }
  return response;
}
const jsonPost = (body: unknown): RequestInit => ({ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
const requiredNodes = ['UNETLoader','MiniMaxH3MemoryEfficientSageAttentionPatch','MiniMaxH3SigmaShift','CLIPLoader','VAELoader','MiniMaxH3ImageToVideo','EmptyMiniMaxH3LatentAV','SamplerCustomAdvanced','VAEDecodeAudio','CreateVideo','Video Slice','ConcatenateVideo','GetVideoComponents','SaveVideo','ImageCrop'];
export async function checkComfy(c: VideoConnection, signal?: AbortSignal) {
  const stats = await (await comfyFetch(c,'/system_stats',{signal})).json();
  if (!stats?.system) throw new Error('This address is not a ComfyUI server. Enter the direct ComfyUI address.');
  const nodes = await (await comfyFetch(c,'/object_info',{signal})).json();
  const missing = requiredNodes.filter(name => !nodes[name]);
  if (missing.length) throw new Error('Update ComfyUI / install the Hermes workflow nodes. Missing: ' + missing.join(', '));
  // Check the exact installed workflow models before any costly AI planning or rendering.
  const choices = (name: string, input: string) => { const spec = nodes[name]?.input?.required?.[input]; return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options; };
  for (const [node,input,name] of [
    ['UNETLoader','unet_name','fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors'],
    ['CLIPLoader','clip_name','qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],
    ['VAELoader','vae_name','minimax_h3_video_vae_fp16.safetensors'],
    ['VAELoader','vae_name','minimax_h3_audio_vae_fp32.safetensors'],
  ]) { const available = choices(node,input); if (Array.isArray(available) && !available.includes(name)) throw new Error(`ComfyUI is missing the workflow model: ${name}`); }
  return stats;
}
export async function submitComfy(c: VideoConnection, scene: ComfyScene): Promise<SavedJob> {
  // ComfyUI accepts caller-supplied UUIDs but DOES NOT deduplicate repeated POSTs.
  // Persist before POST and reconcile uncertain responses using queue/history only.
  if (readJobs(c).some(j => j.id === scene.id)) throw new Error('This video was already submitted. Check its status; it has not been submitted twice.');
  const prompt = buildComfyWorkflow(scene), now = Date.now();
  const job: SavedJob = { id:scene.id,adventureId:scene.adventureId,resolution:scene.resolution,duration:scene.duration,createdAt:now,updatedAt:now,state:'preparing',message:'Confirming submission to ComfyUI…',submitted:false };
  saveJob(c,job);
  try {
    const response = await (await comfyFetch(c,'/prompt',jsonPost({prompt,prompt_id:scene.id,client_id:scene.id}))).json();
    if (response.prompt_id !== scene.id) throw new Error('ComfyUI did not keep the request identity. Update ComfyUI before sending another video.');
    const current = ownedJob(c,scene.id,scene.adventureId);
    Object.assign(current,{submitted:true,state:'queued',message:'Queued on your desktop',updatedAt:Date.now()}); saveJob(c,current);
    if (current.cancelWanted) return cancelComfy(c,current.id,current.adventureId);
    return current;
  } catch (e) {
    if (e instanceof ComfyRejection) { job.state='error'; job.message=e.message; saveJob(c,job); }
    throw e;
  }
}
function outputFile(value: any, id: string): OutputFile | undefined {
  if (value?.type !== 'output' || value.subfolder !== 'wayfarer' || typeof value.filename !== 'string' || !value.filename.startsWith(id + '_') || !/^[\w.-]+\.mp4$/i.test(value.filename)) return;
  return { filename:value.filename,subfolder:value.subfolder,type:'output' };
}
export async function listComfy(c: VideoConnection, adventureId: string): Promise<SavedJob[]> {
  const jobs = readJobs(c).filter(j => j.adventureId === adventureId);
  if (!jobs.some(j => !['completed','error','cancelled'].includes(j.state))) return jobs;
  const queue = await (await comfyFetch(c,'/queue')).json();
  for (const old of jobs) {
    if (['completed','error','cancelled'].includes(old.state)) continue;
    const histories = await (await comfyFetch(c,'/history/' + old.id)).json(), h = histories[old.id];
    // Reread after the await so a cancellation cannot be overwritten by an earlier poll.
    const job = ownedJob(c,old.id,adventureId);
    if (['completed','error','cancelled'].includes(job.state)) continue;
    const running = queue.queue_running?.some((row: any[]) => row[1] === job.id), waiting = queue.queue_pending?.some((row: any[]) => row[1] === job.id);
    if (h) {
      job.submitted=true;
      const files = h.outputs?.save?.images || h.outputs?.save?.videos || h.outputs?.save?.gifs || [];
      const file = files.map((f: any) => outputFile(f,job.id)).find(Boolean);
      const messages = h.status?.messages || [];
      if (file) { job.output=file; job.state='completed'; job.message='Your video is ready'; }
      else if (messages.some((m: any[]) => m[0] === 'execution_interrupted')) { job.state='cancelled'; job.message='Cancelled'; }
      else if (h.status?.status_str === 'error') { job.state='error'; job.message='ComfyUI could not finish this clip. ' + (messages.find((m: any[]) => m[0] === 'execution_error')?.[1]?.exception_message || 'Check the ComfyUI console.'); }
      else if (h.status?.completed) { job.state='error'; job.message='ComfyUI finished without a playable MP4. Check its output folder.'; }
    } else if (running || waiting) {
      job.submitted=true; job.state=running?'sampling':'queued'; job.message=running?'Rendering on your desktop…':'Queued on your desktop';
    } else {
      // A server restart can remove both queue and history. Never regenerate automatically.
      job.state='preparing'; job.message=job.cancelWanted?'Cancellation not yet confirmed. Check the ComfyUI queue.':'Request not found in ComfyUI. It may still be arriving, or the PC restarted. Check its queue before clearing this record.';
    }
    job.updatedAt=Date.now(); saveJob(c,job);
    if (job.cancelWanted && (running || waiting) && !['completed','error','cancelled'].includes(job.state)) await cancelComfy(c,job.id,adventureId);
  }
  return readJobs(c).filter(j => j.adventureId === adventureId);
}
export async function cancelComfy(c: VideoConnection, id: string, adventureId: string) {
  let job = ownedJob(c,id,adventureId);
  if (['completed','error','cancelled'].includes(job.state)) return job;
  job.cancelWanted=true; job.message='Requesting cancellation…'; saveJob(c,job);
  const result = await (await comfyFetch(c,`/api/jobs/${id}/cancel`,jsonPost({}))).json();
  job = ownedJob(c,id,adventureId);
  if (['completed','error','cancelled'].includes(job.state)) return job;
  // This endpoint targets this exact job, never another ComfyUI user's generation.
  if (result.cancelled) { job.state='cancelled'; job.submitted=true; job.message='Cancelled'; }
  else job.message='Cancellation not yet confirmed. Checking ComfyUI…';
  saveJob(c,job); return job;
}
export async function removeComfy(c: VideoConnection, id: string, adventureId: string) {
  const job = ownedJob(c,id,adventureId);
  if (!['completed','error','cancelled'].includes(job.state)) throw new Error('Cancel this clip before removing it.');
  // Standard ComfyUI can delete history, but has no output-file deletion endpoint.
  await comfyFetch(c,'/history',jsonPost({delete:[id]}));
  localStorage.setItem(storeKey(c),JSON.stringify(readJobs(c).filter(j => j.id !== id)));
}
export async function forgetUnconfirmed(c: VideoConnection, id: string, adventureId: string) {
  await listComfy(c,adventureId);
  if (!readJobs(c).some(j => j.id === id && j.adventureId === adventureId)) return;
  const job = ownedJob(c,id,adventureId);
  if (job.state !== 'preparing') throw new Error('ComfyUI found this request. Manage the clip below.');
  job.state='error'; job.message='Tracking cleared on this device. This does not cancel a request that reaches ComfyUI later.'; saveJob(c,job);
}
export async function uploadComfy(c: VideoConnection, file: File) {
  const extension = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp' }[file.type];
  if (!extension || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP up to 10 MB.');
  const data = new FormData(); data.append('image',file,`${videoId()}.${extension}`); data.append('subfolder','wayfarer'); data.append('type','input');
  const result = await (await comfyFetch(c,'/upload/image',{method:'POST',body:data})).json();
  if (result.subfolder !== 'wayfarer' || !/^[\w.-]+$/.test(result.name) || result.type !== 'input') throw new Error('Unexpected image upload response from ComfyUI.');
  return 'wayfarer/' + result.name;
}
export function comfyVideoUrl(c: VideoConnection, job: VideoJob) {
  const saved = ownedJob(c,job.id,job.adventureId), file = saved.output && outputFile(saved.output,job.id);
  if (!file) throw new Error('No video file is available for this clip.');
  return c.url + '/view?' + new URLSearchParams({...file});
}
