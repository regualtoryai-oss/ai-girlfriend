// @vitest-environment jsdom
import {act,createElement,type ComponentProps} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ReplySpeakerMount} from '../src/client/voice/reply-listener.tsx';

const bridge=vi.hoisted(()=>({tts:vi.fn(),dhStatus:vi.fn(),dhSpeak:vi.fn(),dhDiscard:vi.fn()}));
vi.mock('../src/client/bridge.ts',()=>({...bridge,DH_CHANGE_EVENT:'test-dh-change'}));
vi.mock('../src/client/DigitalHumanToggle.tsx',()=>({readDigitalHuman:()=>false}));
type Node={kind:string,key:string,anchorSeq:number,data:unknown};
const user=(anchor:number):Node=>({kind:'user',key:'u'+anchor,anchorSeq:anchor,data:{}});
const reply=(anchor:number,status:string,text='A complete reply!'):Node=>({kind:'assistant-step',key:'a'+anchor,anchorSeq:anchor,data:{status,blocks:[{kind:'text',text}]}});

describe('current reply delivery lifecycle',()=>{
 let root:Root|undefined,host:HTMLDivElement,nodes:Node[],running:boolean,revision:number;
 let interrupt:(()=>void)|null,active:AbortController|null,voiceReady:boolean;
 const speaker={speak:vi.fn(),stop:vi.fn()};
 const useChat=<T,>(selector:(state:{nodes:{values:()=>Node[]}})=>T)=>selector({nodes:{values:()=>nodes}});
 const useSession=<T,>(selector:(state:{running:boolean})=>T)=>selector({running});
 const registerInterrupt=(value:(()=>void)|null)=>{interrupt=value;};
 const registerTts=(value:AbortController|null)=>{active=value;};
 const props=()=>({useChat,useSession,speaker,canReadVoice:()=>voiceReady,_registerTtsAbort:registerTts,_registerInterruptHandler:registerInterrupt,revision:++revision}) as unknown as ComponentProps<typeof ReplySpeakerMount>;
 const render=async()=>{await act(async()=>{root!.render(createElement(ReplySpeakerMount,props()));});};
 beforeEach(()=>{
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  nodes=[];running=false;revision=0;interrupt=null;active=null;voiceReady=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  localStorage.clear();vi.clearAllMocks();bridge.dhStatus.mockResolvedValue({enabled:false});bridge.tts.mockResolvedValue(new ArrayBuffer(4));
 });
 afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();});
 it('does not replay asynchronously loaded historical replies, then speaks a fresh live turn',async()=>{
  await render();
  nodes=[user(1),reply(2,'settled','Historical private-looking synthetic text.')];await render();
  expect(bridge.tts).not.toHaveBeenCalled();expect(speaker.speak).not.toHaveBeenCalled();
  nodes=[...nodes,user(3),reply(4,'running','Fresh live answer!')];running=true;await render();
  expect(bridge.tts).toHaveBeenCalledTimes(1);expect(speaker.speak).toHaveBeenCalledTimes(1);
 });
 it('aborts interrupted TTS, discards a late response and allows the next user turn',async()=>{
  let finish:((bytes:ArrayBuffer)=>void)|undefined;
  bridge.tts.mockImplementationOnce(()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;}));
  nodes=[user(1),reply(2,'settled')];await render();
  nodes=[...nodes,user(3),reply(4,'running')];running=true;await render();
  const oldSignal=active!.signal;expect(oldSignal.aborted).toBe(false);
  await act(async()=>{interrupt!();});expect(oldSignal.aborted).toBe(true);
  await act(async()=>{finish!(new ArrayBuffer(4));});expect(speaker.speak).not.toHaveBeenCalled();
  nodes=[user(1),reply(2,'settled'),user(3),reply(4,'settled','Old late ending.')];running=false;await render();
  expect(bridge.tts).toHaveBeenCalledTimes(1);
  nodes=[...nodes,user(5),reply(6,'running','New user answer!')];running=true;await render();
  expect(bridge.tts).toHaveBeenCalledTimes(2);expect(speaker.speak).toHaveBeenCalledTimes(1);
 });
 it('unmount aborts pending synthesis and prevents late playback',async()=>{
  let finish:((bytes:ArrayBuffer)=>void)|undefined;
  bridge.tts.mockImplementationOnce(()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;}));
  nodes=[user(1),reply(2,'running')];running=true;await render();
  const signal=active!.signal;
  await act(async()=>root!.unmount());root=undefined;
  expect(signal.aborted).toBe(true);expect(speaker.stop).toHaveBeenCalledTimes(1);
  await act(async()=>{finish!(new ArrayBuffer(4));});expect(speaker.speak).not.toHaveBeenCalled();
 });
 it('blocks cold/unavailable voice and only resumes for a new user turn after a read-only recovery',async()=>{
  voiceReady=false;nodes=[user(1),reply(2,'running','Do not synthesize this turn!')];running=true;await render();
  expect(bridge.tts).not.toHaveBeenCalled();expect(speaker.speak).not.toHaveBeenCalled();
  voiceReady=true;nodes=[user(1),reply(2,'settled','Do not replay this completed turn.')];running=false;await render();
  expect(bridge.tts).not.toHaveBeenCalled();expect(speaker.speak).not.toHaveBeenCalled();
  nodes=[...nodes,user(3),reply(4,'running','A new authorized reply!')];running=true;await render();
  expect(bridge.tts).toHaveBeenCalledTimes(1);expect(speaker.speak).toHaveBeenCalledTimes(1);
 });
});
