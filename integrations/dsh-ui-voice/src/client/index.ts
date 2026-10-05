import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/**
 * Browser voice plugin: the composer tool-row seat for the mic control.
 *
 * T5: capture (embedded mic-capture worklet) + silence endpointing ->
 * bridge /api/stt -> conversation.send(text). T6 adds reply TTS playback;
 * T7 the toggles; T8 the companion animation window.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's SlotMap merge so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { isSceneArtifactPath } from './scene-result.ts'
import { VoiceToolbar } from './VoiceToolbar.tsx'
import { ReplySpeakerMount } from './voice/reply-listener.tsx'
import { ReplySpeaker } from './voice/speaker.ts'
import { CompanionController } from './voice/companion-controller.ts'
import type { VoiceInjected } from './contract.ts'
import { en, zh, type VoiceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The voice control's copy. */
    voice: VoiceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'voice'

/** Required services: the slot registry, this plugin's copy, and the sessions service. */
export const inject = ['slots', 'locale', 'sessions', 'layout', 'remote', 'remote.session']

/**
 * Client plugin body: register the `voice` dictionaries and the mic control
 * into the composer tool row (`conversation.input.left`, a list seat beside
 * the resident chrome — never replaces it). The injected `sendText` resolves
 * the session-scoped conversation service at call time (scope addressing).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Diagnostic stamp: tells us which bundle build the browser actually runs.
  console.log('[ui-voice] loaded')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice: dictionaries')

  // One shared speaker per plugin fiber: the reply listener plays through it
  // and the companion window reads its `speaking` state.
  const speaker = new ReplySpeaker()
  ctx.effect(() => () => speaker.dispose(), 'ui-voice: speaker teardown')

  // One shared companion controller: the window renders it, the toggle flips it.
  const companion = new CompanionController()

  // One shared TTS abort holder: the reply listener registers its current
  // AbortController; the voice toggle aborts it when turned off so the bridge
  // stops synthesizing (client disconnect) instead of draining its queue.
  let activeTtsController: AbortController | null = null
  // Barge-in handler registered by the reply listener (swallow the current
  // reply when the user starts speaking).
  let interruptHandler: (() => void) | null = null
  let voiceReady = false

  const faces = new Map<SessionId | undefined, VoiceInjected>()
  ctx.effect(() => () => faces.clear(), 'ui-voice: face teardown')
  const injectFace = (sessionId: SessionId | undefined): VoiceInjected => {
    const cached = faces.get(sessionId)
    if (cached) return cached
    const face: VoiceInjected = ({
    canReadVoice: () => voiceReady,
    setVoiceReady: (ready: boolean) => {
      if (voiceReady && !ready) {speaker.stop(); activeTtsController?.abort(); interruptHandler?.()}
      voiceReady = ready
    },
    cancelTask: async () => {
      const session = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)?.session
      if (!session) throw new Error('[ui-voice] no session for cancellation')
      speaker.stop(); activeTtsController?.abort(); interruptHandler?.()
      const result = await session.cancel()
      if (!result.ok) throw new Error(result.error.message)
    },
    openArtifact: async (path: string) => {
      if (sessionId === undefined || !isSceneArtifactPath(path)) throw new Error('[ui-voice] invalid artifact scope')
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      if (!cwd) throw new Error('[ui-voice] workspace unavailable')
      const result = await ctx.remote.session.openWorkspacePath({path: resolveWorkspacePath(cwd, path)})
      if (!result.ok) throw new Error(result.error.message)
    },
    expandSidebar: () => {
      // AppFrame publishes the native layout state's effective collapsed flag.
      if (document.querySelector('[data-author-frame][data-sidebar-collapsed="true"]')) {
        ctx.layout.toggleSidebar()
      }
    },
    sendText: async (text: string) => {
      speaker.unlock()
      if (sessionId === undefined) throw new Error('[ui-voice] no session scope for sendText')
      const binding = ctx.sessions.binding(sessionId)
      const session = binding?.session
      if (session === undefined) throw new Error('[ui-voice] session unavailable for sendText')
      // Voice input must send IMMEDIATELY: when the agent's turn is still
      // running (my reply streaming), a plain queue would sit as a pending
      // item in the input dock, needing a manual send — the "second sentence
      // stuck" bug. Default: steer, which interrupts the running turn.
      // The BusyToggle flips this to pure queue for continuous conversation
      // (let the current turn finish, then the sentence auto-sends).
      const running = session.getSnapshot()?.running === true
      let interrupt = true
      try {
        interrupt = localStorage.getItem('s2s.voice.interrupt') !== '0'
      } catch {
        // persistence unavailable — fall back to the interrupt default
      }
      const mode = running && interrupt ? 'steer' : 'queue'
      const result = await session.prompt([{ type: 'text', text }], mode)
      if (!result.ok) {
        throw new Error(`[ui-voice] prompt failed: ${result.error.code}: ${result.error.message}`)
      }
    },
    speaker,
    companion,
    abortTts: () => {
      interruptHandler?.()
      speaker.stop()
      speaker.preparing = false
      activeTtsController?.abort()
      activeTtsController = null
    },
    // Internal wiring for the reply listener (not part of the public face
    // contract, but typed as the shared holders the listener fills in).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _registerTtsAbort: (controller: AbortController | null) => {
      activeTtsController = controller
      speaker.preparing = controller !== null
    },
    interruptReply: () => {
      speaker.unlock()
      // Mic barge-in: stop playback, abort the in-flight TTS request, and ask
      // the reply listener to swallow the rest of the current reply.
      speaker.stop()
      activeTtsController?.abort()
      activeTtsController = null
      // 用户占用麦克风/说话：同时停止数字人视频播放（只停播放，不涉及
      // 桥接的生成任务与磁盘文件）。
      companion.notifyMicInterrupt()
      interruptHandler?.()
    },
    _registerInterruptHandler: (handler: (() => void) | null) => {
      interruptHandler = handler
    },
  })
    faces.set(sessionId, face)
    return face
  }

  // ── composer tool controls live ABOVE the input card (conversation.input.dock):
  //    one compact row (mic / toggles / bridge-status), so the card's own tool
  //    row stays short and the model select keeps its place on the same line.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'voice-toolbar',
      order: 0,
      locale: NS,
      inject: injectFace,
    },
    VoiceToolbar,
  ))

  // DeepSeek balance chip lives in the bottom status dock (next to the
  // turns/steps/tool-time stats line): shows ¥/USD on load; click to refresh.
  // Zero polling — the bridge caches the upstream answer 10 minutes.

  // Hidden per-session reply listener: speaks finalized assistant text.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    {
      name: 'conversation.input.left',
      id: 'voice-reply',
      order: 90,
      locale: NS,
      inject: injectFace,
    },
    ReplySpeakerMount,
  ))

  // Hidden QQ bridge: private-message inbound -> sendText; settled replies ->
  // bridge -> TTS voice -> QQ. Renders null; no-op when qq disabled.
}
