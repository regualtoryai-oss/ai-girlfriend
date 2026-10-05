/** Voice-first controls reuse the author's existing recorder, confirmations and speaker. */
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VoiceInjected } from './contract.ts'
import { FileAudioButton } from './FileAudioButton.tsx'
import { MicButton } from './MicButton.tsx'
import { VoiceToggle } from './VoiceToggle.tsx'
import { BusyToggle } from './BusyToggle.tsx'
import { BridgeStatus } from './BridgeStatus.tsx'
import { PersonaToggle } from './PersonaToggle.tsx'
import css from './VoiceToolbar.module.css'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ReferenceKeyboardIcon } from './ReferenceIcons.tsx'
import { SceneOutcome } from './SceneOutcome.tsx'
import { CompanionWindow } from './voice/companion.tsx'
import type { MicPhase } from './voice/motion-state.ts'
import { SceneTaskPanel } from './SceneTaskPanel.tsx'
import { useProductReadiness } from './product-readiness.ts'

export type VoiceToolbarProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'voice'> & VoiceInjected

/** Keeps each recorder/player mounted exactly once when drawers open and close. */
export const VoiceToolbar = memo(function VoiceToolbar(props: VoiceToolbarProps) {
  const {t} = props
  const readiness = useProductReadiness()
  const voiceAvailable = readiness.data?.voiceBlocked === false
  useEffect(() => {props.setVoiceReady(voiceAvailable); return () => props.setVoiceReady(false)}, [voiceAvailable, props.setVoiceReady])
  const toolbarRef = useRef<HTMLElement>(null)
  const [scene, setScene] = useState(true)
  const [panel, setPanel] = useState('')
  const [micPhase, setMicPhase] = useState<MicPhase>('idle')
  const [fileBusy, setFileBusy] = useState(false)
  const [interrupted, setInterrupted] = useState(0)
  const [motionPaused, setMotionPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [preparing, setPreparing] = useState(props.speaker.preparing)
  const [audioError, setAudioError] = useState(props.speaker.error)
  const [speaking, setSpeaking] = useState(props.speaker.speaking)
  useEffect(() => props.speaker.subscribe(() => { setSpeaking(props.speaker.speaking); setPreparing(props.speaker.preparing); setAudioError(props.speaker.error) }), [props.speaker])
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setMotionPaused(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  const interruptReply = () => { setInterrupted(value => value + 1); props.interruptReply() }
  useEffect(() => {
    if (scene) { document.body.dataset.companionScene = 'true'; props.companion.visible = true }
    else delete document.body.dataset.companionScene
    document.body.dataset.companionPanel = panel
    return () => { delete document.body.dataset.companionScene; delete document.body.dataset.companionPanel }
  }, [scene, panel, props.companion])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel('') }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const measure = () => {
      const box = toolbar.getBoundingClientRect()
      const clearance = scene && box.height > 0 ? window.innerHeight - box.top + 12 : 28
      document.body.style.setProperty('--companion-toolbar-clearance', `${Math.ceil(clearance)}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      document.body.style.removeProperty('--companion-toolbar-clearance')
    }
  }, [scene])
  const toggle = (next: string) => {
    if (next === 'history' && panel !== 'history') props.expandSidebar()
    setPanel(current => current === next ? '' : next)
  }
  const micProps = props as unknown as React.ComponentProps<typeof MicButton>
  const voiceProps = props as unknown as React.ComponentProps<typeof VoiceToggle>
  const busyProps = props as unknown as React.ComponentProps<typeof BusyToggle>
  const personaProps = props as unknown as React.ComponentProps<typeof PersonaToggle>
  return <>
    <CompanionWindow {...props} micPhase={fileBusy ? 'transcribing' : micPhase} speaking={speaking} preparing={preparing} interrupted={interrupted} paused={motionPaused} scene={scene} />
    {createPortal(<nav className={css.navigation} aria-label={t('stage.navigation')}>
      <button className={css.brand} onClick={() => toggle('menu')} aria-expanded={panel === 'menu'}>{t('stage.name')}</button>
      <small className={css.disclosure}>{t('stage.disclosure')}</small>
      <div className={css.menu} hidden={panel !== 'menu'}>
        <button onClick={() => toggle('tasks')}>{t('stage.tasks')}</button>
        <button onClick={() => toggle('history')}>{t('stage.history')}</button>
        <button onClick={() => toggle('settings')}>{t('stage.settings')}</button>
        <button onClick={() => {setScene(!scene); setPanel('')}}>{t(scene ? 'stage.workbench' : 'stage.immersive')}</button>
      </div>
    </nav>, document.body)}
    <SceneOutcome key={props.sessionId} sessionId={props.sessionId} useChat={props.useChat}
      useSession={props.useSession} useSessionPendingInteraction={props.useSessionPendingInteraction}
      cancelTask={props.cancelTask} openArtifact={props.openArtifact} t={t}
      onOpenResults={() => setPanel('tasks')} onSupplement={() => setPanel('text')} />
    <section ref={toolbarRef} className={css.toolbar} data-voice-toolbar data-speaking={speaking || undefined} aria-label={t('stage.voiceControls')}>
      <div className={css.microphone}><MicButton {...micProps} onPhase={setMicPhase} interruptReply={interruptReply}
        unavailable={!voiceAvailable} onCheck={() => setPanel('settings')} /></div>
      <div className={css.state} role="status">
        <span className={css.idle}>{t('stage.ready')}</span>
        <span className={css.permission}>{t('stage.permission')}</span>
        <span className={css.running}>{t('stage.running')}</span>
        <span className={css.speaking}>{t('stage.speaking')}</span>
        <span className={css.listening}>{t('stage.listening')}</span>
        <span className={css.capturing}>{t('stage.capturing')}</span>
        <span className={css.transcribing}>{t('stage.transcribing')}</span>
        <span className={css.micError}>{t('stage.micError')}</span>
        <span className={css.confirming}>{t('stage.confirming')}</span>
        <span className={css.approval}>{t('stage.approval')}</span>
      </div>
      {audioError && <span role="alert">{t('health.audioFailed')}</span>}
      {speaking && <button className={css.stop} onClick={interruptReply}>{t('stage.stopVoice')}</button>}
    </section>
    <button className={css.typeTrigger} onClick={() => toggle('text')} aria-expanded={panel === 'text'}><ReferenceKeyboardIcon /><span>{t('stage.text')}</span></button>
    {panel && panel !== 'menu' && createPortal(<button className={css.closePanel} onClick={() => setPanel('')} aria-label={t('stage.closePanel')}><IconCloseOutline16 size={22} /></button>, document.body)}
    {panel === 'tasks' && <SceneTaskPanel key={props.sessionId} {...props} check={readiness}
      onConversation={() => {props.expandSidebar(); setPanel('history')}} onSupplement={() => setPanel('text')} />}
    <section className={css.settings} hidden={panel !== 'settings'} aria-label={t('stage.settings')}>
      <h2>{t('stage.settings')}</h2>
      <div className={css.reading}><VoiceToggle {...voiceProps} /><span>{t('stage.reading')}</span></div>
      <PersonaToggle {...personaProps} /><BusyToggle {...busyProps} />
      <FileAudioButton sendText={props.sendText} interruptReply={interruptReply} onBusy={setFileBusy} />
      <label><input type="checkbox" checked={motionPaused} onChange={event => setMotionPaused(event.target.checked)} />{t('stage.pauseMotion')}</label>
      <div className={css.health}><BridgeStatus t={t} check={readiness} /></div>
    </section>
  </>
})
