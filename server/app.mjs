import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Jobs} from './jobs.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.COMPANION_PORT||8793), origin=`http://127.0.0.1:${port}`;
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
const jobs=new Jobs(path.join(root,'data/tasks'));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.mp4':'video/mp4','.json':'application/json','.md':'text/markdown; charset=utf-8'};
const server=http.createServer(async(req,res)=>{try{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
 if(req.headers.host!==`127.0.0.1:${port}`)return json(res,403,{error:'Local host required'});
 if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Same origin required'});
 const url=new URL(req.url,origin),p=url.pathname;
 if(p==='/api/status'&&req.method==='GET')return json(res,200,{app:'companion-agent-preview',executor:'bounded-local-file',harness:'source-ready-not-connected',jev:'not-connected',llm:'not-connected',voice:'not-connected',microphone:false});
 if(p==='/api/chat')return json(res,503,{error:'对话模型尚未连接。你的输入可保存在本机记录中，不会生成虚构回复。'});
 if(p==='/api/tasks'&&req.method==='POST'){
  if(req.headers['content-type']!=='application/json')return json(res,415,{error:'JSON required'});
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>12000)return json(res,413,{error:'Body too large'});}
  let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
  return json(res,202,jobs.create(input));
 }
 const match=p.match(/^\/api\/tasks\/([a-f0-9-]{36})(\/cancel)?$/);
 if(match){if(req.method!==(match[2]?'POST':'GET'))return json(res,405,{error:'Method not allowed'});const j=match[2]?jobs.cancel(match[1]):jobs.jobs.get(match[1]);return json(res,j?200:404,j||{error:'Unknown task'});}
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
 let file;
 if(/^\/files\/note-[a-f0-9-]{36}\.md$/.test(p)){file=path.join(root,'data/tasks',path.basename(p));res.setHeader('Content-Disposition',`attachment; filename="${path.basename(p)}"`);}
 else {const rel=decodeURIComponent(p==='/'?'/index.html':p);file=path.resolve(root,'public','.'+rel);if(!file.startsWith(path.join(root,'public')+path.sep))return json(res,403,{error:'Path rejected'});}
 const s=await stat(file);if(!s.isFile())return json(res,404,{error:'Not found'});
 const data=await readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');
 if(req.headers.range&&path.extname(file)==='.mp4'){const m=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!m)return json(res,416,{error:'Invalid range'});const a=Number(m[1]),b=Math.min(m[2]?Number(m[2]):data.length-1,data.length-1);if(a>b||a>=data.length){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});return res.end();}res.writeHead(206,{'Accept-Ranges':'bytes','Content-Range':`bytes ${a}-${b}/${data.length}`,'Content-Length':b-a+1});return res.end(req.method==='HEAD'?undefined:data.subarray(a,b+1));}
 res.writeHead(200,{'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){json(res,e.status||(e.code==='ENOENT'?404:500),{error:e.status?e.message:'资源暂不可用'});}});
server.listen(port,'127.0.0.1',()=>console.log(`Companion preview ${origin} | bounded-local-file | no model / microphone`));
