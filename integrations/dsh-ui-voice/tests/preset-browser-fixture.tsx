/** Test-only fixture using production visual resolver, player and audio owner. */
import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {PresetMotion} from '../src/client/voice/PresetMotion.tsx'
import {resolveMotion, type MotionFacts} from '../src/client/voice/motion-state.ts'
import {ReplySpeaker} from '../src/client/voice/speaker.ts'
const audioEvidence:{state:string,clock:number,maxRms:number,channels:number}[]=[]
const NativeContext=window.AudioContext
class ObservedContext extends NativeContext {
  constructor(){super();const analyser=this.createAnalyser();analyser.fftSize=1024
    const original=this.createBufferSource.bind(this)
    this.createBufferSource=()=>{const node=original();node.connect(analyser);return node}
    const values=new Float32Array(analyser.fftSize);let maxRms=0
    const timer=setInterval(()=>{if(this.state==='closed'){clearInterval(timer);return}analyser.getFloatTimeDomainData(values);const rms=Math.sqrt(values.reduce((a,v)=>a+v*v,0)/values.length);maxRms=Math.max(maxRms,rms);audioEvidence.push({state:this.state,clock:this.currentTime,maxRms,channels:this.destination.channelCount})},50)
  }
}
Object.defineProperty(window,'AudioContext',{value:ObservedContext,configurable:true})
const speaker=new ReplySpeaker()
const base:MotionFacts={mic:'idle',speaking:false,preparing:false,running:false,failed:false,settled:false}
let setFacts:(f:MotionFacts)=>void=()=>{}
let cached:ArrayBuffer|undefined
let request:AbortController|undefined
function Fixture(){
 const [facts,set]=useState(base);setFacts=set
 const [,refresh]=useState(0)
 const [paused,setPaused]=useState(false)
 useEffect(()=>speaker.subscribe(()=>refresh(x=>x+1)),[])
 const state=resolveMotion({...facts,speaking:speaker.speaking,preparing:speaker.preparing})
 return <><div style={{position:'fixed',inset:0}}><PresetMotion state={state} base="http://127.0.0.1:8765/media/task-videos/presets-v1" paused={paused} visible failureLabel="Motion unavailable" portraitLabel="Xiaowan"/></div>
 <button id="pause-motion" style={{position:'fixed',zIndex:10}} onClick={()=>setPaused(!paused)}>Pause</button></>
}
createRoot(document.getElementById('fixture')!).render(<Fixture/>);
Object.assign(window,{motionQA:{
 set:(f:Partial<MotionFacts>)=>setFacts({...base,...f}),
 async tts(){request=new AbortController();speaker.preparing=true;const r=await fetch('http://127.0.0.1:8765/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:"你好呀😊，我在这里。我们一起把事情做好。"}),signal:request.signal});if(!r.ok)throw Error('TTS '+r.status);cached=await r.arrayBuffer();speaker.preparing=false;speaker.speak(cached.slice(0));return {bytes:cached.byteLength,status:r.status}},
 replay(){if(!cached)throw Error('No captured real TTS');speaker.speak(cached.slice(0))},
 interrupt(){request?.abort();speaker.stop();setFacts({...base,mic:'listening'})},
 status(){return {speaking:speaker.speaking,preparing:speaker.preparing,audio:audioEvidence.slice(-1)[0]}}
}})
