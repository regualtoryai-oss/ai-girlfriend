const $=s=>document.querySelector(s);
const say=s=>{document.querySelector('#notice').textContent=s;};
let session=null,turn=null,capturing=false,pendingPermission=false,generation=0,stream=null,context=null,processor=null,timer=null,chunks=[],frames=0,sampleRate=16000,polling=false,playing=null,recognizing=false;
const localVoice=()=>window.speechSynthesis?.getVoices().find(v=>v.localService&&/^zh(?:-|_)/i.test(v.lang));
function updateHint(){if(session?.ready)$('#voice-hint').textContent=localVoice()?'按键录音 · 本地识别 · 临时系统语音':'按键录音 · 本地识别 · 暂无本地中文播报';}
window.speechSynthesis?.addEventListener('voiceschanged',updateHint);
const state=s=>document.dispatchEvent(new CustomEvent('companion:voice-state',{detail:{state:s}}));
async function call(op,data={}){const r=await fetch('/api/voice/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Voice-Csrf':session.csrf},body:JSON.stringify({...data,sessionId:session.sessionId})});const v=await r.json();if(!r.ok)throw Error(v.error||'语音处理失败');return v;}
async function bootstrap(){try{session=await(await fetch('/api/voice/bootstrap')).json();if(!session.ready)throw Error();$('#voice').textContent='点击说话';$('#voice').setAttribute('aria-label','点击开始录音，需要浏览器麦克风授权');updateHint();}catch{$('#voice').textContent='语音未接通';$('#voice-hint').textContent='本地语音服务未就绪';}}
async function cleanup(){clearTimeout(timer);timer=null;for(const track of stream?.getTracks()||[])track.stop();stream=null;if(processor){processor.onaudioprocess=null;processor.disconnect();processor=null;}const old=context;context=null;if(old)await old.close().catch(()=>{});capturing=false;pendingPermission=false;$('#voice').textContent=session?.ready?'点击说话':'语音未接通';$('#voice-cancel').hidden=true;}
function stopSpeech(notify=true){window.speechSynthesis?.cancel();const old=playing;playing=null;$('#speech-stop').disabled=true;if(notify&&session&&old)call('stop',old).catch(()=>{});state('idle');}
async function cancelInput(){recognizing=false;generation++;const old=turn;chunks=[];frames=0;await cleanup();if(session&&old)call('cancel',old).catch(()=>{});state('idle');say('录音已取消，麦克风已释放。');}
async function play(item){if(!turn||item.turnId!==turn.turnId)return;const voice=localVoice();if(!voice){say('回复已生成；此浏览器没有可用的本地中文系统声线。');await call('ack',{...item,text:undefined,ok:false});return;}
 stopSpeech(false);playing=item;const u=new SpeechSynthesisUtterance(item.text);u.voice=voice;u.lang=voice.lang;u.rate=1;$('#speech-stop').disabled=false;state('speaking');
 const finish=ok=>{if(playing?.utteranceId!==item.utteranceId)return;playing=null;$('#speech-stop').disabled=true;state('idle');call('ack',{turnId:item.turnId,requestId:item.requestId,utteranceId:item.utteranceId,ok}).catch(()=>{});};u.onend=()=>finish(true);u.onerror=()=>finish(false);speechSynthesis.speak(u);
}
async function poll(){if(polling||!session)return;polling=true;let until=Date.now()+90000;
 try{while(Date.now()<until&&turn){const r=await call('poll');for(const e of r.events||[]){if(e.turnId!==turn.turnId)continue;if(e.type==='playback')await play(e);else if(e.type==='playback-stop')stopSpeech(false);else if(e.state){state(e.state);if(e.state==='transcribing'&&recognizing)say('正在本地识别，再交给 Jev 与 Harness 回复…');}}await new Promise(r=>setTimeout(r,250));}}
 catch{say('语音连接中断，请重试。');}finally{polling=false;}}
function wav(){const merged=new Float32Array(frames);let at=0;for(const c of chunks){merged.set(c,at);at+=c.length;}chunks=[];const n=Math.min(480000,Math.floor(merged.length*16000/sampleRate));const out=new ArrayBuffer(44+n*2),v=new DataView(out);const ascii=(p,t)=>{for(let i=0;i<t.length;i++)v.setUint8(p+i,t.charCodeAt(i));};ascii(0,'RIFF');v.setUint32(4,36+n*2,true);ascii(8,'WAVE');ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++){const f=i*sampleRate/16000,j=Math.floor(f),x=(merged[j]||0)*(1-f+j)+(merged[j+1]||0)*(f-j);v.setInt16(44+i*2,Math.max(-1,Math.min(1,x))*32767,true);}let b='';const bytes=new Uint8Array(out);for(let i=0;i<bytes.length;i+=16384)b+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(b);}
async function finish(){if(!capturing)return;const old=turn,version=generation,audio=wav();await cleanup();state('thinking');say('正在识别语音…');poll();try{const r=await call('wav',{...old,wav:audio,output:false});if(generation!==version||turn?.turnId!==old.turnId)return;if(r.status!=='routed')throw Error(r.status==='no_speech'?'没有识别到语音，请重试。':'语音识别或回复未完成，请重试。');if(r.reply?.handoff==='conversation'){recognizing=false;say('');state('idle');document.dispatchEvent(new CustomEvent('companion:voice-input',{detail:{text:r.reply.transcript,turnId:old.turnId}}));}else throw Error('语音未交给对话，请重试。');}catch(e){if(generation===version){state('error');say(e.message);}}}

