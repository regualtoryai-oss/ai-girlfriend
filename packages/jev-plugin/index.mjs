import { Service } from '@deepseek-ai/cordis';
import { ContractError, resolveDecision, validateRequest } from '@ai-girlfriend/decision-core';
import { createTypeSafeDecisionAdapter, TYPESAFE_SDK_VERSION } from './adapter.mjs';

export const name = 'companion-jev';
export const SERVICE_NAME = 'companionDecision';

function configuration(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['timeoutMs', 'enabled'].includes(key))) {
    throw new ContractError('invalid_config', 'Only enabled and timeoutMs belong in the Jev plugin configuration');
  }
  const timeoutMs = value.timeoutMs ?? 2500;
  const enabled = value.enabled ?? true;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || typeof enabled !== 'boolean') {
    throw new ContractError('invalid_config', 'Invalid Jev plugin timeout or enabled flag');
  }
  return { timeoutMs, enabled };
}

/** Cordis service only: it neither generates chat text nor executes or approves actions. */
export class CompanionDecisionService extends Service {
  #client = null;
  #generation = 0;
  #active = new Set();
  #disposed = false;
  #config;

  constructor(ctx, config = {}) {
    const validated = configuration(config);
    super(ctx, SERVICE_NAME);
    this.#config = validated;
    // Cordis services are context-tracking proxies. Bound methods retain private-field ownership.
    for (const method of ['status', 'bindClient', 'decide', 'dispose']) this[method] = this[method].bind(this);
    ctx.effect(() => () => this.dispose(), 'companion-jev.abort-inflight');
  }

  status() {
    return Object.freeze({
      service: SERVICE_NAME, provider: 'typesafe', sdkVersion: TYPESAFE_SDK_VERSION,
      status: this.#disposed ? 'disposed' : !this.#config.enabled ? 'disabled' : this.#client ? 'configured' : 'unconfigured',
      activeRequests: this.#active.size
    });
  }

  /** Server-only runtime integration method. The returned disposer is safe across key/client rotations. */
  bindClient(client) {
    if (this.#disposed) throw new ContractError('service_disposed', 'Jev service is disposed');
    if (!client || typeof client.systemOne !== 'function') throw new ContractError('invalid_adapter', 'Expected a server-owned systemOne client');
    for (const controller of this.#active) controller.abort();
    this.#client = client;
    const generation = ++this.#generation;
    return () => {
      if (generation !== this.#generation) return;
      for (const controller of this.#active) controller.abort();
      this.#client = null; this.#generation++;
    };
  }

  async decide(input, options = {}) {
    const request = validateRequest(input);
    if (this.#disposed) return Object.freeze({ status: 'disposed', requestId: request.requestId, turnId: request.turnId, decision: null });
    const controller = new AbortController();
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new ContractError('invalid_signal', 'Expected AbortSignal');
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    this.#active.add(controller);
    let decision = null;
    try {
      const adapter = this.#config.enabled && this.#client
        ? createTypeSafeDecisionAdapter(this.#client, { state: options.state, model: options.model })
        : undefined;
      const result = await resolveDecision(request, {
        timeoutMs: this.#config.timeoutMs, signal,
        adapter: adapter && { name: adapter.name, async decide(input, options) { decision = await adapter.decide(input, options); return decision; } }
      });
      // Permission results and fallback prose from decision-core are deliberately not exposed by this service.
      return Object.freeze({
        status: !this.#config.enabled ? 'disabled' : result.status,
        requestId: request.requestId, turnId: request.turnId,
        decision: result.status === 'ready' ? decision : null,
        ...(result.reason ? { reason: result.reason } : {})
      });
    } finally { controller.abort(); this.#active.delete(controller); }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#active) controller.abort();
    this.#client = null; this.#generation++;
  }
}

export function apply(ctx, config) { new CompanionDecisionService(ctx, config); }
