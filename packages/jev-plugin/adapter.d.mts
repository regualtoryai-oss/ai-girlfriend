import type { SystemOneRequest, RequestOptions, JsonValue } from '@typesafe-ai/sdk';
import type { DecisionRequest, DecisionResponse, DecisionAdapter } from '@ai-girlfriend/decision-core';
export interface SystemOneClient { systemOne(request: SystemOneRequest, options?: RequestOptions): PromiseLike<unknown>; }
export interface AdapterOptions { state?: JsonValue; model?: string; }
export const TYPESAFE_SDK_VERSION: string;
export const SCORE_RUBRIC: readonly string[];
export function buildSystemOneRequest(request: DecisionRequest, options?: AdapterOptions): SystemOneRequest;
export function normalizeSystemOneResult(raw: unknown, request: DecisionRequest): DecisionResponse;
export function createTypeSafeDecisionAdapter(client: SystemOneClient, options?: AdapterOptions): DecisionAdapter;
