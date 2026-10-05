/** Read-only product checks never send a prompt or invoke recognition/synthesis. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { bridgeConfigurationValid } from './bridge.ts'

export type ReadinessIssue = 'relay' | 'jev' | 'budget' | 'prices' | 'funds' | 'forward' | 'bridge' | 'bridgeAddress' | 'gpu' | 'models' | 'voice' | 'host'
export interface ProductReadiness {
  status: 'ready' | 'blocked'
  voiceBlocked: boolean
  stt: boolean
  tts: boolean
  issues: ReadinessIssue[]
}
export interface ReadinessCheck {
  status: 'checking' | 'ready' | 'blocked' | 'unavailable'
  data: ProductReadiness | null
  checking: boolean
  refresh: () => Promise<void>
  recovering: boolean
  recoverVoice: () => Promise<void>
  recoveryFailed: boolean
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
/** Display fixed local copy, never server exception text, paths or credentials. */
export function parseProductReadiness(value: unknown): ProductReadiness {
  const data = record(value)
  if (!data || !['ready', 'blocked'].includes(String(data.status))) throw Error('INVALID_READINESS')
  const configuration = record(data.configuration), voice = record(data.voice), readiness = record(voice?.readiness)
  if (!configuration || !voice) throw Error('INVALID_READINESS')
  const issues = new Set<ReadinessIssue>()
  if (!bridgeConfigurationValid()) issues.add('bridgeAddress')
  if (configuration.relayConfigured !== true) issues.add('relay')
  if (configuration.jevConfigured !== true) issues.add('jev')
  if (configuration.budgetAuthorized !== true) issues.add('budget')
  if (configuration.pricesVerified !== true) issues.add('prices')
  if (configuration.budgetAvailable !== true) issues.add('funds')
  if (configuration.forwardAuthorized !== true) issues.add('forward')
  if (record(data.host)?.ready !== true) issues.add('host')
  const codes = [voice.code, readiness?.code, ...(Array.isArray(data.issues) ? data.issues.map(item => record(item)?.code) : [])]
    .filter((code): code is string => typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code))
  for (const code of codes) {
    if (/GPU|CUDA|BF16/.test(code)) issues.add('gpu')
    else if (/MODEL/.test(code) && /VOICE|STT|TTS|ASR|MISSING|UNAVAILABLE|VERIFY|HASH|LOAD/.test(code)) issues.add('models')
    else if (/BRIDGE|VOICE_SERVICE|VOICE_UNREACHABLE|VOICE_OFFLINE/.test(code)) issues.add('bridge')
  }
  const voiceBlocked = voice.status !== 'ready'
    || readiness?.status === 'blocked' || readiness?.status === 'unchecked'
    || codes.some(code => code === 'READINESS_CHECK_PENDING' || code === 'READINESS_CHECK_FAILED')
    || issues.has('gpu') || issues.has('models') || issues.has('bridge') || issues.has('bridgeAddress')
  if (voiceBlocked && !issues.has('gpu') && !issues.has('models') && !issues.has('bridge')) issues.add('voice')
  return {status: data.status === 'blocked' || issues.size ? 'blocked' : 'ready', voiceBlocked, stt: voice.stt === true, tts: voice.tts === true, issues: [...issues]}
}
/** Only explicit refresh or the first mount performs one same-origin GET. */
export function useProductReadiness(): ReadinessCheck {
  const [status, setStatus] = useState<ReadinessCheck['status']>('checking')
  const [data, setData] = useState<ProductReadiness | null>(null)
  const [checking, setChecking] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const recovery = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller; setChecking(true)
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('/api/companion/readiness', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
      if (!response.ok) throw Error('READINESS_UNAVAILABLE')
      const next = parseProductReadiness(await response.json())
      if (pending.current === controller && !controller.signal.aborted) {setData(next); setStatus(next.status)}
    } catch {
      if (pending.current === controller) {setData(null); setStatus('unavailable')}
    } finally {
      clearTimeout(timer)
      if (pending.current === controller) {pending.current = null; setChecking(false)}
    }
  }, [])
  const recoverVoice = useCallback(async () => {
    if (pending.current || recovery.current) return
    const controller = new AbortController(); recovery.current = controller
    setRecovering(true); setRecoveryFailed(false)
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('/api/companion/voice/recheck', {method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
      if (!response.ok) throw Error('VOICE_RECHECK_FAILED')
      if (recovery.current === controller && !controller.signal.aborted) await refresh()
    } catch {if (recovery.current === controller) setRecoveryFailed(true)}
    finally {clearTimeout(timer); if (recovery.current === controller) {recovery.current = null; setRecovering(false)}}
  }, [refresh])
  useEffect(() => {void refresh(); return () => {pending.current?.abort(); pending.current = null; recovery.current?.abort(); recovery.current = null}}, [refresh])
  return {status, data, checking, refresh, recovering, recoverVoice, recoveryFailed}
}
