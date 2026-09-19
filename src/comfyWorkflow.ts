import template from './workflows/hermes-fasth3.json';

export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export interface ComfyScene { id: string; adventureId: string; prompt: string; resolution: '480p' | '720p'; duration: number; imageId?: string }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function videoId() {
  // Layla's file-origin WebView may not expose crypto.randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const s = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export function segmentDurations(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 225) throw new Error('Choose 1–225 whole seconds.');
  const count = Math.ceil(seconds / 15), base = Math.floor(seconds / count), extra = seconds % count;
  return Array.from({ length: count }, (_, i) => base + Number(i < extra));
}

/** One native ComfyUI job: encoded segments, last-frame guidance and final MP4. */
export function buildComfyWorkflow(scene: ComfyScene): Workflow {
  if (!uuidPattern.test(scene.id)) throw new Error('Invalid video identity.');
  if (typeof scene.prompt !== 'string' || !scene.prompt.trim() || scene.prompt.length > 12000) throw new Error('Enter a scene of 1–12,000 characters.');
  if (!['480p', '720p'].includes(scene.resolution)) throw new Error('Choose 480p or 720p.');
  const durations = segmentDurations(scene.duration);
  const graph: Workflow = {};
  // Keep the working Hermes model, patch, sigma shift, encoder, VAEs and eight-step sampler.
  for (const id of ['1','2','3','4','5','6','13','14']) graph[id] = structuredClone((template as Workflow)[id]);
  const [width, height] = scene.resolution === '720p' ? [1280,736] : [864,480];
  const [outWidth, outHeight] = scene.resolution === '720p' ? [1280,720] : [854,480];
  let guide: [string, number] | undefined;
  if (scene.imageId) {
    if (!/^wayfarer\/[\w.-]+$/.test(scene.imageId)) throw new Error('Upload the starting image again for this ComfyUI connection.');
    graph.start = { class_type:'LoadImage', inputs:{image:scene.imageId} };
    graph.startScale = { class_type:'ImageScale',inputs:{image:['start',0],upscale_method:'lanczos',width,height,crop:'center'} }; guide = ['startScale',0];
  }
  const videos: Record<string, unknown> = { codec:'h264' };
  durations.forEach((seconds, index) => {
    const prefix = `part${index}_`, ref = (name: string, port = 0) => [prefix + name, port];
    const node = (name: string, class_type: string, inputs: Record<string, unknown>) => { graph[prefix + name] = { class_type, inputs }; };
    const length = 5 + 17 * Math.ceil((Math.max(5, seconds) * 24 - 5) / 17);
    node('condition','MiniMaxH3ImageToVideo',{clip:['4',0],vae:['5',0],prompt:scene.prompt,width,height,length,...(guide ? {first_frame:guide} : {})});
    node('latent','EmptyMiniMaxH3LatentAV',{width,height,length});
    node('guider','BasicGuider',{model:['3',0],conditioning:ref('condition')});
    node('noise','RandomNoise',{noise_seed:crypto.getRandomValues(new Uint32Array(1))[0]});
    node('sample','SamplerCustomAdvanced',{noise:ref('noise'),guider:ref('guider'),sampler:['13',0],sigmas:['14',0],latent_image:ref('latent')});
    node('images','VAEDecode',{samples:ref('sample'),vae:['5',0]});
    node('audio','VAEDecodeAudio',{samples:ref('sample',1),vae:['6',0]});
    node('crop','ImageCrop',{image:ref('images'),width:outWidth,height:outHeight,x:Math.floor((width-outWidth)/2),y:Math.floor((height-outHeight)/2)});
    node('video','CreateVideo',{images:ref('crop'),audio:ref('audio'),fps:24});
    node('trim','Video Slice',{video:ref('video'),start_time:0,duration:seconds,strict_duration:true});
    // Encode each segment before the next render. Never concatenate full decoded frame batches.
    node('encoded','ConcatenateVideo',{'videos.video0':ref('trim'),codec:'h264'});
    videos[`videos.video${index}`] = ref('encoded');
    if (index < durations.length - 1) {
      node('last','Video Slice',{video:ref('encoded'),start_time:seconds - 1/24,duration:1/24,strict_duration:false});
      node('guide','GetVideoComponents',{video:ref('last')});
      guide = [prefix + 'guide',0];
    }
  });
  graph.join = { class_type:'ConcatenateVideo',inputs:videos };
  graph.save = { class_type:'SaveVideo',inputs:{video:['join',0],filename_prefix:`wayfarer/${scene.id}`,format:'mp4','format.codec':'h264','format.codec.encoding':'auto'} };
  return graph;
}
