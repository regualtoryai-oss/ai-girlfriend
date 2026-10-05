/** Muted action presets with a gentle real-video continuation; not lip sync. */
import { useEffect, useRef, useState } from 'react'
import type { MotionState } from './motion-state.ts'
import css from './CompanionWindow.module.css'
type Clip = MotionState | 'quiet'
const clips: readonly Clip[] = ['idle', 'listening', 'thinking', 'speaking', 'smile', 'quiet']
interface Props { state: MotionState; base: string; paused: boolean; visible: boolean; failureLabel: string; portraitLabel: string }
export function PresetMotion({state, base, paused, visible, failureLabel, portraitLabel}: Props) {
 const videos = useRef<Partial<Record<Clip, HTMLVideoElement>>>({})
 const [shown, setShown] = useState<Clip | null>(null)
 const [failed, setFailed] = useState(false)
 const generation = useRef(0)
 const lastGesture = useRef(-Infinity)
 useEffect(() => {
  const id=++generation.current
  const cleanups: (() => void)[]=[]
  for (const v of Object.values(videos.current)) v.pause()
  if (paused || !visible) {setShown(null);return}
  setFailed(false)
  const play=(clip:Clip) => {
   if (generation.current!==id) return
   const v=videos.current[clip];if(!v)return
   const timer=setTimeout(()=>{if(generation.current===id){setFailed(true);setShown(null);v.pause()}},5000)
   cleanups.push(()=>clearTimeout(timer))
   const reveal=()=>{if(generation.current!==id)return;clearTimeout(timer);setShown(clip);for(const [key,other] of Object.entries(videos.current))if(key!==clip)other.pause()}
   if(v.readyState>=1)v.currentTime=0
   v.muted=true
   void v.play().then(()=>{if(generation.current!==id){v.pause();return}if('requestVideoFrameCallback' in v){const f=v.requestVideoFrameCallback(reveal);cleanups.push(()=>v.cancelVideoFrameCallback(f))}else reveal()}).catch(()=>{clearTimeout(timer);if(generation.current===id){setFailed(true);setShown(null)}})
   if(clip!=='quiet'){const ended=()=>play('quiet');v.addEventListener('ended',ended,{once:true});cleanups.push(()=>v.removeEventListener('ended',ended))}
  }
  // Large gestures have one shared cooldown across sentence / task-state changes.
  const gesture=(state==='speaking'||state==='listening')&&performance.now()-lastGesture.current>=20000
  if(gesture)lastGesture.current=performance.now()
  play(gesture?state:'quiet')
  return()=>{generation.current++;for(const clean of cleanups)clean();for(const v of Object.values(videos.current))v.pause()}
 },[state,base,paused,visible])
 return <div className={css.player} data-motion-player data-motion-state={state} data-motion-shown={shown??'poster'} data-motion-paused={paused||undefined}>
  <div className={css.ambience} style={{backgroundImage:`url(${base}/poster.jpg)`}} aria-hidden="true"/>
  <img className={css.portrait} src={`${base}/poster.jpg`} alt={portraitLabel}/>
  {clips.map(key=><video key={key} ref={node=>{if(node)videos.current[key]=node;else delete videos.current[key]}} className={css.motion} data-motion-clip={key} data-active={shown===key||undefined} src={`${base}/${key === 'quiet' ? 'quiet-v2' : key}.mp4`} muted loop={key==='quiet'} playsInline preload="auto" aria-hidden="true" tabIndex={-1} onError={()=>{if(shown===key){setFailed(true);setShown(null)}}}/>)}
  {failed&&<p className={css.failure} role="status">{failureLabel}</p>}
 </div>
}
