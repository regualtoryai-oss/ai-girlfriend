import {spawnSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';import {pythonExecutable} from './python-runtime.mjs';
const fail=c=>Object.assign(new Error(c),{code:c});
export function validateWorkbook(sheets){
 if(!Array.isArray(sheets)||!sheets.length||sheets.length>3)throw fail('INVALID_WORKBOOK');const names=new Set();
 return sheets.map(s=>{if(!s||typeof s.name!=='string'||!s.name.trim()||s.name.length>31||/[\\/?*\[\]:]/.test(s.name)||names.has(s.name.toLowerCase()))throw fail('INVALID_SHEET_NAME');names.add(s.name.toLowerCase());if(!Array.isArray(s.rows)||!s.rows.length||s.rows.length>101)throw fail('WORKBOOK_ROW_LIMIT');let width=0;const rows=s.rows.map(row=>{if(!Array.isArray(row)||!row.length||row.length>12)throw fail('WORKBOOK_COLUMN_LIMIT');width=Math.max(width,row.length);return row.map(v=>{if(v===null||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))return v;if(typeof v==='string'&&v.length<=500&&!v.includes('\0'))return v;throw fail('INVALID_CELL');});});return {name:s.name,rows:rows.map(row=>[...row,...Array(width-row.length).fill(null)])};});
}
export function createWorkbookBytes(sheets){
 sheets=validateWorkbook(sheets);const python=pythonExecutable();
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];env.PYTHONIOENCODING='utf-8';
 const r=spawnSync(python,[path.join(path.dirname(fileURLToPath(import.meta.url)),'workbook.py')],{input:JSON.stringify({sheets}),env,windowsHide:true,timeout:20000,maxBuffer:2*1024*1024});if(r.error?.code==='ENOENT')throw fail('XLSX_RUNTIME_MISSING');if(r.status!==0||!r.stdout?.subarray(0,2).equals(Buffer.from('PK')))throw fail('XLSX_GENERATION_FAILED');return r.stdout;
}
