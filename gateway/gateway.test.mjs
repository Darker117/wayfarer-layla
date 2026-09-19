import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway, MCP } from './server.mjs';
import { buildWorkflow, validateRequest, segmentDurations, frameCount } from './workflow.mjs';
const listen = server => new Promise(r=>server.listen(0,'127.0.0.1',()=>r(`http://127.0.0.1:${server.address().port}`)));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const waitFor=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await sleep(20);}throw new Error('Timed out');};
const body={id:'unit-job',adventureId:'unit-world',prompt:'A boat on a lake',resolution:'480p',duration:5};
test('fixed workflow maps every duration, correct dimensions, image conditioning and codec',async()=>{
  const template=JSON.parse(await readFile(new URL('./fasth3.json',import.meta.url),'utf8'));
  for(const resolution of ['480p','720p'])for(const [duration,length]of [[5,124],[10,243],[15,362]]){
    const g=buildWorkflow(template,{...body,resolution,duration});
    assert.equal(g['9'].inputs.length,length);assert.equal(g['10'].inputs.length,length);assert.equal(g['9'].inputs.width,resolution==='480p'?864:1280);
    assert.equal(g['19'].inputs['format.codec'],'h264');assert.equal(g['9'].inputs.first_frame,undefined);assert.equal(g['14'].inputs.steps,8);
  }
  const g=buildWorkflow(template,body,'wayfarer/safe.png');assert.deepEqual(g['9'].inputs.first_frame,['20',0]);assert.equal(template['20'],undefined);
  const bad=structuredClone(template);bad['1'].class_type='ArbitraryHTTP';assert.throws(()=>buildWorkflow(bad,body));
  for(const patch of [{workflow:{}},{duration:226},{resolution:'4k'},{imageId:'../secret'},{prompt:''},{id:'../../secret'}])assert.throws(()=>validateRequest({...body,...patch}));
});
async function fixture(overrides={}){
  const calls=[],cancels=[];
  const comfy=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.includes('/cancel'))cancels.push(req.url);res.end(JSON.stringify(req.url==='/queue'?{queue_running:[],queue_pending:[[0,'owned-prompt']]}:{}));});
  const comfyUrl=await listen(comfy),dataDir=await mkdtemp(join(tmpdir(),'wayfarer-gateway-test-'));
  const mcp={async call(name,args){calls.push(name);if(name==='server_info')return{server:{running:true,url:comfyUrl}};if(name==='validate_workflow'){if(overrides.validate)await overrides.validate();return{valid:true};}if(name==='run_workflow'){if(overrides.run)await overrides.run();return{prompt_id:'owned-prompt'};}},close(){}};
  let gateway,url,pairUrl;
  async function start(){gateway=await createGateway({dataDir,mcp,comfyUrl,noEvents:true});url=await listen(gateway.server);pairUrl=await listen(gateway.pairingServer);}
  await start();
  async function pair(){const c=await(await fetch(pairUrl+'/code',{method:'POST',headers:{'X-Wayfarer-Local':'1'}})).json();const r=await fetch(url+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c.code})});const {token}=await r.json();return{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Adventure-Id':'unit-world'};}
  const headers=await pair();
  const get=async(id='unit-job',h=headers)=>fetch(url+'/jobs/'+id,{headers:h});
  const post=async(b=body)=>fetch(url+'/jobs',{method:'POST',headers,body:JSON.stringify(b)});
  return {get gateway(){return gateway;},get url(){return url;},get pairUrl(){return pairUrl;},headers,calls,cancels,pair,get,post,dataDir,async restart(){await gateway.close();await start();},async close(){await gateway.close();await new Promise(r=>comfy.close(r));}};
}
test('auth, CORS, request bounds, owned read/cancel/output and idempotent submit',async()=>{
  const f=await fixture();try{
    assert.equal((await fetch(f.url+'/health')).status,401);
    assert.equal((await fetch(f.url+'/health',{headers:{...f.headers,Origin:'https://evil.example'}})).status,403);
    assert.equal((await f.post({...body,workflow:'arbitrary'})).status,400);
    assert.equal((await f.post()).status,202);assert.equal((await f.post()).status,200);
    await waitFor(()=>f.gateway.state.jobs['unit-job'].promptId);assert.equal(f.calls.filter(n=>n==='run_workflow').length,1);
    assert.equal((await f.get('unit-job',{...f.headers,'X-Adventure-Id':'other'})).status,404);
    assert.equal((await f.get('unit-job',await f.pair())).status,404);
    assert.equal((await fetch(f.url+'/jobs/unit-job/video',{headers:f.headers})).status,409);
    await fetch(f.url+'/jobs/unit-job/cancel',{method:'POST',headers:f.headers});assert.deepEqual(f.cancels,['/api/jobs/owned-prompt/cancel']);
    assert.equal((await(await f.get()).json()).state,'cancelled');
  }finally{await f.close();}
});
test('cancel during validation prevents any submission and remains terminal',async()=>{
  let release;const gate=new Promise(r=>release=r);const f=await fixture({validate:()=>gate});
  try{await f.post();await waitFor(()=>f.calls.includes('validate_workflow'));await fetch(f.url+'/jobs/unit-job/cancel',{method:'POST',headers:f.headers});release();await sleep(100);assert.equal(f.calls.includes('run_workflow'),false);assert.equal(f.gateway.state.jobs['unit-job'].state,'cancelled');}finally{release();await f.close();}
});
test('cancel while MCP returns its owned ID cancels only that submitted job',async()=>{
  let release;const gate=new Promise(r=>release=r);const f=await fixture({run:()=>gate});
  try{await f.post();await waitFor(()=>f.calls.includes('run_workflow'));await fetch(f.url+'/jobs/unit-job/cancel',{method:'POST',headers:f.headers});release();await waitFor(()=>f.cancels.length===1);assert.deepEqual(f.cancels,['/api/jobs/owned-prompt/cancel']);assert.equal(f.gateway.state.jobs['unit-job'].state,'cancelled');}finally{release();await f.close();}
});
test('cancel before a delayed HTTP submission creates an owned tombstone',async()=>{
  const f=await fixture();try{await fetch(f.url+'/jobs/unit-job/cancel',{method:'POST',headers:f.headers});assert.equal((await(await f.post()).json()).state,'cancelled');assert.equal(f.calls.includes('run_workflow'),false);}finally{await f.close();}
});
test('persisted job identity reconnects after gateway restart',async()=>{
  const f=await fixture();try{await f.post();await waitFor(()=>f.gateway.state.jobs['unit-job'].promptId);const saved=JSON.parse(await readFile(join(f.dataDir,'state.json'),'utf8'));assert.equal(saved.jobs['unit-job'].promptId,'owned-prompt');assert.ok(!JSON.stringify(saved).includes(f.headers.Authorization.slice(7)));assert.equal(saved.jobs['unit-job'].prompt,body.prompt);}finally{await f.close();}
});
test('dead MCP child rejects immediately instead of crashing on stdin',async()=>{
  const m=new MCP('wayfarer-missing-python-command');await sleep(100);await assert.rejects(m.call('server_info'),/unavailable/);m.close();
});

