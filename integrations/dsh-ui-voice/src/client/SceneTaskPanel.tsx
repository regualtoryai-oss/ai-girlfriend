/** Current-session tasks reuse Harness facts and its original approval/file opening APIs. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { VoiceInjected } from './contract.ts'
import type { VoiceKey } from './locales.ts'
import { projectSceneTask, type SceneTaskNode, type SceneTaskState } from './scene-task.ts'
import { matchDownloadArtifacts } from './artifact-downloads.ts'
import { ReadinessStatus } from './ReadinessStatus.tsx'
import type { ReadinessCheck } from './product-readiness.ts'
import css from './VoiceToolbar.module.css'

type Props = Pick<PropsRuntime<'conversation.input.dock'>, 'useChat' | 'useSession' | 'useSessionPendingInteraction' | 'sessionId'>
  & Pick<VoiceInjected, 'cancelTask' | 'openArtifact'> & PropsLocale<'voice'>
  & {check: ReadinessCheck; onConversation: () => void; onSupplement: () => void}
const labels: Record<SceneTaskState, VoiceKey> = {
  completed: 'stage.resultCompleted', notApproved: 'stage.resultNotApproved', read: 'stage.resultRead', error: 'task.error',
  returned: 'stage.resultReturned', running: 'task.running', executing: 'task.executing', stopping: 'task.stopping',
  approval: 'task.approval', waiting: 'task.waiting', cancelled: 'task.cancelled', interrupted: 'task.interrupted', blocked: 'task.blocked',
}
export function SceneTaskPanel({useChat, useSession, useSessionPendingInteraction, sessionId, t, cancelTask, openArtifact, check, onConversation, onSupplement}: Props) {
  const chat = useChat(snapshot => snapshot)
  const session = useSession(snapshot => snapshot)
  const pending = useSessionPendingInteraction(snapshot => snapshot.get(sessionId))
  const [stopping, setStopping] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [actionError, setActionError] = useState<VoiceKey | null>(null)
  const stopPending = useRef(false), openPending = useRef(false)
  const task = projectSceneTask((chat?.nodes.values() ?? []) as readonly SceneTaskNode[], {
    running: session.running, submitting: session.pendingSubmissions.length > 0, pendingKind: pending?.kind, stopping, error: !!session.lastAgentError,
  })
  const proofKey = JSON.stringify(task.artifacts.map(file => [file.path, file.bytes, file.sha256]))
  const [downloads, setDownloads] = useState<Set<string>>(new Set())
  const [verifying, setVerifying] = useState(false)
  const [verifyFailed, setVerifyFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const verify = useCallback(async () => {
    if (request.current || !task.artifacts.length) return
    const controller = new AbortController(); request.current = controller
    setVerifying(true); setVerifyFailed(false); setDownloads(new Set())
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('/api/companion/artifacts', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
      if (!response.ok) throw Error('ARTIFACT_CHECK_FAILED')
      const verified = matchDownloadArtifacts(await response.json(), task.artifacts)
      if (request.current === controller && !controller.signal.aborted) setDownloads(verified)
    } catch {if (request.current === controller) setVerifyFailed(true)}
    finally {clearTimeout(timer); if (request.current === controller) {request.current = null; setVerifying(false)}}
  // The proof fingerprint owns this read; no prompt is submitted when it changes.
  }, [proofKey])
  useEffect(() => {setDownloads(new Set()); void verify(); return () => {request.current?.abort(); request.current = null}}, [verify])
  useEffect(() => {if (!session.running) {stopPending.current = false; setStopping(false)}}, [session.running])
  useEffect(() => {setActionError(null)}, [task.key])
  const stop = async () => {
    if (stopPending.current || !session.running) return
    stopPending.current = true; setStopping(true); setActionError(null)
    try {await cancelTask()} catch {stopPending.current = false; setStopping(false); setActionError('task.cancelFailed')}
  }
  const open = async (path: string) => {
    if (openPending.current) return
    openPending.current = true; setOpening(path); setActionError(null)
    try {await openArtifact(path)} catch {setActionError('task.openFailed')}
    finally {openPending.current = false; setOpening(null)}
  }
  return <section className={`${css.settings} ${css.taskPanel}`} data-scene-task-panel aria-label={t('stage.tasks')}>
    <h2>{t('stage.tasks')}</h2>
    {task.state ? <div data-task-panel-state={task.state}>
      <p role="status">{t(labels[task.state])}</p>
      {task.turn && <small>{t('task.turn')} {task.turn.turn}</small>}
      {task.state === 'approval' && <p>{t('task.approvalHint')}</p>}
      {task.state === 'blocked' && <p>{t('task.blockedHint')}</p>}
      {task.state === 'error' && <p>{t('task.errorHint')}</p>}
      {(task.state === 'cancelled' || task.state === 'interrupted') && <p>{t('task.stoppedHint')}</p>}
    </div> : <p>{t('task.empty')}</p>}
    <div className={css.panelActions}>
      <button type="button" onClick={onConversation}>{t('task.conversation')}</button>
      <button type="button" onClick={onSupplement}>{t('task.supplement')}</button>
      {session.running && <button type="button" disabled={stopping} onClick={() => void stop()}>{t(stopping ? 'task.stopping' : 'task.cancel')}</button>}
    </div>
    {task.artifacts.length ? <>
      <ul className={css.panelArtifacts}>{task.artifacts.map(file => <li key={file.path}>
        <strong>{file.name}</strong><small>{file.bytes} B · SHA-256 {file.sha256.slice(0, 12)}…</small>
        <div className={css.panelActions}><button type="button" disabled={opening !== null} onClick={() => void open(file.path)}>{t(opening === file.path ? 'task.opening' : 'task.artifact')}</button>
          {downloads.has(file.path) ? <a href={`/api/companion/artifacts/download?path=${encodeURIComponent(file.path)}`} download={file.name}>{t('task.download')}</a>
            : !verifying && <span>{t('task.changed')}</span>}
        </div>
      </li>)}</ul>
      <button type="button" disabled={verifying} onClick={() => void verify()}>{t(verifying ? 'task.verifying' : 'task.verify')}</button>
      <p className={css.panelNote}>{t('task.proof')}</p>
    </> : <p>{t('task.noArtifacts')}</p>}
    {verifyFailed && <p role="alert">{t('task.verifyFailed')}</p>}
    {actionError && <p role="alert">{t(actionError)}</p>}
    <ReadinessStatus t={t} check={check} />
  </section>
}
