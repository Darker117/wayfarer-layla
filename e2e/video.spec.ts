import { test, expect, type Page } from '@playwright/test';
import { initialStore } from '../src/seeds';
import { startAdventure, snapshot } from '../src/domain';

async function setup(page: Page, enhance=false, auto=false, lost=false, openingOnly=false) {
  const store=initialStore(),a=startAdventure(store.scenarios[0]);
  a.id='video-adventure'; a.turns=[{id:'turn',mode:'think',input:'PRIVATE THOUGHT',scriptInput:'PRIVATE SCRIPT',output:'A silver bird flies over the lake.',before:snapshot(a),logs:['PRIVATE LOG'],contextCards:[],createdAt:1}];if(openingOnly)a.turns=[];store.adventures.push(a);
  await page.addInitScript(({store,enhance,auto})=>{
    const w=window as any;w.nativeStore=store;w.chatCalls=0;w.savedFiles=[];
    localStorage.setItem('wayfarer-video-v1:connection',JSON.stringify({url:'http://127.0.0.1:8787',token:'test-device-token-never-exported'}));
    localStorage.setItem('wayfarer-video-v1:video-adventure',JSON.stringify({turns:1,context:true,resolution:'480p',duration:30,durationMode:auto?'ai':'manual',enhance,style:'Soft light'}));
    const send=(id:string,event:string,data:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id,event,data})}));
    w.ReactNativeWebView={postMessage(raw:string){const r=JSON.parse(raw);if(r.cmd.startsWith('send_message')){w.chatCalls++;w.lastChat=r.data;setTimeout(()=>{const msg=w.chatReply || '<think>PRIVATE MODEL REASONING</think>'+JSON.stringify({prompt:'An enhanced boat crosses the silver lake.',duration:23});send(r.id,'on_message',{msg,delta:msg});send(r.id,'on_message_end',{msg});},100);return;}if(r.cmd==='save_file'){w.savedFiles.push(r.data);queueMicrotask(()=>send(r.id,'on_save_file_response',{success:true}));return;}if(r.cmd==='get_execution_context')queueMicrotask(()=>send(r.id,'on_get_execution_context_response',{app_version:'7.4.0',character:null,session_id:null}));if(r.cmd==='execute_sql'){if(r.data.query.startsWith('INSERT'))w.nativeStore=JSON.parse(r.data.params[0]);queueMicrotask(()=>send(r.id,'on_execute_sql_response',{rows:r.data.query.startsWith('SELECT')?[{payload:JSON.stringify(w.nativeStore)}]:[],rowsAffected:1,insertId:1}));}}};
  },{store,enhance,auto});
  const submitted:any[]=[],jobs:any[]=[];let dropped=false;
  await page.route('http://127.0.0.1:8787/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const respond=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
    if(path==='/health')return respond({ok:true});
    if(path==='/uploads')return respond({id:'uploaded-start'});
    if(path.startsWith('/uploads/'))return respond({removed:true});
    if(path==='/jobs' && req.method()==='POST'){
      const body=req.postDataJSON();submitted.push(body);
      let job=jobs.find(j=>j.id===body.id);if(!job){job={...body,state:'queued',message:'Queued on your desktop',createdAt:Date.now(),updatedAt:Date.now()};jobs.push(job);}
      if(lost&&!dropped){dropped=true;return route.abort('failed');}return respond(job,202);
    }
    if(path==='/jobs')return respond(jobs);
    if(path.endsWith('/video'))return route.fulfill({contentType:'video/mp4',path:'e2e/fixtures/video.mp4'});
    if(path.startsWith('/jobs/') && req.method()==='DELETE'){const index=jobs.findIndex(j=>path==='/jobs/'+j.id);if(index>=0)jobs.splice(index,1);return respond({removed:true});}
    if(path.endsWith('/cancel')){const job=jobs.find(j=>path.includes(j.id));if(job){job.state='cancelled';job.message='Cancelled';}return respond(job||{});}
    return respond({},404);
  });
  await page.goto('/');await page.getByRole('button',{name:new RegExp('The Lantern Hollow.*'+a.turns.length+' turns into your story')}).click();
  return {submitted,jobs};
}
async function sendVideo(page: Page, input: string) {
  await page.getByRole('button',{name:'Video',exact:true}).click();
  await page.getByLabel('Your action').fill(input);
  await page.getByRole('button',{name:'Send video',exact:true}).click();
}
for(const [enhance,auto,calls] of [[false,false,0],[true,false,1],[false,true,1],[true,true,1]] as const){
  test(`Video mode: enhance=${enhance}, automatic length=${auto}`,async({page})=>{
    const {submitted}=await setup(page,enhance,auto);
    await page.getByLabel('Your action').fill('A boat crosses the lake');
    await page.getByRole('button',{name:'Video',exact:true}).click();
    await expect(page.getByRole('button',{name:'Video',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('dialog')).toHaveCount(0);expect(submitted).toHaveLength(0);
    await page.getByRole('button',{name:'Send video'}).click();
    await expect.poll(()=>submitted.length).toBe(1);expect(submitted[0].duration).toBe(auto?23:30);
    expect(submitted[0].prompt).toContain(enhance?'An enhanced boat':'A boat crosses the lake');expect(JSON.stringify(submitted[0])).not.toContain('PRIVATE');
    expect(await page.evaluate(()=>(window as any).chatCalls)).toBe(calls);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Your action')).toHaveValue('');
    await expect(page.getByRole('button',{name:'Video',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.story-column .video-response')).toContainText('Queued on your desktop');
    expect(await page.evaluate(()=>(window as any).nativeStore.adventures[0].turns.length)).toBe(1);
  });
}

test('empty Video never continues story; keyboard sends without opening settings',async({page})=>{
  const {submitted}=await setup(page);
  await page.getByRole('button',{name:'Video',exact:true}).click();
  await expect(page.getByRole('button',{name:'Send video'})).toBeDisabled();
  await page.getByLabel('Your action').press('Control+Enter');
  expect(submitted).toHaveLength(0);expect(await page.evaluate(()=>(window as any).chatCalls)).toBe(0);
  await page.getByLabel('Your action').fill('A mountain lake');
  await page.getByLabel('Your action').press('Control+Enter');
  await expect.poll(()=>submitted.length).toBe(1);await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lost reply is recovered without another job or AI call',async({page})=>{
  const {submitted,jobs}=await setup(page,true,false,true);
  await sendVideo(page,'A boat');
  await expect.poll(()=>submitted.length).toBe(1);await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const recover=page.getByRole('button',{name:'Recover submission'});if(await recover.isVisible())await recover.click();
  await expect.poll(()=>jobs.length).toBe(1);expect(new Set(submitted.map(j=>j.id)).size).toBe(1);expect(await page.evaluate(()=>(window as any).chatCalls)).toBe(1);
  await expect(page.locator('.story-column .video-response')).toContainText('Queued on your desktop');
});

test('uploaded image, chosen parameters and inline errors survive closing settings',async({page})=>{
  const {submitted}=await setup(page);
  await page.getByLabel('Your action').fill('A sailing boat');await page.getByRole('button',{name:'Video settings and clips'}).click();
  await page.getByLabel('Upload starting image').setInputFiles({name:'boat.png',mimeType:'image/png',buffer:Buffer.from('test-image')});
  await expect(page.getByText('boat.png',{exact:true})).toBeVisible();await page.getByLabel('Duration in seconds',{exact:false}).fill('60');
  await page.getByRole('combobox',{name:'Resolution',exact:true}).selectOption('720p');
  await page.getByRole('button',{name:'Close dialog'}).click();await sendVideo(page,'A sailing boat');
  await expect.poll(()=>submitted.length).toBe(1);expect(submitted[0].imageId).toBe('uploaded-start');expect(submitted[0].duration).toBe(60);expect(submitted[0].resolution).toBe('720p');
  await expect(page.locator('.story-column .video-response').getByRole('button')).toHaveCount(0);
  await page.getByRole('button',{name:'Video settings and clips'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel clip'}).click();await expect(page.getByRole('dialog').getByText('cancelled',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Duration in seconds',{exact:false})).toHaveValue('60');
  await page.getByLabel('Duration in seconds',{exact:false}).fill('226');await page.getByRole('button',{name:'Close dialog'}).click();await sendVideo(page,'A second boat');
  await expect(page.getByRole('alert')).toContainText('225');expect(submitted.length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('Your action')).toHaveValue('A second boat');
});

test('unpaired Video keeps the draft and shows guidance inline',async({page})=>{
  await setup(page);
  await page.evaluate(()=>localStorage.removeItem('wayfarer-video-v1:connection'));
  await page.getByRole('button',{name:'Back to adventures'}).click();
  await page.getByRole('button',{name:'Resume The Lantern Hollow',exact:true}).click();
  await sendVideo(page,'A quiet lake');
  await expect(page.getByRole('alert')).toContainText('bottom left');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Your action')).toHaveValue('A quiet lake');
  await page.getByRole('button',{name:'Video settings and clips'}).click();
  await expect(page.getByRole('dialog',{name:'Video settings',exact:true})).toBeVisible();
});

test('video precedes its narration and all management stays in settings after resume',async({page})=>{
  const {jobs}=await setup(page);
  await sendVideo(page,'A boat crosses the lake');
  const clip=page.locator('.story-column .video-response');await expect(clip).toBeVisible();
  await page.evaluate(()=>{(window as any).chatReply='The boat reaches the far shore.';});
  await page.getByRole('button',{name:'Do',exact:true}).click();await page.getByLabel('Your action').fill('walk to shore');
  await page.getByRole('button',{name:'Send action'}).click();
  await expect(page.locator('.story-column')).toContainText('The boat reaches the far shore.');
  await expect.poll(()=>page.evaluate(()=>(window as any).nativeStore.adventures[0].turns.length)).toBe(2);
  jobs[0].state='completed';jobs[0].message='Your video is ready';
  await clip.scrollIntoViewIfNeeded();
  const player=clip.getByLabel('Generated adventure video');await expect(player).toBeVisible();
  await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
  await expect(clip.getByRole('button')).toHaveCount(0);
  await expect(player).toHaveAttribute('controlsList', /nodownload/);
  await expect(clip.locator('.player-action, .video-clip-heading, .toolbar')).toHaveCount(0);
  await player.evaluate((v:HTMLVideoElement)=>v.play());
  await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Back to adventures'}).click();
  await page.getByRole('button',{name:'Resume The Lantern Hollow',exact:true}).click();
  await expect(clip).toBeVisible();await clip.scrollIntoViewIfNeeded();
  await expect(player).toBeVisible();
  const order=await page.locator('.story-column > article').allTextContents();
  expect(order).toHaveLength(2);expect(order[0]).toContain('A silver bird');expect(order[1]).toContain('The boat reaches');
  const narration=page.locator('.story-narration').filter({has:page.locator('.video-response')});
  await expect(narration.locator('> .prose')).toHaveText('A silver bird flies over the lake.');
  await expect(narration.locator(':scope > :first-child')).toHaveClass(/video-response/);
  expect(await player.evaluate(video=>!!(video.compareDocumentPosition(video.closest('.story-narration')!.querySelector('.prose')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.story-column').getByText('A silver bird flies over the lake.',{exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Video settings and clips'}).click();
  const dialog=page.getByRole('dialog',{name:'Video settings',exact:true});
  await expect(dialog.getByRole('heading',{name:'Adventure videos'})).toBeVisible();
  const savedClip=dialog.getByLabel('Video response');await savedClip.scrollIntoViewIfNeeded();
  await expect(savedClip.getByLabel('Generated adventure video')).toBeVisible();
  await savedClip.getByRole('button',{name:'Save video',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).savedFiles.length)).toBe(1);
  await expect(savedClip.getByRole('button',{name:'Share / save',exact:true})).toBeVisible();
  await savedClip.getByRole('button',{name:'Remove clip',exact:true}).click();
  await expect(dialog.getByLabel('Video response')).toHaveCount(0);expect(jobs).toHaveLength(0);
  await page.getByRole('button',{name:'Close dialog'}).click();await expect(clip).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).nativeStore.adventures[0].turns.length)).toBe(2);
});


test('a video requested before any turn appears above the opening narration',async({page})=>{
  const {jobs}=await setup(page,false,false,false,true);
  await sendVideo(page,'The village at dawn');await expect.poll(()=>jobs.length).toBe(1);
  const opening=page.locator('.story-opening .story-narration');
  await expect(opening.locator('> .video-response')).toBeVisible();
  await expect(opening.locator(':scope > :first-child')).toHaveClass(/video-response/);
  await expect(opening.locator('> .prose')).toContainText('The last train leaves');
  expect(await page.evaluate(()=>(window as any).nativeStore.adventures[0].turns.length)).toBe(0);
});

test('older clips appear before the narration that existed at submission',async({page})=>{
  const {jobs}=await setup(page);
  jobs.push({id:'legacy-video',adventureId:'video-adventure',state:'completed',message:'Your video is ready',resolution:'480p',duration:5,createdAt:2,updatedAt:2});
  const narration=page.locator('.story-turn > .story-narration').first();
  await expect(narration.locator('> .video-response')).toBeVisible();
  await expect(narration.locator(':scope > :first-child')).toHaveClass(/video-response/);
  await expect(narration.locator('> .prose')).toHaveText('A silver bird flies over the lake.');
  await expect(narration.locator('.video-response .toolbar')).toHaveCount(0);
});

test('undoing narration keeps its video accessible without restoring the deleted turn',async({page})=>{
  const {jobs}=await setup(page);
  await sendVideo(page,'A boat');await expect.poll(()=>jobs.length).toBe(1);
  await expect(page.locator('.story-narration > .video-response')).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('.story-column > .video-response')).toBeVisible();
  await expect(page.locator('.story-column')).not.toContainText('A silver bird flies over the lake.');
  expect(await page.evaluate(()=>(window as any).nativeStore.adventures[0].turns.length)).toBe(0);
  await page.getByRole('button',{name:'Video settings and clips'}).click();
  await expect(page.getByRole('dialog').getByLabel('Video response')).toContainText('A boat');
});

for(const width of [320,390,1440])test(`video controls and inline result fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const {jobs}=await setup(page);
  await expect(page.getByRole('button',{name:'Video',exact:true})).toBeInViewport();
  await sendVideo(page,'A lake beneath the evening sky');await expect.poll(()=>jobs.length).toBe(1);
  jobs[0].state='completed';jobs[0].message='Your video is ready';
  await page.locator('.video-response').scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Generated adventure video')).toBeVisible();
  await expect.poll(()=>page.getByLabel('Generated adventure video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('.story-end').scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Generated adventure video')).toBeInViewport();
  await expect(page.locator('.story-column .video-response').getByRole('button')).toHaveCount(0);
  await page.screenshot({path:`docs/screenshots/video-story-${width}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole('button',{name:'Video settings and clips'}).click();
  await page.screenshot({path:`docs/screenshots/video-studio-${width}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
