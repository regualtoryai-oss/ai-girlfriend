import { Context, Service } from '@deepseek-ai/cordis';
export interface VoiceIds { sessionId: string; requestId: string; turnId: string }
export interface VoiceConfig { asrEndpoint?: string; asrFormat?: 'multipart' | 'wav'; asrTimeoutMs?: number; maxDurationMs?: number }
export interface VoiceResult extends VoiceIds { status: string }
export interface VoiceInput extends VoiceIds { mode?: 'interrupt' | 'queue' }
export interface VoiceEvent extends VoiceIds { type: string; channel: 'input' | 'output'; state: 'listening' | 'transcribing' | 'speaking' | 'stopped' | 'error' | 'idle'; characters?: number; reason?: string; status?: string; utteranceId?: string }
export type Router = (input: VoiceIds & { text: string; source: 'voice'; mode: 'interrupt' | 'queue' }, options: { signal: AbortSignal }) => Promise<unknown>;
export interface OutputAdapter {
  kind: 'browser-synthesis' | 'local-tts';
  speak(input: VoiceIds & { utteranceId: string; text: string; signal: AbortSignal }): Promise<void>;
  stop(input: VoiceIds): void | Promise<void>;
}
export declare const name: 'companion-voice';
export declare const SERVICE_NAME: 'companionVoice';
export declare class CompanionVoiceService extends Service {
  constructor(ctx: Context, config?: VoiceConfig);
  status(): Readonly<{ service: string; status: string; asr: string; router: string; output: string; sessions: number }>;
  subscribe(listener: (event: VoiceEvent) => void): () => void;
  bindRouter(router: Router): () => void;
  bindOutput(output: OutputAdapter): () => void;
  beginTurn(input: VoiceInput): VoiceResult;
  pushFrame(input: VoiceIds & { sequence: number; pcm16: Uint8Array }): VoiceResult & { durationMs: number; nextSequence: number };
  endTurn(input: VoiceIds): Promise<VoiceResult>;
  submitWav(input: VoiceInput & { wav: Uint8Array }): Promise<VoiceResult>;
  cancelInput(input: VoiceIds): VoiceResult;
  enqueueSpeech(input: VoiceIds & { utteranceId: string; text: string }): Promise<VoiceResult>;
  stopSpeaking(input: VoiceIds): VoiceResult;
  closeSession(sessionId: string): void;
  dispose(): void;
}
export declare function apply(ctx: Context, config?: VoiceConfig): void;
declare module '@deepseek-ai/cordis' { interface Context { companionVoice: CompanionVoiceService } }