$('#audio-file-open').onclick=()=>$('#audio-file').click();
$('#audio-file').onchange=async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>1000000)return say('测试文件需为 30 秒以内的 16kHz 单声道 PCM16 WAV。');
 try{
  if(capturing||pendingPermission)await cancelInput();if(!session?.ready)await bootstrap();if(!session?.ready)throw Error('本地语音服务未就绪。');
  const data=await file.arrayBuffer(),v=new DataView(data),bytes=new Uint8Array(data);const tag=p=>String.fromCharCode(...bytes.subarray(p,p+4));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('仅支持 PCM WAV。');let pcm=null,format=false;
  for(let p=12;p+8<=data.byteLength;){const n=v.getUint32(p+4,true);if(p+8+n>data.byteLength)throw Error('WAV 文件不完整。');if(tag(p)==='fmt '&&n>=16)format=v.getUint16(p+8,true)===1&&v.getUint16(p+10,true)===1&&v.getUint32(p+12,true)===16000&&v.getUint16(p+22,true)===16;if(tag(p)==='data')pcm=bytes.slice(p+8,p+8+n);p+=8+n+(n%2);}
  if(!format||!pcm||!pcm.length||pcm.length>960000||pcm.length%2)throw Error('需 16kHz 单声道 PCM16，最长 30 秒。');
  const out=new Uint8Array(44+pcm.length),d=new DataView(out.buffer),ascii=(p,t)=>{for(let i=0;i<t.length;i++)out[p+i]=t.charCodeAt(i)};ascii(0,'RIFF');d.setUint32(4,36+pcm.length,true);ascii(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,16000,true);d.setUint32(28,32000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);ascii(36,'data');d.setUint32(40,pcm.length,true);out.set(pcm,44);let binary='';for(let i=0;i<out.length;i+=16384)binary+=String.fromCharCode(...out.subarray(i,i+16384));
  stopSpeech();if(turn)call('cancel',turn).catch(()=>{});const version=++generation;turn={sessionId:session.sessionId,requestId:crypto.randomUUID(),turnId:crypto.randomUUID()};const old=turn;state('transcribing');recognizing=true;say('正在本地识别所选文件，没有打开麦克风。');poll();const result=await call('wav',{...old,wav:btoa(binary),output:false});
  if(version!==generation||turn?.turnId!==old.turnId)return;if(result.status!=='routed'||result.reply?.handoff!=='conversation')throw Error('没有识别出可用内容。');recognizing=false;say('');state('idle');document.dispatchEvent(new CustomEvent('companion:voice-input',{detail:{text:result.reply.transcript,turnId:old.turnId,source:'selected-wav'}}));
 }catch(e){state('error');say(e.message);}
};
$('#voice').onclick=async()=>{
 if(pendingPermission)return cancelInput();if(capturing)return finish();if(!session?.ready){await bootstrap();if(!session?.ready)return say('本地语音尚未接通；可以先使用文字和生成文件。');}
 stopSpeech();if(turn)call('cancel',turn).catch(()=>{});const version=++generation;turn={sessionId:session.sessionId,requestId:crypto.randomUUID(),turnId:crypto.randomUUID()};pendingPermission=true;$('#voice').textContent='取消授权等待';$('#voice-cancel').hidden=false;say('请在浏览器中决定是否允许麦克风；最多录音 30 秒。');
 try{const acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});if(version!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;context=new AudioContext({sampleRate:16000});sampleRate=context.sampleRate;await context.resume();if(version!==generation)return cleanup();const source=context.createMediaStreamSource(stream);processor=context.createScriptProcessor(4096,1,1);const mute=context.createGain();mute.gain.value=0;source.connect(processor);processor.connect(mute);mute.connect(context.destination);chunks=[];frames=0;capturing=true;pendingPermission=false;processor.onaudioprocess=e=>{if(!capturing)return;const c=new Float32Array(e.inputBuffer.getChannelData(0));chunks.push(c);frames+=c.length;if(frames>=sampleRate*30)finish();};$('#voice').textContent='结束并发送';state('listening');say('正在录音 · 点击结束并发送，或取消。');timer=setTimeout(finish,30000);
 }catch{if(version===generation){await cleanup();state('error');say('麦克风未获授权或不可用；文字输入仍可使用。');}}
};
$('#voice-cancel').onclick=cancelInput;$('#speech-stop').onclick=()=>{stopSpeech();say('已停止播报，后台文件任务继续运行。');};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(capturing||pendingPermission)cancelInput();stopSpeech();}});
window.addEventListener('pagehide',()=>{generation++;for(const t of stream?.getTracks()||[])t.stop();context?.close();speechSynthesis?.cancel();if(session)fetch('/api/voice/close',{method:'POST',headers:{'Content-Type':'application/json','X-Voice-Csrf':session.csrf},body:JSON.stringify({sessionId:session.sessionId}),keepalive:true}).catch(()=>{});});

document.addEventListener('companion:stop-speech',()=>stopSpeech());
document.addEventListener('companion:speak',async e=>{
 const text=e.detail?.text;if(!turn||!session||typeof text!=='string'||!text.trim()||!localVoice())return;
 try{stopSpeech();await call('speak',{...turn,utteranceId:crypto.randomUUID(),text:text.slice(0,1000)});poll();}catch{say('文字结果已保留；临时系统播报未完成。');}
});
bootstrap();
