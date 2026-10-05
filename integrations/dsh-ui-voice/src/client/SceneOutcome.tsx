/** A compact projection of existing conversation facts; original approval UI owns decisions. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoiceInjected } from './contract.ts'
import { projectSceneTask, type SceneTaskNode, type SceneTaskState } from './scene-task.ts'
import css from './VoiceToolbar.module.css'

type Props = Pick<PropsRuntime<'conversation.input.dock'>, 'useChat' | 'useSession' | 'useSessionPendingInteraction' | 'sessionId'>
  & Pick<VoiceInjected, 'cancelTask' | 'openArtifact'> & PropsLocale<'voice'>
  & {onOpenResults: () => void; onSupplement: () => void}

function excerpt(text: string, limit: number): string {
  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > limit ? plain.slice(0, limit) + '…' : plain
}
const labels = {
  completed: 'stage.resultCompleted', notApproved: 'stage.resultNotApproved', read: 'stage.resultRead',
  error: 'task.error', returned: 'stage.resultReturned', running: 'task.running', executing: 'task.executing',
  stopping: 'task.stopping', approval: 'task.approval', waiting: 'task.waiting', cancelled: 'task.cancelled',
  interrupted: 'task.interrupted', blocked: 'task.blocked',
} as const satisfies Record<SceneTaskState, string>

export function SceneOutcome({useChat, useSession, useSessionPendingInteraction, sessionId, t, onOpenResults, onSupplement, cancelTask, openArtifact}: Props) {
  const chat = useChat(snapshot => snapshot)
  const session = useSession(snapshot => snapshot)
  const pending = useSessionPendingInteraction(snapshot => snapshot.get(sessionId))
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const stopPending = useRef(false)
  const openPending = useRef(false)
  const [actionError, setActionError] = useState<'task.cancelFailed' | 'task.openFailed' | null>(null)
  const task = projectSceneTask((chat?.nodes.values() ?? []) as readonly SceneTaskNode[], {
    running: session.running, submitting: session.pendingSubmissions.length > 0,
    pendingKind: pending?.kind, stopping, error: !!session.lastAgentError,
  })
  useEffect(() => { if (!session.running) { stopPending.current = false; setStopping(false) } }, [session.running])
  useEffect(() => { setActionError(null) }, [task.key])
  const assistant = task.current.filter(node => node.kind === 'assistant-step').at(-1)
  const data = assistant?.data as AssistantChatData | undefined
  const answer = (!session.running || task.turn?.status === 'open')
    ? data?.blocks.filter(block => block.kind === 'text').map(block => block.text).join(' ') ?? '' : ''
  const stop = async () => {
    if (stopPending.current || !session.running) return
    stopPending.current = true
    setActionError(null); setStopping(true)
    try { await cancelTask() } catch { stopPending.current = false; setStopping(false); setActionError('task.cancelFailed') }
  }
  const open = async (path: string) => {
    if (openPending.current) return
    openPending.current = true
    setActionError(null); setOpening(path)
    try { await openArtifact(path) } catch { setActionError('task.openFailed') } finally { openPending.current = false; setOpening(null) }
  }
  return <>
    {task.state && (task.active || dismissed !== task.key) && <section className={css.result} data-scene-task-state={task.state} aria-label={t('stage.latestResult')}>
      <div className={css.resultHeading}><span role="status">{t(labels[task.state])}</span>{!task.active && <button onClick={() => setDismissed(task.key)} aria-label={t('stage.dismissResult')}><IconCloseOutline16 size={18} /></button>}</div>
      {!!task.summary?.filenames.length && <div className={css.resultSummary} title={task.summary.filenames.join(' · ')}>{excerpt(task.summary.filenames.join(' · '), 75)}</div>}
      <div className={css.taskActions}>
        <button onClick={onOpenResults}>{t('stage.view')}</button>
        {(session.running || task.state === 'cancelled') && <button disabled={!session.running || stopping} onClick={() => void stop()}>{t('task.cancel')}</button>}
        <button onClick={onSupplement}>{t('task.supplement')}</button>
      </div>
      {!!task.summary?.artifacts.length && <div className={css.taskArtifacts}>{task.summary.artifacts.map(file => <button key={file.path} disabled={opening !== null} title={file.path} onClick={() => void open(file.path)}>{t(opening === file.path ? 'task.opening' : 'task.artifact')} · {file.name}</button>)}</div>}
      {actionError && <p className={css.taskActionError} role="alert">{t(actionError)}</p>}
    </section>}
    {answer.trim() && <p className={css.subtitle} title={answer} aria-label={t('stage.lastReply')}>{excerpt(answer, 130)}</p>}
  </>
}
