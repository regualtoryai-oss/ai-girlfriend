import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { stt } from './bridge.ts'
import type { VoiceInjected } from './contract.ts'
import { MicRecorder } from './voice/recorder.ts'
import css from './MicButton.module.css'
import { ReferenceMicrophoneIcon } from './ReferenceIcons.tsx'
import type { MicPhase } from './voice/motion-state.ts'

export type MicButtonProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'voice'> & VoiceInjected & {onPhase?: (phase: MicPhase) => void}
type Phase = 'idle' | 'starting' | 'listening' | 'transcribing' | 'ready' | 'error'

export const MicButton = memo(function MicButton({ t, sendText, interruptReply, sessionId, onPhase }: MicButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  useEffect(() => { onPhase?.(phase) }, [phase, onPhase])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const phaseRef = useRef<Phase>('idle')
  const recorderRef = useRef<MicRecorder | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const sendingRef = useRef(false)
  const changePhase = useCallback((value: Phase) => { phaseRef.current = value; setPhase(value) }, [])
  const release = useCallback(() => {
    generation.current++
    requestRef.current?.abort()
    requestRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
  }, [])
  const cancel = useCallback(() => {
    release()
    setDraft('')
    changePhase('idle')
  }, [release, changePhase])

  useEffect(() => {
    cancel()
    const leave = () => release()
    window.addEventListener('pagehide', leave)
    window.addEventListener('popstate', cancel)
    window.addEventListener('hashchange', cancel)
    return () => {
      release()
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('popstate', cancel)
      window.removeEventListener('hashchange', cancel)
    }
  }, [sessionId, cancel, release])

  const start = useCallback(async () => {
    if (sendingRef.current || phaseRef.current === 'starting' || phaseRef.current === 'listening' || phaseRef.current === 'transcribing') return
    release()
    const id = generation.current
    setDraft('')
    changePhase('starting')
    interruptReply()
    const recorder = new MicRecorder(() => {
      if (generation.current !== id) return
      release()
      changePhase('error')
    })
    recorderRef.current = recorder
    try {
      await recorder.start()
      if (generation.current !== id) { recorder.stop(); return }
      changePhase('listening')
    } catch {
      if (generation.current !== id) return
      recorderRef.current = null
      changePhase('error')
    }
  }, [release, changePhase, interruptReply])

  const stop = useCallback(async () => {
    if (phaseRef.current !== 'listening') { cancel(); return }
    const recorder = recorderRef.current
    if (!recorder) return
    const id = generation.current
    changePhase('transcribing')
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const pcm = await recorder.finish()
      if (generation.current !== id) return
      recorderRef.current = null
      if (!pcm.byteLength) { changePhase('idle'); return }
      const result = await stt(pcm, controller.signal, 300)
      if (generation.current !== id) return
      setDraft(result.text.trim())
      changePhase(result.text.trim() ? 'ready' : 'error')
    } catch {
      if (generation.current === id) changePhase('error')
    } finally {
      if (generation.current === id) requestRef.current = null
    }
  }, [cancel, changePhase])

  const send = useCallback(async () => {
    if (sendingRef.current || phaseRef.current !== 'ready' || !draft.trim()) return
    sendingRef.current = true
    setSending(true)
    const id = generation.current
    try {
      await sendText(draft.trim())
      if (generation.current === id) { setDraft(''); changePhase('idle') }
    } catch {
      // Keep the editable draft available for an explicit retry.
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [draft, sendText, changePhase])

  const busy = phase === 'starting' || phase === 'listening' || phase === 'transcribing'
  return <>
    <span role="button" tabIndex={sending ? -1 : 0} data-voice-phase={phase} data-voice-active={phase === 'listening' || undefined}
      className={css.mic} aria-label={t('mic.start')} title={t('mic.start')} aria-disabled={busy || sending}
      onClick={() => { void start() }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void start() } }}>
      <ReferenceMicrophoneIcon />
    </span>
    <div data-voice-controls style={{display: 'inline-flex', alignItems: 'center', gap: 10}}>
      <button type="button" data-voice-stop disabled={!busy || sending} onClick={() => { void stop() }}>{t('mic.stop')}</button>
      <button type="button" data-voice-send disabled={phase !== 'ready' || !draft.trim() || sending} onClick={() => { void send() }}>{t('mic.send')}</button>
    </div>
    {phase === 'ready' && <div data-voice-inline-draft style={{display: 'flex', alignItems: 'center', gap: 6, maxWidth: 'min(400px, 80vw)'}}>
      <textarea aria-label={t('mic.draft')} rows={2} value={draft} disabled={sending} onChange={event => setDraft(event.target.value)} style={{width: '100%', font: 'inherit'}} />
      <button type="button" aria-label={t('mic.discard')} title={t('mic.discard')} disabled={sending} onClick={cancel}>×</button>
    </div>}
  </>
})
