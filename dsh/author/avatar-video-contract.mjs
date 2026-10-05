import {createHash} from 'node:crypto';
export const APPROVED_PHOTO_SHA256='c06e32f1efb2d8c9756dd397f23f527bc9de6be05639a9a476188a5b0c2d0708';
export const AVATAR_RESERVATION_USD=.75;
export function buildAvatarRequest({prompt,reference_photo,duration},photo){
 if(reference_photo!=='approved-original'||duration!==10)throw Error('AVATAR_SCOPE_MISMATCH');
 if(typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>2000)throw Error('AVATAR_PROMPT_INVALID');
 if(!Buffer.isBuffer(photo)||photo.length>12*1024*1024||createHash('sha256').update(photo).digest('hex')!==APPROVED_PHOTO_SHA256)throw Error('AVATAR_PHOTO_MISMATCH');
 return {model:'grok-imagine-video',prompt,image:{url:'data:image/png;base64,'+photo.toString('base64')},duration:10,resolution:'720p'};
}
export function summarizeAvatarRequest(body,photo){return {model:body.model,duration:body.duration,resolution:body.resolution,imageField:'image.url data URI',photoSha256:APPROVED_PHOTO_SHA256,photoBytes:photo.length,endpoint:'/v1/videos/generations',compatibility:'one bounded relay compatibility trial; acceptance of image conditioning is unverified until visual QA',directXaiReferenceUSD:.702,reservedUSD:AVATAR_RESERVATION_USD,notRelayInvoice:true};}
