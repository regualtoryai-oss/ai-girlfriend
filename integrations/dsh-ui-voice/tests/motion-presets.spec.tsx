// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMotion } from '../src/client/voice/motion-state.ts'
import { PresetMotion } from '../src/client/voice/PresetMotion.tsx'

describe('cached visual lifecycle', () => {
  const idle = {mic:'idle' as const,speaking:false,preparing:false,running:false,failed:false,settled:false}
  it('uses recording, synthesis, playback and task facts without inventing success', () => {
    expect(resolveMotion(idle)).toBe('idle')
    expect(resolveMotion({...idle,mic:'listening',speaking:true})).toBe('listening')
    expect(resolveMotion({...idle,mic:'transcribing'})).toBe('thinking')
    expect(resolveMotion({...idle,preparing:true})).toBe('thinking')
    expect(resolveMotion({...idle,speaking:true,running:true})).toBe('speaking')
    expect(resolveMotion({...idle,running:true})).toBe('thinking')
    expect(resolveMotion({...idle,settled:true})).toBe('smile')
    expect(resolveMotion({...idle,settled:true,failed:true})).toBe('idle')
    expect(resolveMotion({...idle,mic:'error'})).toBe('idle')
  })
  let host:HTMLDivElement,root:Root
  beforeEach(()=>{
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
    host=document.createElement('div');document.body.append(host);root=createRoot(host)
    vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})
  })
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
  const props={base:'http://127.0.0.1:8765/media/task-videos/presets-v1',paused:false,visible:true,failureLabel:'Motion failed; still retained',portraitLabel:'Xiaowan'}
  it('keeps a poster, mutes every clip and replaces speaking on interruption',async()=>{
    await act(async()=>root.render(<PresetMotion {...props} state="speaking"/>))
    expect(host.querySelectorAll('video')).toHaveLength(6)
    expect([...host.querySelectorAll('video')].every(v=>v.muted)).toBe(true)
    expect(host.querySelector('img')?.alt).toBe('Xiaowan')
    expect(host.querySelector('[data-motion-player]')?.getAttribute('data-motion-shown')).toBe('speaking')
    await act(async()=>root.render(<PresetMotion {...props} state="listening"/>))
    expect(host.querySelector('[data-motion-player]')?.getAttribute('data-motion-state')).toBe('listening')
    expect(host.querySelector('[data-motion-player]')?.getAttribute('data-motion-shown')).toBe('quiet')
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    await act(async()=>root.render(<PresetMotion {...props} state="idle" paused/>))
    expect(host.querySelector('[data-motion-player]')?.getAttribute('data-motion-shown')).toBe('poster')
  })
  it('falls back visibly on playback failure without removing conversation',async()=>{
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('decode unavailable'))
    await act(async()=>root.render(<PresetMotion {...props} state="idle"/>))
    expect(host.querySelector('[role=status]')?.textContent).toBe(props.failureLabel)
    expect(host.querySelector('[data-motion-player]')?.getAttribute('data-motion-shown')).toBe('poster')
  })
})
