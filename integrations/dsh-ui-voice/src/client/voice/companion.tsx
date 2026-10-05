/** The existing voice plugin projects session/voice facts onto cached motion. */
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { bridgeBase } from '../bridge.ts'
import type { VoiceInjected } from '../contract.ts'
import { resolveMotion, type MicPhase } from './motion-state.ts'
import { PresetMotion } from './PresetMotion.tsx'
import css from './CompanionWindow.module.css'

export type CompanionWindowProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'voice'> & VoiceInjected & {
  micPhase: MicPhase; speaking: boolean; preparing: boolean; interrupted: number; paused: boolean; scene: boolean
}

/** No model request or audio playback is issued by this visual component. */
export const CompanionWindow = memo(function CompanionWindow({companion, t, useSession, sessionId, micPhase, speaking, preparing, interrupted, paused, scene}: CompanionWindowProps) {
  const session = useSession(s => s)
  const [visible, setVisible] = useState(companion.visible)
  const [settled, setSettled] = useState(false)
  const previous = useRef({speaking, interrupted})
  useEffect(() => companion.subscribe(() => setVisible(companion.visible)), [companion])
  useEffect(() => {
    const before = previous.current
    previous.current = {speaking, interrupted}
    if (before.interrupted !== interrupted || speaking || micPhase !== 'idle' || session.running) {
      setSettled(false)
      return
    }
    if (before.speaking && !speaking) {
      setSettled(true)
      const timer = setTimeout(() => setSettled(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [speaking, interrupted, micPhase, session.running, sessionId])
  const state = resolveMotion({mic: micPhase, speaking, preparing, running: session.running || session.pendingSubmissions.length > 0, failed: !!session.lastAgentError, settled})
  return createPortal(<div className={css.stage} data-companion-portrait hidden={!visible}>
    <PresetMotion state={state} base={`${bridgeBase()}/media/task-videos/investor-preview-v1`} paused={paused} visible={visible && scene}
      failureLabel={t('stage.motionFailed')} portraitLabel={t('stage.portrait')} />
  </div>, document.body)
})
