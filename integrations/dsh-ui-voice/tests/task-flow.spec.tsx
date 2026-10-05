// @vitest-environment jsdom
import {act, createElement, type ComponentProps} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SceneTaskPanel} from '../src/client/SceneTaskPanel.tsx'
import {ReadinessStatus} from '../src/client/ReadinessStatus.tsx'
import {parseProductReadiness, useProductReadiness, type ReadinessCheck} from '../src/client/product-readiness.ts'
import {zh, type VoiceKey} from '../src/client/locales.ts'
import {stt, tts, bridgeBase, bridgeConfigurationValid} from '../src/client/bridge.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({IconCloseOutline16: () => null}))
const translate = (key: VoiceKey) => zh[key]
const sha = 'a'.repeat(64), secondSha = 'b'.repeat(64)
const result = (path: string, hash = sha) => ({op:'create', path, bytes:12, sha256:hash})
const fileTool = (key: string, turn: number, results: unknown[], reason='completed') => ({
  kind:'tool-call', key, visibility:'visible', location:{turn:{turn,status:'settled',end:{data:{reason:{kind:reason}}}}},
  data:{root:{kind:'tool-result',call:{name:'companion_apply_changes'},isError:false,content:[{type:'text',text:JSON.stringify({status:'completed',results})}]}},
})
const readyPayload = {status:'ready',host:{ready:true},configuration:{relayConfigured:true,jevConfigured:true,budgetAuthorized:true,pricesVerified:true,budgetAvailable:true,forwardAuthorized:true},voice:{status:'ready',stt:false,tts:false},issues:[]}
const check = {status:'ready',data:parseProductReadiness(readyPayload),checking:false,refresh:vi.fn(),recovering:false,recoverVoice:vi.fn(),recoveryFailed:false} as ReadinessCheck

