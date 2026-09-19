import { describe,it,expect } from 'vitest';
import { initialStore } from '../src/seeds';
import { startAdventure, snapshot, type Turn } from '../src/domain';
import { connectionUrl, defaultVideoPreferences, publicVideoText, videoContext, videoPrompt, parseVideoPlan, validateVideoDuration } from '../src/video';

const adventure = () => {
  const a = startAdventure(initialStore().scenarios[0]);
  a.memory='PRIVATE MEMORY'; a.cards[0] && (a.cards[0].fields.description='PRIVATE CARD'); a.state={secret:'PRIVATE STATE'};
  a.turns = ['do','say','think','story','continue','do'].map((mode,i)=>({id:String(i),mode,input:mode==='think'?'PRIVATE THOUGHT':`input${i}`,scriptInput:'PRIVATE SCRIPT',output:`Public scene ${i}`,before:snapshot(a),createdAt:i,logs:['PRIVATE LOG'],contextCards:[]} as Turn));
  return a;
};
describe('video public context boundary',()=>{
  it('uses the requested last completed turns and never internal fields',()=>{
    const a=adventure(); a.turns.push({...a.turns[0],id:'stopped',stopped:true,output:'SCRIPT STOP'});
    const one=videoContext(a,1),three=videoContext(a,3),six=videoContext(a,6);
    expect(one).toContain('Public scene 5');expect(one).not.toContain('Public scene 4');
    expect(three).toContain('Public scene 3');expect(three).not.toContain('Public scene 2');
    expect(six).toContain('Public scene 2');expect(six).toContain('Spoken dialogue: input1');expect(six).not.toMatch(/PRIVATE|SCRIPT STOP/);
  });
  it('excludes model reasoning even in legacy saved outputs',()=>{
    expect(publicVideoText('<think>PRIVATE</think>A boat.')).toBe('A boat.');
    expect(publicVideoText('A boat.<analysis>SECRET')).toBe('A boat.');
  });
  it('skips empty/script-only updates and never takes unsent private input',()=>{
    const a=adventure();a.turns.push({...a.turns[0],output:'>>> internal script message'});
    expect(videoContext(a,1)).toContain('Public scene 5');
  });
  it('uses entered scene as primary, with optional context/style only',()=>{
    const a=adventure(), prompt=videoPrompt('A swan takes flight',a,{...defaultVideoPreferences,style:'Watercolour',context:false});
    expect(prompt).toContain('Scene prompt (primary):\nA swan takes flight');expect(prompt).toContain('Watercolour');expect(prompt).not.toContain('Public scene');
    expect(()=>videoPrompt('<think>private</think>',a,defaultVideoPreferences)).toThrow('Write a scene');
  });
  it('does not mutate story data or attach video secrets to backup data',()=>{
    const a=adventure(), before=JSON.stringify(a);videoPrompt('A boat',a,defaultVideoPreferences);expect(JSON.stringify(a)).toBe(before);
  });
});
describe('video endpoint selection',()=>{
  it('permits private HTTPS and desktop loopback only',()=>{
    expect(connectionUrl('https://desktop.example.ts.net')).toBe('https://desktop.example.ts.net');
    expect(connectionUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    for(const url of ['http://192.168.1.2:8787','https://name:secret@example.com','https://example.com?token=secret','file:///tmp/a','https://example.com/admin']) expect(()=>connectionUrl(url)).toThrow();
  });
});
describe('AI video plans and arbitrary whole-second duration',()=>{
  it('accepts custom length without a 15 second cap and enforces the real node ceiling',()=>{
    for(const n of [1,5,16,30,60,225])expect(()=>validateVideoDuration(n)).not.toThrow();
    for(const n of [0,-1,1.5,226,Infinity,NaN,'30'])expect(()=>validateVideoDuration(n)).toThrow();
  });
  it('keeps prompt untouched when only the AI duration is requested',()=>{
    expect(parseVideoPlan('{"duration":30,"prompt":"unwanted rewrite"}','Original scene',{...defaultVideoPreferences,enhance:false,durationMode:'ai'})).toEqual({duration:30,prompt:'Original scene'});
  });
  it('rejects malformed plans, invalid lengths and nonstring enhanced prompts',()=>{
    for(const text of ['null','[]','{}','{"prompt":{}}','{"prompt":true}','{"prompt":"<think>secret</think>"}'])expect(()=>parseVideoPlan(text,'Original',defaultVideoPreferences)).toThrow();
    for(const duration of [0,226,'30',1.5])expect(()=>parseVideoPlan(JSON.stringify({duration,prompt:'A scene'}),'Original',{...defaultVideoPreferences,durationMode:'ai'})).toThrow();
  });
});
