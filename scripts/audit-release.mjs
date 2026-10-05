// Local, redacted publication audit. No network requests or provider calls.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const staged = args.includes('--staged');
const history = args.includes('--history');
const privateIndex = args.indexOf('--private-config');
const privatePath = privateIndex >= 0 ? args[privateIndex + 1] : undefined;
if (privateIndex >= 0 && !privatePath) throw new Error('Missing private configuration path');
const git = (...argv) => execFileSync('git', ['-C', root, ...argv], { maxBuffer: 32 * 1024 * 1024 });
const split = bytes => bytes.toString('utf8').split('\0').filter(Boolean);
const candidates = split(git('ls-files', ...(staged ? ['--cached', '-z'] : ['--cached', '--others', '--exclude-standard', '-z'])));
const forbidden = /^(?:data|logs|cache|profiles|backups|models|unused|evidence|deliverables|runtime|workspaces|vendor|node_modules|build-tools)\//i;
const secretName = /(?:^|\/)(?:\.env(?!\.example$)|[^/]*-launch-url\.txt$|(?:providers|usage-budget|verified-prices|bridge-config|credentials)\.json$)|\.(?:pem|key|p12|pfx)$/i;
const signatures = [
  ['credential_prefix', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})/g],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['url_embedded_credentials', /https?:\/\/[^\s/:"'`<>]+:[^\s/@"'`<>]+@/g],
  ['jwt_literal', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['sensitive_literal_assignment', /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|bearer|secret)\s*["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi],
];
const placeholder = /^(?:not[-_ ]needed$|SYNTHETIC|test|dummy|demo|example|placeholder|replace|your|<|\$\{|\$env|Bearer\s*\$|[xX*]{5,}|redacted|mask|local|credential|token|hidden|apiKey)/i;
const knownSecrets = [];
if (privatePath) {
  const collect = obj => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (/api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password/i.test(key) && typeof value === 'string' && value.length >= 12) knownSecrets.push(value);
      collect(value);
    }
  };
  collect(JSON.parse(fs.readFileSync(privatePath, 'utf8')));
}
const findings = [];
let textCount = 0, binaryCount = 0, bytes = 0, historyBlobs = 0, archiveEntries = 0;
function inspectArchive(name, archive) {
  try {
    let end = -1;
    for (let at = archive.length - 22; at >= Math.max(0, archive.length - 65557); at--) {
      if (archive.readUInt32LE(at) === 0x06054b50) { end = at; break; }
    }
    if (end < 0) throw new Error('Missing ZIP directory');
    const count = archive.readUInt16LE(end + 10);
    let cursor = archive.readUInt32LE(end + 16);
    if (count === 65535 || cursor === 0xffffffff) throw new Error('ZIP64 needs manual review');
    for (let i = 0; i < count; i++) {
      if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
      const flags = archive.readUInt16LE(cursor + 8), method = archive.readUInt16LE(cursor + 10);
      const compressedSize = archive.readUInt32LE(cursor + 20), size = archive.readUInt32LE(cursor + 24);
      const nameLength = archive.readUInt16LE(cursor + 28), extraLength = archive.readUInt16LE(cursor + 30), commentLength = archive.readUInt16LE(cursor + 32);
      const local = archive.readUInt32LE(cursor + 42);
      const entryName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      cursor += 46 + nameLength + extraLength + commentLength;
      if (entryName.endsWith('/')) continue;
      if ((flags & 1) || size > 32 * 1024 * 1024) throw new Error('Encrypted or oversized ZIP entry');
      if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP entry');
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const compressed = archive.subarray(start, start + compressedSize);
      const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }) : undefined;
      if (!content || content.length !== size) throw new Error('Unsupported ZIP entry');
      if (forbidden.test(entryName) || secretName.test(entryName)) findings.push({ path: `${name}!${entryName}`, category: 'forbidden_archive_path' });
      archiveEntries++;
      inspect(`${name}!${entryName}`, content, false);
    }
  } catch {
    findings.push({ path: name, category: 'archive_requires_manual_review' });
  }
}
function inspect(name, content, allowArchive = true) {
  bytes += content.length;
  for (const secret of knownSecrets) if (content.includes(Buffer.from(secret))) findings.push({ path: name, category: 'known_private_credential' });
  if (allowArchive && /\.(?:whl|zip)$/i.test(name)) inspectArchive(name, content);
  if (content.includes(0)) { binaryCount++; return; }
  textCount++;
  const text = content.toString('utf8');
  for (const [category, regex] of signatures) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      if (category === 'sensitive_literal_assignment' && placeholder.test(match[1])) continue;
      // This rejected-credential fixture is intentionally public test input.
      if (category === 'url_embedded_credentials' && /(?:^|\/)transport\.test\.mjs$/.test(name) && match[0] === 'http:' + '//user:secret@') continue;
      findings.push({ path: name, line: text.slice(0, match.index).split('\n').length, category });
    }
  }
}
for (const name of candidates) {
  if (forbidden.test(name) || secretName.test(name)) findings.push({ path: name, category: 'forbidden_release_path' });
  const file = path.join(root, name);
  if (!staged && (!fs.existsSync(file) || !fs.statSync(file).isFile())) continue;
  const content = staged ? git('show', `:${name}`) : fs.readFileSync(file);
  if (content.length > 100 * 1024 * 1024) findings.push({ path: name, category: 'github_file_size_exceeded', bytes: content.length });
  inspect(name, content);
}
if (history) {
  for (const row of git('rev-list', '--objects', '--all').toString('utf8').trim().split('\n')) {
    const separator = row.indexOf(' ');
    if (separator < 0) continue;
    const oid = row.slice(0, separator), name = row.slice(separator + 1);
    if (git('cat-file', '-t', oid).toString('utf8').trim() !== 'blob') continue;
    if (forbidden.test(name) || secretName.test(name)) findings.push({ path: `HISTORY ${oid.slice(0, 12)} ${name}`, category: 'forbidden_release_path' });
    const size = Number(git('cat-file', '-s', oid));
    if (size > 32 * 1024 * 1024) { findings.push({ path: `HISTORY ${oid.slice(0, 12)} ${name}`, category: 'unscanned_large_history_blob', bytes: size }); continue; }
    inspect(`HISTORY ${oid.slice(0, 12)} ${name}`, git('cat-file', 'blob', oid));
    historyBlobs++;
  }
}
console.log(JSON.stringify({ mode: staged ? 'git_index' : 'worktree_candidates', candidates: candidates.length, textCount, binaryCount, bytes, historyBlobs, archiveEntries, privateCredentialsCompared: knownSecrets.length, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
