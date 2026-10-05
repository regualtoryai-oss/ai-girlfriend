import type { ChatConversationViewNode, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import { summarizeSceneResult, type SceneResultSummary } from './scene-result.ts'

/** Only the existing chat projection and session facts determine task state. */
export type SceneTaskNode = Pick<ChatConversationViewNode, 'key' | 'kind' | 'location' | 'visibility'> & {data: unknown}
export type SceneTaskState = SceneResultSummary['state'] | 'running' | 'executing' | 'stopping' | 'approval' | 'waiting' | 'cancelled' | 'interrupted' | 'blocked'
export function projectSceneTask(nodes: readonly SceneTaskNode[], facts: {
  running: boolean; submitting: boolean; pendingKind?: string | undefined; stopping: boolean; error: boolean
}) {
  const visible = nodes.filter(node => node.visibility !== 'hidden')
  const turns = visible.flatMap(node => 'turn' in node.location ? [node.location.turn] : [])
  const turn = turns.reduce<(typeof turns)[number] | undefined>((latest, item) => !latest || item.turn > latest.turn ? item : latest, undefined)
  const current = turn ? visible.filter(node => 'turn' in node.location && node.location.turn.turn === turn.turn) : []
  const tool = current.filter(node => node.kind === 'tool-call').at(-1)
  const root = tool ? (tool.data as ToolChatData).root : undefined
  const settled = root && 'kind' in root ? root : undefined
  const text = settled?.content.filter(block => block.type === 'text').map(block => block.text).join(' ') ?? ''
  const summary = settled ? summarizeSceneResult(settled.call?.name, text, settled.isError) : undefined
  // A later read/list tool must not erase earlier approved changes in this turn.
  const artifacts = new Map<string, SceneResultSummary['artifacts'][number]>()
  for (const node of current) {
    if (node.kind !== 'tool-call') continue
    const result = (node.data as ToolChatData).root
    if (!('kind' in result)) continue
    const content = result.content.filter(block => block.type === 'text').map(block => block.text).join(' ')
    for (const file of summarizeSceneResult(result.call?.name, content, result.isError).artifacts) artifacts.set(file.path, file)
  }
  const reason = turn?.end?.data.reason.kind
  let state: SceneTaskState | undefined
  if (facts.pendingKind) state = facts.pendingKind === 'approval' ? 'approval' : 'waiting'
  else if (facts.running || facts.submitting) state = facts.stopping ? 'stopping' : root && !settled && turn?.status === 'open' ? 'executing' : 'running'
  else if (reason === 'aborted') state = 'cancelled'
  else if (reason === 'interrupted') state = 'interrupted'
  else if (reason === 'error' || facts.error) state = 'error'
  else if (reason === 'blocked' || reason === 'max-tokens') state = 'blocked'
  else state = summary?.state ?? (current.length ? 'returned' : undefined)
  const active = facts.running || facts.submitting || !!facts.pendingKind
  return {state, active, turn, current, key: `${turn?.turn ?? 'none'}:${tool?.key ?? 'turn'}`, summary: active ? undefined : summary, artifacts: [...artifacts.values()]}
}
