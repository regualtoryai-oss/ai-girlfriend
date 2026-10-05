import {existsSync, lstatSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {workspaceFiles, hash} from '../../server/workspace-files.mjs';

const failure = code => Object.assign(new Error(code), {code});
const allowedOperation = new Set(['create', 'create_xlsx', 'replace', 'move']);

/** An approved tool receipt is required; a workspace filename alone grants no download. */
function receipt(value) {
  return value && allowedOperation.has(value.op) && typeof value.path === 'string'
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 12 * 1024 * 1024
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(value.sha256);
}
function latestReceipts(dataRoot) {
  const file = path.join(dataRoot, 'author-evidence', 'artifacts.json');
  if (!existsSync(file)) return new Map();
  if (lstatSync(file).isSymbolicLink() || statSync(file).size > 1024 * 1024) throw failure('ARTIFACT_CATALOG_INVALID');
  let values;
  try {values = JSON.parse(readFileSync(file, 'utf8'));} catch {throw failure('ARTIFACT_CATALOG_INVALID');}
  if (!Array.isArray(values) || values.length > 5000) throw failure('ARTIFACT_CATALOG_INVALID');
  const latest = new Map();
  for (const entry of values) if (receipt(entry)) {
    latest.delete(entry.path);
    latest.set(entry.path, entry);
  }
  return latest;
}
function reader(workspaceRoot, dataRoot) {
  if (!existsSync(workspaceRoot)) return undefined;
  if (lstatSync(workspaceRoot).isSymbolicLink() || !lstatSync(workspaceRoot).isDirectory()) throw failure('ARTIFACT_WORKSPACE_UNAVAILABLE');
  return workspaceFiles(workspaceRoot, path.join(dataRoot, 'file-backups', 'author'));
}
function verifiedBytes(files, entry) {
  const bytes = files.bytes(entry.path);
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256.toLowerCase()) throw failure('ARTIFACT_CHANGED');
  return bytes;
}

/** List only current bytes matching approved receipts. No directory scanning or task creation. */
export function artifactCatalog({dataRoot, workspaceRoot}) {
  const entries = [...latestReceipts(dataRoot).values()].slice(-200).reverse();
  const files = reader(workspaceRoot, dataRoot);
  const artifacts = [], unavailable = [];
  if (!files) return {artifacts, unavailable};
  for (const entry of entries) {
    try {
      if (!files) throw failure('FILE_NOT_FOUND');
      verifiedBytes(files, entry);
      artifacts.push({path: entry.path, name: path.posix.basename(entry.path), bytes: entry.bytes, sha256: entry.sha256.toLowerCase()});
    } catch (error) {
      // Invalid/private manifest paths are never returned, even as failed filenames.
      if (['PATH_NOT_ALLOWED', 'SYMLINK_NOT_ALLOWED'].includes(error.code)) continue;
      unavailable.push({path: entry.path, code: error.code === 'ARTIFACT_CHANGED' ? 'ARTIFACT_CHANGED' : 'ARTIFACT_UNAVAILABLE'});
    }
  }
  return {artifacts, unavailable};
}

/** Revalidate the approved receipt, path and bytes immediately before attachment download. */
export function artifactDownload(relative, {dataRoot, workspaceRoot}) {
  const entry = latestReceipts(dataRoot).get(relative);
  if (!entry) throw failure('ARTIFACT_NOT_APPROVED');
  const files = reader(workspaceRoot, dataRoot);
  if (!files) throw failure('ARTIFACT_UNAVAILABLE');
  return {bytes: verifiedBytes(files, entry), name: path.posix.basename(entry.path)};
}
