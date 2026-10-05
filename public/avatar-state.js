const scene=document.querySelector('.scene');const label=document.querySelector('#avatar-state');
let task='idle',voice='idle';
const voiceNames={listening:'正在听你说',transcribing:'正在本地识别',thinking:'正在处理语音',speaking:'正在系统播报'};
const taskNames={thinking:'正在理解你的要求',working:'正在处理任务','awaiting-confirmation':'等你确认改动',success:'任务已完成',error:'需要检查处理结果'};
function render(){const v=voiceNames[voice],t=taskNames[task];const actual=v?voice:task;scene.dataset.agentState=actual;label.textContent=v||t||'';label.hidden=!label.textContent;document.dispatchEvent(new CustomEvent('companion:state',{detail:{state:actual,taskState:task,voiceState:voice,visual:'static-portrait',liveLipSync:false}}));}
document.addEventListener('companion:task-state',e=>{task=e.detail.state;render();});
document.addEventListener('companion:voice-state',e=>{voice=e.detail.state;render();});
// Existing Ditto idle is an opt-in, unaccepted offline preview. Actual task or
// audio activity does not manufacture new motion assets or pretend to lip-sync.
render();
