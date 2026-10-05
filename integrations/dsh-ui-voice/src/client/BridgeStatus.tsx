/** The voice status uses the shared product check; it owns no polling or retries. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReadinessCheck } from './product-readiness.ts'
import { ReadinessStatus } from './ReadinessStatus.tsx'
export function BridgeStatus(props: PropsLocale<'voice'> & {check: ReadinessCheck}) {
  return <ReadinessStatus {...props} />
}
