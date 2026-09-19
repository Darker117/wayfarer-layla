// Opt-in native ComfyUI smoke. Default uses synthetic frames/audio, never model weights.
// --render instead generates one neutral five-second clip using the production graph.
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.COMFY_TEST_URL || 'http://127.0.0.1:8188';
const directory=resolve('artifacts/direct-comfy');await mkdir(directory,{recursive:true});
await build({entryPoints:['src/comfyWorkflow.ts'],bundle:true,platform:'node',format:'esm',outfile:directory+'/workflow.mjs'});
const {buildComfyWorkflow,videoId,segmentDurations}=await import(pathToFileURL(directory+'/workflow.mjs'));
const render=process.argv.includes('--render'),duration=render?5:225,id=videoId();
const graph=buildComfyWorkflow({id,adventureId:'native-smoke',prompt:'A small red paper sailboat moves slowly across a calm blue pond in warm afternoon light. A steady wide shot. Gentle water sounds.',duration,resolution:'480p'});
if(!render){
 segmentDurations(duration).forEach((seconds,i)=>{
  const p=`part${i}_`,length=5+17*Math.ceil((Math.max(5,seconds)*24-5)/17);
  graph[p+'images']=i===0?{class_type:'EmptyImage',inputs:{width:64,height:64,batch_size:length,color:0x305090}}:{class_type:'RepeatImageBatch',inputs:{image:[`part${i-1}_guide`,0],amount:length}};
  graph[p+'audio']={class_type:'EmptyAudio',inputs:{duration:length/24,sample_rate:48000,channels:2}};
  Object.assign(graph[p+'crop'].inputs,{width:64,height:64,x:0,y:0});
 });
 // Keep exactly the dependency closure of SaveVideo; no model nodes can execute.
 const needed=new Set();function visit(key){if(needed.has(key))return;needed.add(key);for(const value of Object.values(graph[key].inputs))if(Array.isArray(value))visit(value[0]);}visit('save');
 for(const key of Object.keys(graph))if(!needed.has(key))delete graph[key];
 assert.ok(!Object.values(graph).some(n=>/Loader|Sampler|MiniMax/.test(n.class_type)));
}
const queue=await(await fetch(base+'/queue')).json();assert.equal(queue.queue_running.length+queue.queue_pending.length,0,'Wait for the existing queue before running this smoke.');
await writeFile(directory+`/${id}.json`,JSON.stringify(graph,null,2));
const response=await fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,prompt_id:id,client_id:id})});
const submitted=await response.json();assert.ok(response.ok,JSON.stringify(submitted));assert.equal(submitted.prompt_id,id);
console.log(JSON.stringify({submitted:id,mode:render?'model':'synthetic',duration,nodes:Object.keys(graph).length}));
const start=Date.now();let history;
while(Date.now()-start<20*60*1000){
 history=(await(await fetch(base+'/history/'+id)).json())[id];
 if(history){assert.notEqual(history.status.status_str,'error',JSON.stringify(history.status.messages));if(history.status.completed)break;}
 await new Promise(r=>setTimeout(r,2000));
}
assert.ok(history?.status.completed,`Timed out. Inspect only this job: ${id}`);
const file=history.outputs.save.images[0],url=base+'/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder,type:file.type});
const data=await fetch(url);assert.ok(data.ok);const path=directory+`/${render?'model-5s':'synthetic-225s'}.mp4`;await writeFile(path,Buffer.from(await data.arrayBuffer()));
const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8',windowsHide:true});assert.equal(probe.status,0,probe.stderr);
const metadata=JSON.parse(probe.stdout),video=metadata.streams.find(s=>s.codec_type==='video'),audio=metadata.streams.find(s=>s.codec_type==='audio');
assert.equal(video.codec_name,'h264');assert.equal(audio.codec_name,'aac');assert.ok(Math.abs(Number(video.duration)-duration)<0.09,JSON.stringify(video));
assert.ok(Math.abs(Number(audio.duration)-duration)<0.3,JSON.stringify(audio));assert.equal(Number(video.nb_frames),duration*24);
if(render){assert.equal(video.width,854);assert.equal(video.height,480);}
const result={id,mode:render?'model':'synthetic',duration,elapsedSeconds:(Date.now()-start)/1000,video:{width:video.width,height:video.height,duration:video.duration,frames:video.nb_frames},audioDuration:audio.duration,path};
await writeFile(directory+`/${render?'model':'synthetic'}-result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
