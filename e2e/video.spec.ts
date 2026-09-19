import { test, expect, type Page } from '@playwright/test';
import { initialStore } from '../src/seeds';
import { startAdventure, snapshot } from '../src/domain';

async function setup(page: Page, enhance=false, auto=false, lost=false) {
  const store=initialStore(),a=startAdventure(store.scenarios[0]);
  a.id='video-adventure'; a.turns=[{id:'turn',mode:'think',input:'PRIVATE THOUGHT',scriptInput:'PRIVATE SCRIPT',output:'A silver bird flies over the lake.',before:snapshot(a),logs:['PRIVATE LOG'],contextCards:[],createdAt:1}];store.adventures.push(a);
  await page.addInitScript(({store,enhance,auto})=>{
    const w=window as any;w.nativeStore=store;w.chatCalls=0;
    localStorage.setItem('wayfarer-video-v1:connection',JSON.stringify({url:'http://127.0.0.1:8787',token:'test-device-token-never-exported'}));
    localStorage.setItem('wayfarer-video-v1:video-adventure',JSON.stringify({turns:1,context:true,resolution:'480p',duration:30,durationMode:auto?'ai':'manual',enhance,style:'Soft light'}));
    const send=(id:string,event:string,data:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id,event,data})}));
    w.ReactNativeWebView={postMessage(raw:string){const r=JSON.parse(raw);if(r.cmd.startsWith('send_message')){w.chatCalls++;w.lastChat=r.data;setTimeout(()=>{const msg='<think>PRIVATE MODEL REASONING</think>'+JSON.stringify({prompt:'An enhanced boat crosses the silver lake.',duration:23});send(r.id,'on_message',{msg,delta:msg});send(r.id,'on_message_end',{msg});},100);return;}if(r.cmd==='get_execution_context')queueMicrotask(()=>send(r.id,'on_get_execution_context_response',{app_version:'7.4.0',character:null,session_id:null}));if(r.cmd==='execute_sql'){if(r.data.query.startsWith('INSERT'))w.nativeStore=JSON.parse(r.data.params[0]);queueMicrotask(()=>send(r.id,'on_execute_sql_response',{rows:r.data.query.startsWith('SELECT')?[{payload:JSON.stringify(w.nativeStore)}]:[],rowsAffected:1,insertId:1}));}}};
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
    if(path.endsWith('/cancel')){const job=jobs.find(j=>path.includes(j.id));if(job){job.state='cancelled';job.message='Cancelled';}return respond(job||{});}
    return respond({},404);
  });
  await page.goto('/');await page.getByRole('button',{name:/The Lantern Hollow.*1 turns into your story/}).click();
  return {submitted,jobs};
}
for(const [enhance,auto,calls] of [[false,false,0],[true,false,1],[false,true,1],[true,true,1]] as const){
  test(`direct Video: enhance=${enhance}, automatic length=${auto}`,async({page})=>{
    const {submitted}=await setup(page,enhance,auto);
    await page.getByRole('button',{name:'Say',exact:true}).click();await page.getByLabel('Your action').fill('A boat crosses the lake');
    await page.getByRole('button',{name:'Video',exact:true}).click();
    await expect.poll(()=>submitted.length).toBe(1);expect(submitted[0].duration).toBe(auto?23:30);
    expect(submitted[0].prompt).toContain(enhance?'An enhanced boat':'A boat crosses the lake');expect(JSON.stringify(submitted[0])).not.toContain('PRIVATE');
    expect(await page.evaluate(()=>(window as any).chatCalls)).toBe(calls);
    await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByLabel('Your action')).toHaveValue('A boat crosses the lake');await expect(page.getByRole('button',{name:'Say',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(await page.evaluate(()=>(window as any).nativeStore.adventures[0].turns.length)).toBe(1);
  });
}
test('lost reply is recovered without another job or AI call',async({page})=>{
  const {submitted,jobs}=await setup(page,true,false,true);
  await page.getByLabel('Your action').fill('A boat');await page.getByRole('button',{name:'Video',exact:true}).click();
  await expect.poll(()=>submitted.length).toBe(1);await expect(page.getByRole('alert')).toBeVisible();
  const recover=page.getByRole('button',{name:'Recover submission'});if(await recover.isVisible())await recover.click();
  await expect.poll(()=>jobs.length).toBe(1);expect(new Set(submitted.map(j=>j.id)).size).toBe(1);expect(await page.evaluate(()=>(window as any).chatCalls)).toBe(1);
});
test('uploaded image, custom length, errors and settings survive closing',async({page})=>{
  const {submitted}=await setup(page);
  await page.getByLabel('Your action').fill('A sailing boat');await page.getByRole('button',{name:'Video settings and clips'}).click();
  await page.getByLabel('Upload starting image').setInputFiles({name:'boat.png',mimeType:'image/png',buffer:Buffer.from('test-image')});
  await expect(page.getByText('boat.png',{exact:true})).toBeVisible();await page.getByLabel('Duration in seconds',{exact:false}).fill('60');
  await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'Video',exact:true}).click();
  await expect.poll(()=>submitted.length).toBe(1);expect(submitted[0].imageId).toBe('uploaded-start');expect(submitted[0].duration).toBe(60);
  await page.getByRole('button',{name:'Cancel clip'}).click();await expect(page.getByText('cancelled',{exact:true})).toBeVisible();
  await page.getByLabel('Duration in seconds',{exact:false}).fill('226');await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'Video',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('225');expect(submitted.length).toBe(1);
});
for(const width of [320,390,1440])test(`video controls fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await setup(page);
  await expect(page.getByRole('button',{name:'Video',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole('button',{name:'Video settings and clips'}).click();
  await page.screenshot({path:`docs/screenshots/video-studio-${width}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
