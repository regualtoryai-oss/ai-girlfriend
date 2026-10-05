import { Service, type Context } from '@deepseek-ai/cordis';
import type { DecisionRequest, DecisionResponse } from '@ai-girlfriend/decision-core';
import type { AdapterOptions, SystemOneClient } from './adapter.mjs';
export const name: 'companion-jev';
export const SERVICE_NAME: 'companionDecision';
export interface PluginConfig { enabled?: boolean; timeoutMs?: number; }
export interface DecisionServiceResult {
  readonly status: 'ready' | 'unconfigured' | 'fallback' | 'cancelled' | 'disabled' | 'disposed';
  readonly requestId: string;
  readonly turnId: string;
  readonly decision: DecisionResponse | null;
  readonly reason?: string;
}
export class CompanionDecisionService extends Service {
  constructor(ctx: Context, config?: PluginConfig);
  status(): { readonly service: 'companionDecision'; readonly provider: 'typesafe'; readonly sdkVersion: string; readonly status: 'configured' | 'unconfigured' | 'disabled' | 'disposed'; readonly activeRequests: number };
  /** Runtime-only integration; do not expose this method through a browser or model tool. */
  bindClient(client: SystemOneClient): () => void;
  decide(request: DecisionRequest, options?: AdapterOptions & { signal?: AbortSignal }): Promise<DecisionServiceResult>;
  dispose(): void;
}
export function apply(ctx: Context, config?: PluginConfig): void;
declare module '@deepseek-ai/cordis' { interface Context { companionDecision: CompanionDecisionService; } }
