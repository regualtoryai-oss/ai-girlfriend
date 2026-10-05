"""Local-only CPU ASR using the existing model; no downloads or audio files."""
import os,io,json,wave,threading,time
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
import numpy as np,torch
from transformers import AutoFeatureExtractor,AutoTokenizer,WhisperForConditionalGeneration
root=Path(os.environ.get('COMPANION_WHISPER_MODEL',str(Path(__file__).resolve().parent.parent/'models'/'whisper')))
torch.set_num_threads(4)
extractor=AutoFeatureExtractor.from_pretrained(root,local_files_only=True)
tokenizer=AutoTokenizer.from_pretrained(root,local_files_only=True)
model=WhisperForConditionalGeneration.from_pretrained(root,local_files_only=True).eval()
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def respond(self,status,data):
  b=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers()
  try:self.wfile.write(b)
  except (BrokenPipeError,ConnectionResetError):pass
 def allowed(self):return self.headers.get('Host')=='127.0.0.1:8795' and not self.headers.get('Origin')
 def do_GET(self):
  if not self.allowed() or self.path!='/health':return self.respond(403,{'error':'local-only'})
  self.respond(200,{'ready':True,'device':'cpu','format':'pcm16-mono-16000','model':'existing-local-whisper'})
 def do_POST(self):
  if not self.allowed() or self.path!='/transcribe':return self.respond(403,{'error':'local-only'})
  length=int(self.headers.get('Content-Length','0'))
  if self.headers.get('Content-Type')!='audio/wav' or not 684<=length<=960044:return self.respond(400,{'error':'invalid-wav'})
  if not lock.acquire(blocking=False):return self.respond(429,{'error':'busy'})
  try:
   raw=self.rfile.read(length)
   with wave.open(io.BytesIO(raw),'rb') as f:
    if f.getnchannels()!=1 or f.getframerate()!=16000 or f.getsampwidth()!=2 or f.getnframes()>480000:raise ValueError()
    audio=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768
   if np.max(np.abs(audio),initial=0)<0.0001:return self.respond(200,{'text':''})
   features=extractor(audio,sampling_rate=16000,return_tensors='pt').input_features
   with torch.inference_mode():ids=model.generate(features,language='zh',task='transcribe',max_new_tokens=192)
   text=tokenizer.batch_decode(ids,skip_special_tokens=True)[0].strip()
   self.respond(200,{'text':text})
  except Exception:self.respond(400,{'error':'recognition-failed'})
  finally:lock.release()
server=ThreadingHTTPServer(('127.0.0.1',8795),Handler);server.daemon_threads=True
print(json.dumps({'ready':True,'port':8795,'device':'cpu','downloads':False}),flush=True)
server.serve_forever()
