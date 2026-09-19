import { randomInt } from 'node:crypto';

export const dimensions = { '480p': [864, 480], '720p': [1280, 736] };
export const maxDuration = 225;
export const frameCount = seconds => 5 + 17 * Math.ceil((Math.max(5,seconds) * 24 - 5) / 17);
export function segmentDurations(seconds) {
  const count=Math.ceil(seconds/15), base=Math.floor(seconds/count), extra=seconds%count;
  return Array.from({length:count},(_,i)=>base+(i<extra?1:0));
}
export const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
export function validateRequest(body) {
  if (!body || Object.keys(body).some(k => !['id', 'adventureId', 'prompt', 'resolution', 'duration', 'imageId'].includes(k))) throw new Error('Unknown request fields.');
  for (const k of ['id', 'adventureId']) if (typeof body[k] !== 'string' || !idPattern.test(body[k])) throw new Error('Invalid request identity.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) throw new Error('Scene prompt must contain 1–12,000 characters.');
  if (!Object.hasOwn(dimensions, body.resolution)) throw new Error('Choose 480p or 720p.');
  if (!Number.isInteger(body.duration) || body.duration < 1) throw new Error('Duration must be a positive whole number of seconds.');
  if (body.duration > maxDuration) throw new Error(`Choose up to ${maxDuration} seconds (3 minutes 45 seconds). Longer requests are not shortened automatically.`);
  if (body.imageId !== undefined && (typeof body.imageId !== 'string' || !idPattern.test(body.imageId))) throw new Error('Invalid starting image.');
  return body;
}
export function buildWorkflow(template, request, imageName) {
  validateRequest(request);
  if(request.duration>15) throw new Error('A workflow segment must be 15 seconds or shorter.');
  const graph = structuredClone(template);
  const expected = {1:'UNETLoader',2:'MiniMaxH3MemoryEfficientSageAttentionPatch',3:'MiniMaxH3SigmaShift',4:'CLIPLoader',5:'VAELoader',6:'VAELoader',7:'ResolutionSelector',9:'MiniMaxH3ImageToVideo',10:'EmptyMiniMaxH3LatentAV',11:'BasicGuider',12:'RandomNoise',13:'KSamplerSelect',14:'BasicScheduler',15:'SamplerCustomAdvanced',16:'VAEDecode',17:'VAEDecodeAudio',18:'CreateVideo',19:'SaveVideo'};
  if (Object.keys(graph).length !== Object.keys(expected).length || Object.entries(expected).some(([id, type]) => graph[id]?.class_type !== type)) throw new Error('The approved FastH3 workflow has changed.');
  const [width, height] = dimensions[request.resolution];
  for (const id of ['9', '10']) Object.assign(graph[id].inputs, { width, height, length: frameCount(request.duration) });
  graph['9'].inputs.prompt = request.prompt;
  delete graph['9'].inputs.first_frame;
  if (imageName) {
    graph['20'] = { class_type: 'LoadImage', inputs: { image: imageName } };
    graph['9'].inputs.first_frame = ['20', 0];
  }
  graph['12'].inputs.noise_seed = randomInt(0, 2 ** 48 - 1);
  graph['14'].inputs.steps = 8;
  graph['18'].inputs.fps = 24;
  graph['19'].inputs = { video: ['18', 0], filename_prefix: `wayfarer/${request.id}`, format: 'mp4', 'format.codec': 'h264', 'format.codec.encoding': 'auto' };
  return graph;
}
