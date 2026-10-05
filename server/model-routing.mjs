export const RELAY_ORIGINS=Object.freeze(['https://newapi1.1234bot.com','https://newapi.1234bot.com','https://llmapi.lovbrowser.com','https://llmapi-direct.lovbrowser.com']);
export const DEFAULT_RELAY=Object.freeze({baseUrl:RELAY_ORIGINS[0],backupBaseUrl:RELAY_ORIGINS[1],model:'deepseek-v4-flash',taskModel:'deepseek-v4-pro'});
const fail=code=>Object.assign(new Error(code),{code});
// Application-level routing, not a claim that Jev decomposes tasks or that a model
// catalog proves tool support. Only explicit per-endpoint/model probes enable relay.
export function selectModelRoute({capability,official,relay}){
 if(!['chat','tools'].includes(capability))throw fail('UNSUPPORTED_CAPABILITY');
 const model=capability==='tools'?relay?.taskModel:relay?.model;
 const proof=relay?.verification?.[capability];
 if(relay?.enabled&&relay.apiKey&&RELAY_ORIGINS.includes(relay.baseUrl)&&proof?.passed===true&&proof.baseUrl===relay.baseUrl&&proof.model===model){return {provider:'relay',baseUrl:relay.baseUrl,model,capability,verified:true};}
 if(official?.apiKey&&official.baseUrl==='https://api.deepseek.com'&&official.model)return {provider:'deepseek',baseUrl:official.baseUrl,model:official.model,capability,verified:'existing-integration'};
 throw fail(relay?.apiKey?'RELAY_CAPABILITY_NOT_VERIFIED':'MODEL_NOT_CONFIGURED');
}
export function selectedCapability({kind,decision}){return kind==='chat'||(kind==='agent'&&['chat','clarify','status'].includes(decision?.action))?'chat':'tools';}
