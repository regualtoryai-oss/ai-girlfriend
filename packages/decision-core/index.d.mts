export type Action = 'chat' | 'task' | 'status' | 'cancel' | 'clarify';
export type Capability = 'read_only' | 'local_write' | 'external_message' | 'payment' | 'credentials';
export type Candidate =
  | { readonly id: string; readonly action: 'chat'; readonly args: { readonly message: string } }
  | { readonly id: string; readonly action: 'clarify'; readonly args: { readonly question: string } }
  | { readonly id: string; readonly action: 'task'; readonly args: { readonly instruction: string; readonly capability: Capability } }
  | { readonly id: string; readonly action: 'status' | 'cancel'; readonly args: { readonly taskId: string } };
export interface DecisionRequest {
  readonly schemaVersion: 1;
  readonly kind: 'choice' | 'score';
  readonly requestId: string;
  readonly turnId: string;
  readonly candidates: readonly Candidate[];
}
interface Correlation { readonly schemaVersion: 1; readonly requestId: string; readonly turnId: string; }
export type DecisionResponse = Correlation & (
  | { readonly kind: 'choice'; readonly choiceId: string }
  | { readonly kind: 'score'; readonly scores: readonly { readonly candidateId: string; readonly score: number }[] }
);
export interface DecisionAdapter {
  readonly name: string;
  decide(request: DecisionRequest, options: { signal: AbortSignal }): Promise<unknown>;
}
/** Trusted server state. Never deserialize this from model or browser input. */
export interface PermissionPolicy {
  readonly allowReadOnlyTasks: boolean;
  readonly approvedActionKeys: readonly string[];
  readonly ownedTaskIds: readonly string[];
}
export interface PermissionResult {
  readonly outcome: 'allow' | 'confirm' | 'deny' | 'handoff';
  readonly reason: string;
}
export interface DecisionResult {
  readonly status: 'ready' | 'unconfigured' | 'fallback' | 'cancelled';
  readonly reason?: string;
  readonly requestId: string;
  readonly turnId: string;
  readonly candidate: Candidate | null;
  readonly permission: PermissionResult;
}
export class ContractError extends Error { readonly code: string; constructor(code: string, message: string); }
export const ACTIONS: readonly Action[];
export const CAPABILITIES: readonly Capability[];
export const MAX_CANDIDATES: 16;
export function validateRequest(value: unknown): DecisionRequest;
export function validateDecision(value: unknown, request: DecisionRequest): DecisionResponse;
export function selectCandidate(request: DecisionRequest, response: DecisionResponse): Candidate;
export function approvalKey(request: DecisionRequest, candidateId: string): string;
export function permissionGate(request: DecisionRequest, candidateId: string, policy?: PermissionPolicy): PermissionResult;
export function decisionAvailability(adapter?: DecisionAdapter | null): { readonly status: 'unconfigured' | 'configured'; readonly provider: string | null };
export function resolveDecision(request: DecisionRequest, options?: {
  adapter?: DecisionAdapter | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  policy?: PermissionPolicy;
}): Promise<DecisionResult>;
export type TaskStatus = 'queued' | 'awaiting_confirmation' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export type TaskEvent = 'require_confirmation' | 'start' | 'cancel' | 'fail' | 'approve' | 'complete' | 'cancelled' | 'stop_speaking';
export const TASK_STATUSES: readonly TaskStatus[];
export function transitionTask(status: TaskStatus, event: TaskEvent): TaskStatus;
export function stopSpeaking(): { readonly type: 'audio.stop'; readonly cancelsTask: false };
