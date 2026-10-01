// Only structural fields reach the logger. User text, credentials and raw errors never do.
export function createSafeLogger(sink=()=>{}){
 return (event,fields={})=>{
  const row={event:/^[a-z_.-]{1,60}$/.test(event)?event:'unknown'};
  for(const key of ['requestId','turnId','taskId'])if(typeof fields[key]==='string'&&/^[a-f0-9-]{36}$/i.test(fields[key]))row[key]=fields[key];
  if(Number.isInteger(fields.status))row.status=fields.status;
  if(typeof fields.state==='string'&&/^[a-z_-]{1,30}$/.test(fields.state))row.state=fields.state;
  try{sink(row);}catch{}return row;
 };
}
