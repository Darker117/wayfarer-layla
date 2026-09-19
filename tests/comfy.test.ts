import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildComfyWorkflow, segmentDurations, videoId } from '../src/comfyWorkflow';
import { cancelComfy, listComfy, removeComfy, submitComfy, comfyVideoUrl, forgetUnconfirmed } from '../src/comfy';

const connection = {url:'http://127.0.0.1:8188'};
const scene = () => ({id:videoId(),adventureId:'test-adventure',prompt:'A paper boat on a lake.',duration:30,resolution:'480p' as const});
let fetcher: ReturnType<typeof vi.fn>;
const response = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
});
afterEach(()=>vi.unstubAllGlobals());

describe('native ComfyUI workflow',()=>{
  it('covers every whole duration through 225 seconds without truncation',()=>{
    for(let duration=1;duration<=225;duration++){
      const segments=segmentDurations(duration);
      expect(segments.reduce((a,b)=>a+b,0)).toBe(duration);
      expect(segments.every(s=>s<=15 && s>=1)).toBe(true);
      const graph=buildComfyWorkflow({...scene(),duration});
      expect(graph['14'].inputs.steps).toBe(8);
      expect(Object.keys(graph.join.inputs).filter(k=>k.startsWith('videos.video'))).toHaveLength(segments.length);
      for(let i=1;i<segments.length;i++) expect(graph[`part${i}_condition`].inputs.first_frame).toEqual([`part${i-1}_guide`,0]);
      for(const node of Object.values(graph))for(const value of Object.values(node.inputs))if(Array.isArray(value))expect(graph[value[0]]).toBeDefined();
    }
    for(const n of [0,226,1.5])expect(()=>segmentDurations(n)).toThrow();
  });
  it('keeps the approved model and only uses an uploaded image from ComfyUI',()=>{
    const graph=buildComfyWorkflow({...scene(),resolution:'720p',imageId:'wayfarer/boat.png'});
    expect(graph['1'].inputs.unet_name).toBe('fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors');
    expect(graph.part0_condition.inputs.first_frame).toEqual(['startScale',0]);
    expect(graph.part0_crop.inputs).toMatchObject({width:1280,height:720});
    expect(graph.part0_encoded.class_type).toBe('ConcatenateVideo');
    expect(()=>buildComfyWorkflow({...scene(),imageId:'../../private.png'})).toThrow();
  });
});
describe('direct submission and recovery',()=>{
  it('sends to /prompt with a stable UUID, without companion headers',async()=>{
    const body=scene();fetcher.mockResolvedValue(response({prompt_id:body.id}));
    await submitComfy(connection,body);
    const [url,options]=fetcher.mock.calls[0];expect(url).toBe(connection.url+'/prompt');
    expect(JSON.parse(options.body).prompt_id).toBe(body.id);
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body).prompt.part0_condition.inputs.prompt).toBe(body.prompt);
    await expect(submitComfy(connection,body)).rejects.toThrow('already submitted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost POST response from queue without another render',async()=>{
    const body=scene();fetcher.mockRejectedValueOnce(new Error('lost'));
    await expect(submitComfy(connection,body)).rejects.toThrow('could not be reached');
    fetcher.mockResolvedValueOnce(response({queue_running:[],queue_pending:[[1,body.id]]})).mockResolvedValueOnce(response({}));
    expect(await listComfy(connection,body.adventureId)).toMatchObject([{id:body.id,submitted:true,state:'queued'}]);
    expect(fetcher.mock.calls.filter(([,opts])=>opts.method==='POST')).toHaveLength(1);
  });
  it('keeps an unknown request unconfirmed and never silently retries it',async()=>{
    const body=scene();fetcher.mockRejectedValueOnce(new Error('lost'));
    await expect(submitComfy(connection,body)).rejects.toThrow();
    fetcher.mockImplementation(async(url:string)=>response(url.endsWith('/queue')?{queue_running:[],queue_pending:[]}:{}));
    expect(await listComfy(connection,body.adventureId)).toMatchObject([{submitted:false,state:'preparing'}]);
    await forgetUnconfirmed(connection,body.id,body.adventureId);
    expect(await listComfy(connection,body.adventureId)).toMatchObject([{state:'error'}]);
  });
  it('scopes cancellation to this adventure and never interrupts another job',async()=>{
    const body=scene();fetcher.mockResolvedValueOnce(response({prompt_id:body.id}));await submitComfy(connection,body);
    await expect(cancelComfy(connection,body.id,'another-adventure')).rejects.toThrow('does not belong');
    fetcher.mockResolvedValueOnce(response({cancelled:true}));
    expect(await cancelComfy(connection,body.id,body.adventureId)).toMatchObject({state:'cancelled'});
    expect(fetcher.mock.lastCall?.[0]).toBe(connection.url+`/api/jobs/${body.id}/cancel`);
  });
  it('saves final file metadata across reloads and removes only owned history',async()=>{
    const body=scene();fetcher.mockResolvedValueOnce(response({prompt_id:body.id}));await submitComfy(connection,body);
    fetcher.mockResolvedValueOnce(response({queue_running:[],queue_pending:[]})).mockResolvedValueOnce(response({[body.id]:{status:{completed:true},outputs:{save:{images:[{filename:body.id+'_00001_.mp4',subfolder:'wayfarer',type:'output'}]}}}}));
    const [job]=await listComfy(connection,body.adventureId);expect(job.state).toBe('completed');
    expect(comfyVideoUrl(connection,job)).toContain('/view?filename='+body.id);
    fetcher.mockResolvedValueOnce(response({}));await removeComfy(connection,body.id,body.adventureId);
    expect(fetcher.mock.lastCall?.[0]).toBe(connection.url+'/history');
    expect(JSON.parse(fetcher.mock.lastCall?.[1].body)).toEqual({delete:[body.id]});
    expect(await listComfy(connection,body.adventureId)).toEqual([]);
  });
  it('never plays arbitrary output paths returned by another workflow',async()=>{
    const body=scene();fetcher.mockResolvedValueOnce(response({prompt_id:body.id}));await submitComfy(connection,body);
    fetcher.mockResolvedValueOnce(response({queue_running:[],queue_pending:[]})).mockResolvedValueOnce(response({[body.id]:{status:{completed:true},outputs:{save:{images:[{filename:'../../private.mp4',subfolder:'wayfarer',type:'output'}]}}}}));
    const [job]=await listComfy(connection,body.adventureId);expect(job.state).toBe('error');expect(()=>comfyVideoUrl(connection,job)).toThrow();
  });
});
