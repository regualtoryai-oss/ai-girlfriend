/** Isolated recorded-event test; no model or microphone requests. */
import {useState,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {ReplySpeakerMount} from '../src/client/voice/reply-listener.tsx'
import {ReplySpeaker} from '../src/client/voice/speaker.ts'
import {PresetMotion} from '../src/client/voice/PresetMotion.tsx'
import {resolveMotion} from '../src/client/voice/motion-state.ts'
let nodes:any[]=[],running=false,mount=0,update:()=>void=()=>{},handler:(()=>void)|null=null,abort:AbortController|null=null
const speaker=new ReplySpeaker();const useChat=(f:any)=>f({nodes:{values:()=>nodes}});const useSession=(f:any)=>f({running})
const register=(v:AbortController|null)=>{abort=v;speaker.preparing=!!v};const onInterrupt=(v:(()=>void)|null)=>{handler=v}
function App(){const [revision,set]=useState(0);update=()=>set(x=>x+1);useEffect(()=>speaker.subscribe(()=>set(x=>x+1)),[]);const state=resolveMotion({mic:'idle',speaking:speaker.speaking,preparing:speaker.preparing,running,failed:false,settled:false});return <><ReplySpeakerMount {...({useChat,useSession,speaker,_registerTtsAbort:register,_registerInterruptHandler:onInterrupt,revision} as any)} key={mount}/><PresetMotion state={state} base="http://127.0.0.1:8765/media/task-videos/investor-preview-v1" visible paused={false} failureLabel="failed" portraitLabel="AI"/><button id="unlock" onClick={()=>speaker.unlock()}>Enable playback</button></>}
createRoot(document.getElementById('fixture')!).render(<App/>);
const assistant=(anchor:number,text:string,status='settled')=>({kind:'assistant-step',key:'a'+anchor,anchorSeq:anchor,data:{status,blocks:[{kind:'text',text}]}})
Object.assign(window,{coreQA:{
 set(input:any){nodes=input.nodes;running=input.running;update()},
 first(){nodes=[{kind:'user',key:'u1',anchorSeq:1,data:{}},assistant(2,'收到。我来处理。工具中间内容。','running')];running=true;update()},
 intermediate(){nodes=[...nodes,assistant(3,'中间步骤不应播报。')];update()},
 final(){nodes=[...nodes,assistant(4,'页面已完成。')];running=false;update()},
 interrupt(){speaker.stop();abort?.abort();handler?.()},
 reopen(){mount++;update()},
 next(){nodes=[...nodes,{kind:'user',key:'u5',anchorSeq:5,data:{}},assistant(6,'可以继续。','running')];running=true;update()},
 replayLong(){fetch('http://127.0.0.1:8765/media/task-videos/investor-preview-v1/ack.wav').then(x=>x.arrayBuffer()).then(x=>{const copies=[x.slice(0),x.slice(0),x.slice(0)];for(const wav of copies)speaker.speak(wav)})},
 invalid(){speaker.speak(new ArrayBuffer(3))},
 status(){return {speaking:speaker.speaking,error:speaker.error,preparing:speaker.preparing,motion:document.querySelector('[data-motion-player]')?.getAttribute('data-motion-state'),shown:document.querySelector('[data-motion-player]')?.getAttribute('data-motion-shown'),quietTime:document.querySelector<HTMLVideoElement>('[data-motion-clip=quiet]')?.currentTime}},
}})
