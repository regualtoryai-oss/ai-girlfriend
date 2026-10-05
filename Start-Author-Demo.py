"""Idempotent launcher for the existing official DSH profile and author Voice Bridge."""
import argparse,datetime,json,os,pathlib,shutil,socket,subprocess,sys,time,urllib.request,webbrowser
ROOT=pathlib.Path(__file__).resolve().parent
def port_open(port):
 try:
  with socket.create_connection(('127.0.0.1',port),timeout=.5):return True
 except OSError:return False
def owner_is_expected(port,marker):
 command=f"$owners = Get-NetTCPConnection -LocalPort {port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique; @($owners | ForEach-Object {{ Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_) | Select-Object Name,CommandLine }}) | ConvertTo-Json -Compress"
 result=subprocess.run(['powershell.exe','-NoProfile','-Command',command],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=10,creationflags=subprocess.CREATE_NO_WINDOW)
 if result.returncode:raise RuntimeError('PORT_OWNER_UNKNOWN：无法核实监听进程；已有服务保持不变，请运行 Check-Companion.cmd。')
 try:rows=json.loads(result.stdout)
 except ValueError:raise RuntimeError('PORT_OWNER_UNKNOWN：监听信息不可读；已有服务保持不变。') from None
 rows=rows if isinstance(rows,list) else [rows]
 expected_root=str(ROOT).replace('\\','/').lower()+'/'
 return bool(rows) and all(isinstance(row,dict) and marker in (row.get('CommandLine') or '') and expected_root in (row.get('CommandLine') or '').replace('\\','/').lower() for row in rows)
def preflight(node,text_only=False,runner=subprocess.run):
 """Inspect the original environment before creating logs or starting any process."""
 result=runner([node,str(ROOT/'scripts/doctor.mjs'),'--json','--mode','text' if text_only else 'voice','--python',sys.executable],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
 try:report=json.loads(result.stdout)
 except (ValueError,TypeError):raise RuntimeError('DOCTOR_FAILED：诊断未完成，没有启动服务；请运行 Check-Companion.cmd。') from None
 if report.get('schema_version')!=1 or report.get('read_only') is not True:raise RuntimeError('DOCTOR_FAILED：诊断格式无效，没有启动服务。')
 if result.returncode:report['ready']=False
 return report

def display_report(report,as_json=False):
 if as_json:print(json.dumps(report,ensure_ascii=True,indent=2),flush=True);return
 print(f"环境诊断：{report.get('status','diagnostic-error')}（未启动服务）",flush=True)
 for check in report.get('checks',[]):
  if check.get('code') in report.get('error_codes',[]):print(f"  {check['code']}：{check.get('message','')}",flush=True)
 for action in report.get('next_actions',[]):print('建议：'+action,flush=True)
 if report.get('capabilities',{}).get('ui_startable') and not report.get('ready'):print('可明确选择：npm start -- --text-only（同一桥和人物媒体；语音暂不可用，不更换原模型）。',flush=True)

def main(argv=None):
 parser=argparse.ArgumentParser();parser.add_argument('--no-open',action='store_true');parser.add_argument('--check',action='store_true');parser.add_argument('--json',action='store_true');parser.add_argument('--text-only',action='store_true');args=parser.parse_args(argv)
 node=shutil.which('node')
 if not node:raise RuntimeError('NODE_24_REQUIRED：请安装 Node.js 24 或更高版本，然后重新打开终端。')
 report=preflight(node,args.text_only)
 if args.check or not report.get('ready'):
  display_report(report,args.json);return 0 if report.get('ready') else 2
 if not report.get('capabilities',{}).get('task_ready'):print('页面可启动；费用和任务守卫仍关闭，模型/Jev 任务不会获准执行。',flush=True)
 allowed={'PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','TEMP','TMP'}
 env={k:v for k,v in os.environ.items() if k.upper() in allowed}
 stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S');logs=ROOT/'logs';logs.mkdir(exist_ok=True)
 for key in ('COMPANION_RELAY_API_KEY','COMPANION_JEV_KEY','COMPANION_XLSX_PYTHON','COMPANION_PROBE_SESSION_ID','COMPANION_PROBE_RECOVERY_TASK_ID','COMPANION_ARTIFACT_PROXY'):
  if os.environ.get(key):env[key]=os.environ[key]
 services=[('voice',8765,'uvicorn voice_bridge:app',[str(ROOT/'.venv-voice/Scripts/python.exe'),str(ROOT/'dsh/author/launch-author-voice.py')]),('host',8796,'--profile author-web',[node,str(ROOT/'dsh/author/launch-author.mjs')])]
 for _,port,marker,_ in services:
  if port_open(port) and not owner_is_expected(port,marker):raise RuntimeError(f'PORT_IN_USE：端口 {port} 属于其他项目，现有服务保持不变。')
 for label,port,marker,command in services:
  if port_open(port):
   if not owner_is_expected(port,marker):raise RuntimeError(f'PORT_IN_USE：端口 {port} 归属发生变化，现有服务保持不变。')
   print(f'{label}：复用已核实的此仓库服务，端口 {port}。',flush=True);continue
  with open(logs/f'author-{label}-{stamp}.log','ab',buffering=0) as log:
   process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
  deadline=time.monotonic()+40
  while not port_open(port):
   if process.poll() is not None:raise RuntimeError(f'SERVICE_EXITED：{label} 未启动；查看 logs/{pathlib.Path(log.name).name}。其他服务保留。')
   if time.monotonic()>deadline:raise RuntimeError(f'SERVICE_START_PENDING：{label} 尚未确认，进程保留；查看 logs/{pathlib.Path(log.name).name}，请勿重复启动。')
   time.sleep(.3)
  if not owner_is_expected(port,marker):raise RuntimeError(f'PORT_OWNER_CHANGED：端口 {port} 归属发生变化，停止后续启动；现有进程保持不变。')
  print(f'{label}：监听端口 {port}。',flush=True)
 with urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=5) as r:health=json.load(r)
 print(json.dumps({'mode':'explicit-text' if args.text_only else 'voice','bridgeListening':True,'voiceReady':health.get('voice_ready') is True or health.get('readiness',{}).get('status')=='ready','modelsLoadOnFirstUse':True,'microphoneRequested':False,'portrait':'approved-cached-motion-not-lip-sync'},ensure_ascii=False),flush=True)
 if not args.no_open:
  # The existing DSH launcher owns this local authenticated URL. Never print it.
  launch=ROOT/'workspaces/author-host/author-launch-url.txt'
  for _ in range(40):
   if launch.exists():break
   time.sleep(.25)
  if not launch.exists():raise RuntimeError('AUTHOR_URL_PENDING：页面链接尚未生成；服务保留，请查看 host 日志。')
  target=launch.read_text(encoding='utf-8').strip()
  if not target.startswith('http://127.0.0.1:8796/'):raise RuntimeError('AUTHOR_URL_INVALID：页面链接格式不符，未打开浏览器；服务保留。')
  webbrowser.open(target)
 print('页面就绪。交付入口：http://127.0.0.1:8796/api/companion/deliverables（同一已认证浏览器）。',flush=True)
if __name__=='__main__':
 try:sys.exit(main() or 0)
 except RuntimeError as error:print(str(error),file=sys.stderr);sys.exit(2)
 except (OSError,subprocess.SubprocessError,ValueError):print('AUTHOR_START_FAILED：本次启动未完成；已有进程保持不变，请运行 Check-Companion.cmd 并检查 logs/。',file=sys.stderr);sys.exit(2)
