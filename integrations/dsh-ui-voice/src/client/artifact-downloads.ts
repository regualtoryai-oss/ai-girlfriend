/** Download eligibility requires both the current tool proof and authenticated host proof. */
import { isSceneArtifactPath, type SceneArtifact } from './scene-result.ts'
export function matchDownloadArtifacts(proof: unknown, current: readonly SceneArtifact[]): Set<string> {
  const result = new Set<string>()
  if (!proof || typeof proof !== 'object' || !('artifacts' in proof) || !Array.isArray(proof.artifacts)) return result
  for (const item of proof.artifacts) {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !isSceneArtifactPath(item.path)
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.bytes)) continue
    if (current.some(file => file.path === item.path && file.sha256 === item.sha256.toLowerCase() && file.bytes === item.bytes)) result.add(item.path)
  }
  return result
}
