// @vitest-environment jsdom
import {act,createElement,type ComponentProps} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {MicButton} from '../src/client/MicButton.tsx'
import {zh,type VoiceKey} from '../src/client/locales.ts'

const media=vi.hoisted(()=>({start:vi.fn(),finish:vi.fn(),stop:vi.fn(),stt:vi.fn()}))
vi.mock('../src/client/voice/recorder.ts',()=>({MicRecorder:class{start=media.start;finish=media.finish;stop=media.stop}}))
vi.mock('../src/client/bridge.ts',()=>({stt:media.stt}))
vi.mock('../src/client/ReferenceIcons.tsx',()=>({ReferenceMicrophoneIcon:()=>null}))
describe('recording confirmation and explicit safe retry',()=>{
  let root:Root,host:HTMLDivElement,send:ReturnType<typeof vi.fn>,unavailable:boolean
  const props=()=>({t:(key:VoiceKey)=>zh[key],sessionId:'session',sendText:send,interruptReply:vi.fn(),unavailable,onCheck:vi.fn()}) as unknown as ComponentProps<typeof MicButton>
  const render=async()=>{await act(async()=>root.render(createElement(MicButton,props())))}
  beforeEach(()=>{
    (globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
    host=document.createElement('div');document.body.append(host);root=createRoot(host);unavailable=false
    media.start.mockReset().mockResolvedValue(undefined);media.finish.mockReset().mockResolvedValue(new ArrayBuffer(4));media.stop.mockReset();media.stt.mockReset().mockResolvedValue({text:'请整理这次文件'})
    send=vi.fn().mockResolvedValue(undefined)
  })
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
  it('requires transcript confirmation, serializes double clicks and keeps failed text for explicit retry',async()=>{
    await render()
    await act(async()=>{const start=host.querySelector<HTMLElement>('[data-voice-phase]')!;start.click();start.click()})
    expect(media.start).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled()
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-voice-stop]')!.click())
    expect(media.stt).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();expect(host.querySelector('textarea')?.value).toBe('请整理这次文件')
    let reject:(error:Error)=>void=()=>{};send.mockImplementationOnce(()=>new Promise((_yes,no)=>{reject=no}))
    await act(async()=>{const button=host.querySelector<HTMLButtonElement>('[data-voice-send]')!;button.click();button.click()});expect(send).toHaveBeenCalledTimes(1)
    await act(async()=>reject(Error('BUDGET_LIMIT secret D:/private')))
    expect(host.querySelector('textarea')?.value).toBe('请整理这次文件');expect(host.textContent).toContain(zh['mic.sendFailed']);expect(host.textContent).not.toContain('secret')
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-voice-send]')!.click());expect(send).toHaveBeenCalledTimes(2);expect(host.querySelector('textarea')).toBeNull()
  })
  it('shows a microphone permission action without leaking raw browser errors',async()=>{
    media.start.mockRejectedValueOnce(Object.assign(Error('private path token'),{name:'NotAllowedError'}))
    await render();await act(async()=>host.querySelector<HTMLElement>('[data-voice-phase]')!.click())
    expect(host.textContent).toContain(zh['mic.permissionError']);expect(host.textContent).not.toContain('private path');expect(send).not.toHaveBeenCalled()
  })
  it('does not capture audio when a known service/GPU/model check is blocked',async()=>{
    unavailable=true;await render();await act(async()=>host.querySelector<HTMLElement>('[data-voice-phase]')!.click())
    expect(media.start).not.toHaveBeenCalled();expect(media.stt).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(host.textContent).toContain(zh['mic.blocked'])
  })
})