test('all lengths through225 use real model-sized segments without changing total length',()=>{for(let n=1;n<=225;n++){const parts=segmentDurations(n);assert.equal(parts.reduce((a,b)=>a+b,0),n);for(const p of parts){assert.ok(p>=1&&p<=15);assert.ok(frameCount(p)>=124&&frameCount(p)<=362);assert.ok(frameCount(p)>=p*24);}}assert.deepEqual(segmentDurations(225),Array(15).fill(15));assert.deepEqual(segmentDurations(16),[8,8]);});

const localHeaders={'X-Wayfarer-Local':'1','Content-Type':'application/json'};
async function createCode(f,durationMinutes=null){const response=await fetch(f.pairUrl+'/code',{method:'POST',headers:localHeaders,body:JSON.stringify({durationMinutes})});assert.equal(response.status,200);return response.json();}
async function useCode(f,code){return fetch(f.url+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});}

test('forever codes are reusable, survive restart, and deletion revokes their devices only',async()=>{
  const f=await fixture();try{
    const code=await createCode(f);assert.equal(code.expires,null);
    const first=await(await useCode(f,code.code)).json();const second=await(await useCode(f,code.code)).json();
    assert.ok(first.token&&second.token);assert.notEqual(first.token,second.token);
    await f.restart();
    const listed=await(await fetch(f.pairUrl+'/codes',{headers:localHeaders})).json();
    assert.equal(listed.find(c=>c.id===code.id).code,code.code);assert.equal(listed.find(c=>c.id===code.id).devices,2);
    assert.equal((await useCode(f,code.code)).status,200);
    const removed=await(await fetch(f.pairUrl+'/codes/'+code.id,{method:'DELETE',headers:localHeaders})).json();assert.equal(removed.disconnected,3);
    assert.equal((await useCode(f,code.code)).status,401);
    assert.equal((await fetch(f.url+'/jobs?adventureId=unit-world',{headers:{Authorization:'Bearer '+first.token}})).status,401);
    assert.equal((await fetch(f.url+'/jobs?adventureId=unit-world',{headers:{Authorization:'Bearer '+second.token}})).status,401);
    assert.equal((await fetch(f.url+'/jobs?adventureId=unit-world',{headers:f.headers})).status,200);
    await f.restart();assert.ok(!f.gateway.state.pairingCodes[code.id]);
  }finally{await f.close();}
});

test('10/20/30 minute expiry blocks new pairings while a paired render can continue',async()=>{
  const f=await fixture();try{
    for(const minutes of [10,20,30]){const code=await createCode(f,minutes);assert.equal(code.expires-code.createdAt,minutes*60000);}
    const code=await createCode(f,10),paired=await(await useCode(f,code.code)).json();
    f.gateway.state.pairingCodes[code.id].expires=Date.now()-1;
    assert.equal((await useCode(f,code.code)).status,401);
    assert.equal((await fetch(f.url+'/jobs?adventureId=unit-world',{headers:{Authorization:'Bearer '+paired.token}})).status,200);
    const invalid=await fetch(f.pairUrl+'/code',{method:'POST',headers:localHeaders,body:JSON.stringify({durationMinutes:15})});assert.equal(invalid.status,400);
    assert.equal((await fetch(f.url+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'é'.repeat(12)})})).status,401);
  }finally{await f.close();}
});

test('only the local companion page can list, create or delete codes',async()=>{
  const f=await fixture();try{
    const page=await(await fetch(f.pairUrl+'/')).text();assert.ok(page.includes('Wayfarer PC Companion'));assert.ok(!page.includes('Keep this desktop page private.'));
    const code=await createCode(f);
    assert.equal((await fetch(f.pairUrl+'/codes')).status,403);
    assert.equal((await fetch(f.pairUrl+'/code',{method:'POST'})).status,403);
    assert.equal((await fetch(f.pairUrl+'/codes/'+code.id,{method:'DELETE',headers:{...localHeaders,Origin:'https://unrelated.example'}})).status,403);
    const wrongHost=await new Promise((resolve,reject)=>{http.get(f.pairUrl+'/codes',{headers:{...localHeaders,Host:'unrelated.example:8788'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
    assert.equal(wrongHost,403);
    assert.ok(f.gateway.state.pairingCodes[code.id]);
  }finally{await f.close();}
});
