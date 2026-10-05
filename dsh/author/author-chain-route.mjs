// Explicit single-session scope; no historical session is published or enabled.
export const chainSession=process.env.COMPANION_PROBE_SESSION_ID?.trim()||null;
export function chooseChainRoute(sessionId,message,choiceId){
 if(!chainSession||sessionId!==chainSession)return null;
 const brief=message.startsWith('[CHAIN_DEMO_BRIEF]'),html=message.startsWith('[CHAIN_DEMO_HTML]');
 if(!brief&&!html)return null;
 if(brief&&choiceId!=='workspace-task')throw Error('CHAIN_BRIEF_JEV_CHOICE_MISMATCH');
 if(html&&choiceId!=='coding')throw Error('CHAIN_HTML_JEV_CHOICE_MISMATCH');
 return {phase:brief?'brief':'html',provider:'deepseek-official',model:brief?'deepseek-v4-flash':'deepseek-v4-pro',choiceId,dependency:html?'model-probes/chain-brief.md':null};
}