describe('current-session task panel and safe connections', () => {
  let host: HTMLDivElement, root: Root, nodes: unknown[], running: boolean, pendingKind: string | undefined, lastAgentError: string | null
  let fetchMock: ReturnType<typeof vi.fn>, open: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn>
  const props = () => ({sessionId:'current-session',t:translate,check,openArtifact:open,cancelTask:cancel,onConversation:vi.fn(),onSupplement:vi.fn(),
    useChat:(selector:(value:unknown)=>unknown)=>selector({nodes:{values:()=>nodes}}),
    useSession:(selector:(value:unknown)=>unknown)=>selector({running,pendingSubmissions:[],lastAgentError}),
    useSessionPendingInteraction:(selector:(value:unknown)=>unknown)=>selector(new Map(pendingKind ? [['current-session',{kind:pendingKind}]] : [])),
  }) as unknown as ComponentProps<typeof SceneTaskPanel>
  const render = async () => {await act(async()=>root.render(createElement(SceneTaskPanel,props())))}
  const click = async (element: Element) => {await act(async()=>element.dispatchEvent(new MouseEvent('click',{bubbles:true})))}
  beforeEach(() => {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
    host=document.createElement('div');document.body.append(host);root=createRoot(host)
    nodes=[];running=false;pendingKind=undefined;lastAgentError=null
    fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({artifacts:[]})});vi.stubGlobal('fetch',fetchMock)
    open=vi.fn().mockResolvedValue(undefined);cancel=vi.fn().mockResolvedValue(undefined);localStorage.clear()
  })
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
  it('shows a real empty state without requesting or inventing outputs', async()=>{
    await render();expect(host.textContent).toContain(zh['task.empty']);expect(fetchMock).not.toHaveBeenCalled()
    expect(host.querySelector('a[download]')).toBeNull();expect(open).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled()
  })
  it('retains earlier current-turn proofs and offers only matching authenticated downloads',async()=>{
    nodes=[fileTool('old',1,[result('old.txt')]),fileTool('first',2,[result('folder/first.txt')]),fileTool('second',2,[result('second.txt',secondSha)])]
    fetchMock.mockResolvedValue({ok:true,json:async()=>({artifacts:[{...result('folder/first.txt'),name:'first.txt'},{...result('second.txt',sha),name:'second.txt'},result('unrelated.txt')]})})
    await render()
    expect(host.textContent).toContain('first.txt');expect(host.textContent).toContain('second.txt');expect(host.textContent).not.toContain('old.txt');expect(host.textContent).not.toContain('unrelated.txt')
    const links=host.querySelectorAll('a[download]');expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('href')).toBe('/api/companion/artifacts/download?path=folder%2Ffirst.txt')
    expect(fetchMock).toHaveBeenCalledWith('/api/companion/artifacts',expect.objectContaining({credentials:'same-origin',cache:'no-store'}))
  })
  it('explains blocked/error turns and leaves approval decisions with the native owner',async()=>{
    nodes=[fileTool('blocked',2,[],'blocked')];await render();expect(host.textContent).toContain(zh['task.blockedHint'])
    lastAgentError='secret-token at D:/private/provider.json';await render()
    expect(host.textContent).toContain(zh['task.errorHint']);expect(host.textContent).not.toContain('secret-token');expect(host.textContent).not.toContain('D:/private')
    pendingKind='approval';await render();expect(host.textContent).toContain(zh['task.approvalHint'])
    expect(open).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled()
  })
  it('serializes explicit open attempts and exposes a safe failure before manual retry',async()=>{
    nodes=[fileTool('first',1,[result('first.txt')])]
    let reject:(error:Error)=>void=()=>{};open.mockImplementationOnce(()=>new Promise((_resolve,no)=>{reject=no}))
    await render();const button=()=>[...host.querySelectorAll('button')].find(item=>item.textContent===zh['task.artifact'])!
    await act(async()=>{button().click();button().click()});expect(open).toHaveBeenCalledTimes(1)
    await act(async()=>reject(Error('token=secret D:/private')))
    expect(host.textContent).toContain(zh['task.openFailed']);expect(host.textContent).not.toContain('token=secret')
    await click(button());expect(open).toHaveBeenCalledTimes(2)
  })
  it('rechecks artifact proofs only by GET, and a changed file loses its download',async()=>{
    nodes=[fileTool('first',1,[result('first.txt')])]
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({artifacts:[result('first.txt')]})})
    await render();expect(host.querySelectorAll('a[download]')).toHaveLength(1)
    let resolve:(value:unknown)=>void=()=>{};fetchMock.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes}))
    const verify=[...host.querySelectorAll('button')].find(item=>item.textContent===zh['task.verify'])!
    await act(async()=>{verify.click();verify.click()});expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async()=>resolve({ok:true,json:async()=>({artifacts:[result('first.txt',secondSha)]})}))
    expect(host.querySelector('a[download]')).toBeNull();expect(host.textContent).toContain(zh['task.changed'])
    expect(open).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled()
  })
  it('keeps readable GPU/model guidance local and never renders raw diagnostic fields',()=>{
    const parsed=parseProductReadiness({...readyPayload,status:'blocked',voice:{status:'blocked',code:'GPU_UNAVAILABLE',readiness:{status:'blocked',code:'VOICE_MODEL_MISSING'}},issues:[{code:'GPU_UNAVAILABLE',message:'D:/private token=secret',action:'send key'}]})
    expect(parsed.voiceBlocked).toBe(true);expect(parsed.issues).toContain('gpu');expect(parsed.issues).toContain('models');expect(JSON.stringify(parsed)).not.toContain('secret')
  })
  it('supports explicit read-only recovery without changing the reading preference or making speech calls',async()=>{
    localStorage.setItem('s2s.voice.enabled','0')
    const blocked={...readyPayload,status:'blocked',voice:{status:'blocked',code:'GPU_UNAVAILABLE',stt:false,tts:false}}
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>blocked})
    function Fixture(){const status=useProductReadiness();return <ReadinessStatus {...({t:translate,check:status} as ComponentProps<typeof ReadinessStatus>)}/>}
    await act(async()=>root.render(<Fixture/>));expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain(zh['health.gpu'])
    let resolve:(value:unknown)=>void=()=>{};fetchMock.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes})).mockResolvedValueOnce({ok:true,json:async()=>readyPayload})
    const recover=[...host.querySelectorAll('button')].find(item=>item.textContent===zh['health.recover'])!
    await act(async()=>{recover.click();recover.click()});expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async()=>resolve({ok:true}));expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(['/api/companion/readiness','/api/companion/voice/recheck','/api/companion/readiness'])
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({method:'POST',credentials:'same-origin'})
    expect(localStorage.getItem('s2s.voice.enabled')).toBe('0');expect(host.textContent).toContain(zh['health.voiceLazy'])
  })
  it('treats incomplete configuration and cold readiness as blocked, including hash verification',()=>{
    const pending=parseProductReadiness({...readyPayload,status:'ready',configuration:{},voice:{status:'unchecked',code:'READINESS_CHECK_PENDING',readiness:{status:'unchecked'}}})
    expect(pending.status).toBe('blocked');expect(pending.voiceBlocked).toBe(true)
    expect(pending.issues).toEqual(expect.arrayContaining(['relay','jev','budget','prices','funds','forward']))
    const mismatch=parseProductReadiness({...readyPayload,status:'blocked',voice:{status:'blocked',code:'MODEL_HASH_MISMATCH',readiness:{status:'blocked'}}})
    expect(mismatch.issues).toContain('models');expect(mismatch.voiceBlocked).toBe(true)
  })
  it.each(['https://attacker.invalid','http://127.0.0.1:8765?token=secret','http://user:secret@127.0.0.1:8765','http://localhost:8765/path','http://localhost:8765/#secret','http://localhost'])('rejects recording and synthesis to an unsafe bridge override: %s',async address=>{
    localStorage.setItem('s2s.voice.bridge',address);expect(bridgeConfigurationValid()).toBe(false)
    await expect(stt(new ArrayBuffer(4))).rejects.toThrow('VOICE_BRIDGE_ADDRESS_INVALID');await expect(tts('test')).rejects.toThrow('VOICE_BRIDGE_ADDRESS_INVALID')
    expect(fetchMock).not.toHaveBeenCalled();expect(bridgeBase()).toBe('http://127.0.0.1:8765')
  })
})
