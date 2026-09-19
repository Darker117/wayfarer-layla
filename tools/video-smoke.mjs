// Explicit desktop-only smoke test. Queues one neutral clip through the gateway.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base='http://127.0.0.1:8787',duration=Number(process.env.WAYFARER_SMOKE_SECONDS || 5);
const pair=await (await fetch('http://127.0.0.1:8788/code',{method:'POST',headers:{'X-Wayfarer-Local':'1'}})).json();
const {token}=await (await fetch(base+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pair.code})})).json();
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Adventure-Id':'wayfarer-neutral-smoke'};
const health=await fetch(base+'/health',{headers}); if(!health.ok) throw new Error('Gateway health failed');
const id=randomUUID(), started=Date.now();
const response=await fetch(base+'/jobs',{method:'POST',headers,body:JSON.stringify({id,adventureId:'wayfarer-neutral-smoke',prompt:'A small wooden sailboat floats gently across a still lake at sunrise. Slow steady camera beside the boat, golden reflections, distant pine trees. Natural audio: soft water ripples and distant birds. No people, no text.',resolution:'480p',duration})});
if(!response.ok) throw new Error('Submission failed');
console.log('Owned smoke submitted: '+id);
let last='';
for(let i=0;i<900;i++) {
  await new Promise(r=>setTimeout(r,2000));
  const job=await (await fetch(base+`/jobs/${id}`,{headers})).json();
  if(job.state+job.segment!==last){console.log(job.state+': '+job.message);last=job.state+job.segment;}
  if(job.state==='completed'){
    const video=await fetch(base+`/jobs/${id}/video`,{headers});
    if(!video.ok)throw new Error('Output download failed');
    await mkdir('artifacts',{recursive:true});
    await writeFile(`artifacts/video-gateway-smoke-${duration}s.mp4`,Buffer.from(await video.arrayBuffer()));
    await writeFile(`artifacts/video-gateway-smoke-${duration}s.json`,JSON.stringify({id,duration,resolution:'480p',elapsedSeconds:(Date.now()-started)/1000,statesVerified:true},null,2));
    console.log('Complete; output saved in artifacts/video-gateway-smoke.mp4');process.exit(0);
  }
  if(['error','cancelled'].includes(job.state))throw new Error(job.message);
}
throw new Error('Smoke timed out; check the owned desktop job before retrying.');
