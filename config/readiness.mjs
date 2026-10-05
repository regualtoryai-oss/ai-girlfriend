import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';

export const RELAY_ORIGIN = 'https://newapi1.1234bot.com';
export const JEV_ORIGIN = 'https://api.typesafe.ai';
const issue = (code, message, action) => ({code, message, action});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read private configuration without exposing values, file contents or parse errors. */
function privateJson(file, issues, code) {
  if (!existsSync(file)) return undefined;
  try {
    if (statSync(file).size > 1024 * 1024) throw Error('oversized');
    const value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!record(value)) throw Error('object required');
    return value;
  } catch {
    issues.push(issue(code, '本地配置格式有误，已停止使用。', '检查 data/private-config 中对应 JSON 的格式；不要把配置内容贴入日志或提交到 Git。'));
    return undefined;
  }
}

/** True only for the original provider/model and an explicitly verified numeric quote. */
export function verifiedQuote(quote, model = 'deepseek-v4-flash') {
  return record(quote) && quote.model === model && quote.unit === 'USD' && quote.verified === true
    && Number.isFinite(quote.inputPerMillion) && quote.inputPerMillion >= 0
    && Number.isFinite(quote.outputPerMillion) && quote.outputPerMillion >= 0
    && quote.inputPerMillion + quote.outputPerMillion > 0
    && Number.isFinite(quote.groupMultiplier) && quote.groupMultiplier >= 1;
}

/** Return only readiness booleans and fixed repair advice; never return credentials or ledger values.
 * hostEnvironment is reserved for the scrubbed environment produced by launch-author.mjs.
 */
export function readConfiguration(root, env = process.env, {dataRoot = path.join(root, 'data'), hostEnvironment = false} = {}) {
  const issues = [];
  const base = path.join(dataRoot, 'private-config');
  const providers = privateJson(path.join(base, 'providers.json'), issues, 'PROVIDERS_CONFIG_INVALID');
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const relayEnvironment = env.COMPANION_RELAY_API_KEY || (hostEnvironment ? env.DEEPSEEK_API_KEY : undefined);
  const relayConfigured = nonempty(relayEnvironment)
    || providers?.relay?.baseUrl === RELAY_ORIGIN && nonempty(providers.relay.apiKey);
  const jevConfigured = nonempty(env.COMPANION_JEV_KEY)
    || providers?.jev?.baseUrl === JEV_ORIGIN && nonempty(providers.jev.apiKey);
  if (!relayConfigured) issues.push(issue('AUTHORIZED_RELAY_NOT_CONFIGURED', '尚未配置原聊天服务凭据。', '运行 Configure-Companion.ps1 查看引导；启动时可隐藏输入，仅在当前进程使用。'));
  if (!jevConfigured) issues.push(issue('AUTHORIZED_JEV_NOT_CONFIGURED', '尚未配置 Jev 凭据。', '使用自己的 Jev 授权凭据；不要用聊天服务的密钥替代。'));
  const budget = privateJson(path.join(base, 'usage-budget.json'), issues, 'BUDGET_CONFIG_INVALID');
  const budgetAuthorized = budget?.authorized === true;
  const forwardAuthorized = budget?.forwardTestsAuthorized === true;
  const ledgerValid = Array.isArray(budget?.entries)
    && budget.entries.every(entry => record(entry) && Number.isFinite(entry.maximum) && entry.maximum >= 0);
  const positiveRemaining = budget?.unit === 'USD' && Number.isFinite(budget.limit) && budget.limit > 0 && ledgerValid
    && budget.entries.reduce((sum, entry) => sum + entry.maximum, 0) < budget.limit;
  if (!budgetAuthorized || !forwardAuthorized) issues.push(issue('FORWARD_BUDGET_PENDING', '费用预算尚未明确批准，聊天与 Jev 请求均已阻止。', '自行核对预算模板，仅在明确批准费用后设置两项授权；重新检查不会批准预算。'));
  const prices = privateJson(path.join(base, 'verified-prices.json'), issues, 'PRICES_CONFIG_INVALID');
  const primaryQuote = prices?.[RELAY_ORIGIN]?.['deepseek-v4-flash'];
  const pricesVerified = verifiedQuote(primaryQuote);
  if (!pricesVerified) issues.push(issue('PRICE_NOT_VERIFIED', '当前 Flash 模型价格尚未核实。', '核对实际服务商、USD 单位与费率后填写 verified-prices.json；Pro 路由仍需单独核实 Pro 报价。'));
  // The original author profile reserves at least 65,536 input and 2,048 output tokens.
  // Actual larger requests and Pro phases still use the original per-request reservation.
  const firstRequestAffordable = positiveRemaining && pricesVerified
    && ((65536 * primaryQuote.inputPerMillion + 2048 * primaryQuote.outputPerMillion) / 1e6) * primaryQuote.groupMultiplier
      <= budget.limit - budget.entries.reduce((sum, entry) => sum + entry.maximum, 0);
  const budgetAvailable = !!firstRequestAffordable;
  if (budgetAuthorized && forwardAuthorized && (!positiveRemaining || pricesVerified && !firstRequestAffordable)) {
    issues.push(issue('BUDGET_LIMIT', '费用余量不足以保留首个 Flash 请求，Jev 请求也已阻止。', '核对上限与保留的费用记录；较大请求及 Pro 阶段仍须单独检查，不要清空账本来重试。'));
  }
  return {relayConfigured, jevConfigured, budgetAuthorized, forwardAuthorized, pricesVerified, budgetAvailable,
    ready: relayConfigured && jevConfigured && budgetAuthorized && forwardAuthorized && pricesVerified && budgetAvailable && issues.length === 0, issues};
}

/** Stop before Jev or a paid model request when the original configuration guards are closed. */
export function assertTaskConfiguration(root, env = process.env, options = {}) {
  const status = readConfiguration(root, env, options);
  if (!status.ready) {
    const code = status.issues[0]?.code || 'TASK_CONFIGURATION_NOT_READY';
    throw Object.assign(new Error(code), {code});
  }
  return status;
}
