import {writeFileSync} from 'node:fs';
export const name='companion-native-ui';
export const inject=['webServer','connection','sessionController','companionDecision','tools','appReady'];
export function apply(ctx){
 ctx.effect(()=>ctx.connection.fetch.register({path:'/api/companion/status',methods:['GET'],requestBody:'buffered',async fetch(){return Response.json({app:'companion-dsh-native',runtime:'DSH 0.1.3-alpha.1',host:'official-webserver',sessions:'official-session-controller',jev:ctx.companionDecision.status(),tools:ctx.tools.schemas().map(x=>x.name),externalModelCalls:0});}}));
 ctx.effect(()=>ctx.appReady.onReady(()=>{writeFileSync('native-launch-url.txt',ctx.connection.authenticatedUrl('http://127.0.0.1:8794'),{mode:0o600});process.stderr.write(JSON.stringify({nativeHostReady:true,url:'http://127.0.0.1:8794'})+'\n');}));
}
