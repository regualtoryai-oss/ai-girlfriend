/** Visual presets follow real lifecycle facts; they do not infer emotion. */
export type MotionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'smile'
export type MicPhase = 'idle' | 'starting' | 'listening' | 'transcribing' | 'ready' | 'error'
export interface MotionFacts {
  mic: MicPhase
  speaking: boolean
  preparing: boolean
  running: boolean
  failed: boolean
  settled: boolean
}
/** Select the visible preset, giving actual recording and errors precedence. */
export function resolveMotion(f: MotionFacts): MotionState {
  if (f.mic === 'listening') return 'listening'
  if (f.mic === 'starting' || f.mic === 'transcribing') return 'thinking'
  if (f.failed || f.mic === 'error') return 'idle'
  if (f.speaking) return 'speaking'
  if (f.preparing || f.running) return 'thinking'
  if (f.settled) return 'smile'
  return 'idle'
}
