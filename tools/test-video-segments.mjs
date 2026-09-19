// Synthetic end-to-end pipeline check: real FFmpeg, mock MCP/Comfy, no GPU jobs.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const {createGateway}=await import(pathToFileURL(join(process.cwd(),'gateway/server.mjs')));
const dir=await mkdtemp(join(tmpdir(),'wayfarer-225-gateway-'));
const source=join(dir,'synthetic-source.mp4');
const run=(cmd,args)=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(new Error(err)));});
await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=864x480:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=32000','-t','15','-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p','-c:a','aac',source]);
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(`http://127.0.0.1:${s.address().port}`)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const submitted=[],history=new Map();let uploads=0,gateUploads=false,releaseUpload;
const comfy=http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  const respond=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(path.startsWith('/history/'))return respond({[path.slice(9)]:history.get(path.slice(9))});
  if(path==='/view'){res.setHeader('Content-Type','video/mp4');return createReadStream(source).pipe(res);}
  if(path==='/upload/image'){
   const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
   assert.ok(bytes.includes(Buffer.from([137,80,78,71,13,10,26,10])));uploads++;
   if(gateUploads)await new Promise(r=>releaseUpload=r);
   return respond({name:`guide-${uploads}.png`,subfolder:'wayfarer'});
  }
  if(path==='/queue')return respond({queue_running:[],queue_pending:[]});
  return respond({});
 }catch(e){res.statusCode=500;res.end(String(e));}
});
const comfyUrl=await listen(comfy);
const mcp={async call(name,args){
 if(name==='server_info')return{server:{running:true,url:comfyUrl}};
 const graph=JSON.parse(await readFile(args.workflow_path,'utf8'));
 if(name==='validate_workflow'){assert.ok(graph['9'].inputs.length<=362);return{valid:true};}
 if(name==='run_workflow'){
  const id=`synthetic-${submitted.length+1}`;
  const filename=graph['19'].inputs.filename_prefix.split('/')[1]+'_00001_.mp4';
  submitted.push({id,graph});history.set(id,{status:{completed:true,status_str:'success'},outputs:{'19':{images:[{filename,subfolder:'wayfarer',type:'output'}]}}});
  return{prompt_id:id,client_id:'test-client'};
 }
 throw new Error('Unexpected MCP command');
},close(){}};
let gateway,url,pairUrl;
async function start(){gateway=await createGateway({dataDir:join(dir,'data'),comfyUrl,mcp,noEvents:true,pollIntervalMs:100});url=await listen(gateway.server);pairUrl=await listen(gateway.pairingServer);}
async function waitFor(fn,label,timeout=240000){const end=Date.now()+timeout;let part=-1;while(Date.now()<end){if(fn())return;const j=Object.values(gateway.state.jobs)[0];if(j?.segmentIndex!==undefined&&j.segmentIndex!==part){part=j.segmentIndex;console.log(JSON.stringify({stage:label,segment:part+1,state:j.state}));}if(j?.state==='error')throw new Error(j.message);await sleep(50);}throw new Error('Timed out: '+label);}
try{
 await start();const code=(await(await fetch(pairUrl+'/code',{method:'POST',headers:{'X-Wayfarer-Local':'1'}})).json()).code;
 const token=(await(await fetch(url+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})).json()).token;
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Adventure-Id':'synthetic-review'};
 const id='x'.repeat(80),body={id,adventureId:'synthetic-review',prompt:'A'.repeat(12000),resolution:'480p',duration:225};
 let r=await fetch(url+'/jobs',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,202);
 await waitFor(()=>gateway.state.jobs[id].segmentIndex===1&&gateway.state.jobs[id].promptId,'before-restart');
 assert.equal(submitted.length,2);const current=gateway.state.jobs[id].promptId;
 await gateway.close();await start();assert.equal(gateway.state.jobs[id].promptId,current);
 await waitFor(()=>gateway.state.jobs[id].state==='completed','after-restart');
 assert.equal(submitted.length,15);assert.equal(uploads,14);
 assert.ok(!submitted[0].graph['9'].inputs.first_frame);
 for(const row of submitted.slice(1)){assert.deepEqual(row.graph['9'].inputs.first_frame,['20',0]);assert.ok(row.graph['9'].inputs.prompt.startsWith(body.prompt));}
 const output=join(dir,'data',gateway.state.jobs[id].output),probe=JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
 assert.ok(Math.abs(Number(probe.format.duration)-225)<.15);assert.equal(probe.streams.find(s=>s.codec_type==='video').display_aspect_ratio,'16:9');assert.ok(probe.streams.find(s=>s.codec_type==='audio'));
 gateUploads=true;const cancelId='cancel-between-segments';
 r=await fetch(url+'/jobs',{method:'POST',headers,body:JSON.stringify({...body,id:cancelId,prompt:'A neutral scene',duration:16})});assert.equal(r.status,202);
 await waitFor(()=>!!releaseUpload,'cancel-between-segments');
 assert.equal(submitted.length,16);
 r=await fetch(url+'/jobs/'+cancelId+'/cancel',{method:'POST',headers});assert.equal(r.status,200);releaseUpload();await sleep(300);
 assert.equal(gateway.state.jobs[cancelId].state,'cancelled');assert.equal(submitted.length,16);
 const result={passed:true,synthetic:true,duration:Number(probe.format.duration),segments:15,continuationImages:14,restartNoDuplicate:true,cancelBeforeNextSubmission:true,maxLengthPromptPreserved:true,maxLengthIdSupported:true,gpuCalls:0,directory:dir};
 await writeFile(join(dir,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{releaseUpload?.();await gateway?.close();await new Promise(r=>comfy.close(r));}
