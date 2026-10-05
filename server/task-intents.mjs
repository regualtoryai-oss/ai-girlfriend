export function taskCandidates(message){return [{id:'chat',action:'chat',args:{message:'普通闲聊、问答，不需要生成文件或调用图像/视频模型'}},...[
 ['workspace-task','文字、表格、整理目录、读取修改普通文件'],['coding','生成或修改程序代码并验证'],['image','生成真正的图片，调用图像生成接口'],['video','生成真正的视频，调用视频生成接口'],['compound','跨图片、视频、代码等多种能力的复合任务']
].map(([id,label])=>({id,action:'task',args:{instruction:label+'。用户需求：'+message.slice(0,3400),capability:'local_write'}})),{id:'clarify',action:'clarify',args:{question:'需求缺少必要信息，请澄清'}}];}
