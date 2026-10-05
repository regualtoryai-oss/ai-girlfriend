/** Bound each official model request without changing its recorded messages. */
export function validateLimits(config) {
 const {maxRequestBytes,maxOutputTokens}=config??{};
 if(!Number.isInteger(maxRequestBytes)||maxRequestBytes<65536||maxRequestBytes>262144||!Number.isInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8192)throw Error('INVALID_AUTHOR_REQUEST_LIMIT_CONFIG');
 return {maxRequestBytes,maxOutputTokens};
}
export function requestAllowance(options,config) {
 const limits=validateLimits(config),outputTokens=options.maxTokens??limits.maxOutputTokens;
 if(!Number.isInteger(outputTokens)||outputTokens<1||outputTokens>limits.maxOutputTokens)throw Error('本次输出超过演示单次上限；请缩短任务。');
 const requestBytes=Buffer.byteLength(JSON.stringify({messages:options.messages,system:options.system,tools:options.tools}));
 if(requestBytes>limits.maxRequestBytes)throw Error('会话已达到演示请求上限；请新建会话继续。此次请求未发送，原记录和文件已保留。');
 // UTF-8 byte count conservatively bounds BPE text tokens; include framing allowance.
 return {requestBytes,outputTokens,inputTokens:Math.max(65536,requestBytes+8192)};
}
