/** Project documented author tool outputs; never display their raw JSON. */
export interface SceneArtifact {name: string; path: string}
export interface SceneResultSummary {
  state: 'completed' | 'notApproved' | 'read' | 'error' | 'returned'
  filenames: string[]
  artifacts: SceneArtifact[]
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
/** Author file tools return workspace-relative forward-slash paths, never URLs. */
export function isSceneArtifactPath(path: string): boolean {
  return !!path && !/[:\\\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
function verifiedFile(value: unknown): SceneArtifact | undefined {
  const entry = record(value)
  if (!entry || typeof entry.path !== 'string' || !isSceneArtifactPath(entry.path) || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) return undefined
  return {name: entry.path.split('/').at(-1)!, path: entry.path}
}
export function summarizeSceneResult(toolName: string | undefined, text: string, isError: boolean): SceneResultSummary {
  const neutral: SceneResultSummary = {state: 'returned', filenames: [], artifacts: []}
  if (isError) return {...neutral, state: 'error'}
  let decoded: unknown
  try { decoded = JSON.parse(text) } catch { return neutral }
  const value = record(decoded)
  if (!value) return neutral
  if (toolName === 'companion_apply_changes') {
    if (value.status === 'not-approved') return {...neutral, state: 'notApproved'}
    if (value.status !== 'completed' || !Array.isArray(value.results) || !value.results.length) return neutral
    const artifacts: SceneArtifact[] = []
    for (const entry of value.results) {
      const item = record(entry)
      const file = verifiedFile(entry)
      if (!file || !item || !['create', 'create_xlsx', 'replace', 'move'].includes(String(item.op))) return neutral
      artifacts.push(file)
    }
    return {state: 'completed', filenames: artifacts.map(file => file.name), artifacts}
  }
  if (toolName === 'companion_read_file') {
    const file = verifiedFile(value)
    if (file && typeof value.content === 'string') return {state: 'read', filenames: [file.name], artifacts: [file]}
  }
  return neutral
}
