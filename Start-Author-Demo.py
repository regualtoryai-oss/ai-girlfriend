"""Idempotent launcher for the existing official DSH profile and author Voice Bridge."""
import argparse,datetime,json,os,pathlib,socket,subprocess,time,urllib.request,webbrowser
ROOT=pathlib.Path(__file__).resolve().parent
def port_open(port):
 try:
  with socket.create_connection(('127.0.0.1',port),timeout=.5):return True
 except OSError:return False
def owner_is_expected(port,marker):
 command=f"$owners = Get-NetTCPConnection -LocalPort {port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique; @($owners | ForEach-Object {{ Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_) | Select-Object Name,CommandLine }}) | ConvertTo-Json -Compress"
 result=subprocess.run(['powershell.exe','-NoProfile','-Command',command],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=10,creationflags=subprocess.CREATE_NO_WINDOW)
 if result.returncode:raise RuntimeError('Cannot verify existing listener ownership')
 rows=json.loads(result.stdout);rows=rows if isinstance(rows,list) else [rows]
 expected_root=str(ROOT).replace('\\','/').lower()+'/'
 return bool(rows) and all(marker in (row.get('CommandLine') or '') and expected_root in (row.get('CommandLine') or '').replace('\\','/').lower() for row in rows)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--no-open',action='store_true');args=parser.parse_args()
 allowed={'PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','TEMP','TMP'}
 env={k:v for k,v in os.environ.items() if k.upper() in allowed}
 stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S');logs=ROOT/'logs';logs.mkdir(exist_ok=True)
 import shutil
 for key in ('COMPANION_RELAY_API_KEY','COMPANION_JEV_KEY','COMPANION_XLSX_PYTHON','COMPANION_PROBE_SESSION_ID','COMPANION_PROBE_RECOVERY_TASK_ID','COMPANION_ARTIFACT_PROXY'):
  if os.environ.get(key):env[key]=os.environ[key]
 node=shutil.which('node')
 if not node:raise RuntimeError('Node.js 24 is required')
 services=[('voice',8765,'uvicorn voice_bridge:app',[str(ROOT/'.venv-voice/Scripts/python.exe'),str(ROOT/'dsh/author/launch-author-voice.py')]),('host',8796,'--profile author-web',[node,str(ROOT/'dsh/author/launch-author.mjs')])]
 for label,port,marker,command in services:
  if port_open(port):
   if not owner_is_expected(port,marker):raise RuntimeError(f'Port {port} belongs to another process; left untouched')
   print(f'{label}: existing verified listener on 127.0.0.1:{port}',flush=True);continue
  with open(logs/f'author-{label}-{stamp}.log','ab',buffering=0) as log:
   process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
  deadline=time.monotonic()+40
  while not port_open(port):
   if process.poll() is not None:raise RuntimeError(f'{label} exited; see {log.name}')
   if time.monotonic()>deadline:raise RuntimeError(f'{label} startup not confirmed; process retained, see {log.name}')
   time.sleep(.3)
  print(f'{label}: listening on 127.0.0.1:{port}',flush=True)
 with urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=5) as r:health=json.load(r)
 print(json.dumps({'voiceHealth':health,'modelsLoadOnFirstUse':True,'microphoneRequested':False,'portrait':'approved-cached-motion-not-lip-sync'},ensure_ascii=True),flush=True)
 if not args.no_open:
  # The existing DSH launcher owns this local authenticated URL. Never print it.
  launch=ROOT/'workspaces/author-host/author-launch-url.txt'
  for _ in range(40):
   if launch.exists():break
   time.sleep(.25)
  target=launch.read_text(encoding='utf-8').strip()
  if not target.startswith('http://127.0.0.1:8796/'):raise RuntimeError('Unexpected local launch URL')
  webbrowser.open(target)
 print('Ready. Deliverables: http://127.0.0.1:8796/api/companion/deliverables (same authenticated browser).',flush=True)
if __name__=='__main__':main()
