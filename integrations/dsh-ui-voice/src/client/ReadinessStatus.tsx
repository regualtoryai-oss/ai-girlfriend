/** Fixed-copy readiness guidance and an explicit read-only recheck. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReadinessCheck, ReadinessIssue } from './product-readiness.ts'
import type { VoiceKey } from './locales.ts'
import css from './BridgeStatus.module.css'

const issueKeys: Record<ReadinessIssue, VoiceKey> = {
  relay: 'health.relay', jev: 'health.jev', budget: 'health.budget', prices: 'health.prices', funds: 'health.funds',
  forward: 'health.forward', bridge: 'health.bridge', bridgeAddress: 'health.bridgeAddress', gpu: 'health.gpu', models: 'health.models', voice: 'health.voice', host: 'health.host',
}
export function ReadinessStatus({t, check}: PropsLocale<'voice'> & {check: ReadinessCheck}) {
  return <section className={css.status} data-product-readiness={check.status} aria-label={t('health.title')}>
    <p role="status">{t(check.status === 'checking' ? 'health.checking' : check.status === 'unavailable' ? 'health.unavailable' : check.status === 'blocked' ? 'health.blocked' : 'health.ready')}</p>
    {check.data && !check.data.voiceBlocked && <p>{t(check.data.stt && check.data.tts ? 'health.voiceReady' : 'health.voiceLazy')}</p>}
    {!!check.data?.issues.length && <ul>{check.data.issues.map(issue => <li key={issue}>{t(issueKeys[issue])}</li>)}</ul>}
    <button type="button" disabled={check.checking || check.recovering} onClick={() => void check.refresh()}>{t(check.checking ? 'health.checking' : 'health.recheck')}</button>
    {(check.data?.voiceBlocked || check.status === 'unavailable') && <button type="button" disabled={check.checking || check.recovering} onClick={() => void check.recoverVoice()}>{t(check.recovering ? 'health.checking' : 'health.recover')}</button>}
    {check.recoveryFailed && <p role="alert">{t('health.recoverFailed')}</p>}
    <small>{t('health.readOnly')}</small>
  </section>
}
