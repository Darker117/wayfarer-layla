import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../gateway/server.mjs';

test('PC Companion saves reusable code durations, reloads and deletes at phone and desktop widths',async({page})=>{
  const gateway=await createGateway({dataDir:await mkdtemp(join(tmpdir(),'wayfarer-companion-ui-')),noEvents:true,mcp:{call(){throw new Error('This UI test must not use a model.');},close(){}}});
  const listen=(server:any)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
  await listen(gateway.server);const url=await listen(gateway.pairingServer);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url);await expect(page.getByRole('heading',{name:'Wayfarer PC Companion'})).toBeVisible();
    await expect(page.getByLabel('Code works for')).toHaveValue('forever');
    await expect(page.getByText('Keep this desktop page private.',{exact:false})).toHaveCount(0);
    const first=page.waitForResponse(r=>r.url()===url+'/code'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Create code',exact:true}).click();const forever=await(await first).json();expect(forever.expires).toBeNull();
    await page.getByLabel('Code works for').selectOption('20');
    const second=page.waitForResponse(r=>r.url()===url+'/code'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Create code',exact:true}).click();const timed=await(await second).json();expect(timed.expires-timed.createdAt).toBe(20*60000);
    await page.reload();await expect(page.locator('.code-row')).toHaveCount(2);
    await expect(page.getByText(forever.code,{exact:true})).toBeVisible();
    for(const width of [320,390,960]){
      await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.getByRole('button',{name:'Create code',exact:true})).toBeInViewport();
      if(width===960)await page.screenshot({path:'docs/screenshots/pc-companion.png',fullPage:true});
    }
    await page.getByRole('button',{name:'Delete code '+timed.code,exact:true}).click();await expect(page.locator('.code-row')).toHaveCount(1);
    await page.reload();await expect(page.getByText(timed.code,{exact:true})).toHaveCount(0);await expect(page.getByText(forever.code,{exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  }finally{await gateway.close();}
});
