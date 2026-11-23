/** Generate with the selected Pi provider. Do not copy auth files or refresh tokens here. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {piSdkEntry} from './pi-context.ts';

export function imageBlock(data: unknown) {
  if (typeof data !== 'string' || !data.length || data.length > 12*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error('Invalid or oversized generated image.');
  const b=Buffer.from(data,'base64');
  const mimeType=b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if (!mimeType) throw Error('Unsupported image format.');
  return {type:'image',mimeType,data};
}

export async function generatePicture(prompt: string, pi: string, selected: string, signal?: AbortSignal, source?: string) {
  if(!prompt?.trim() || prompt.length>8000) throw Error('Use an image description of 1–8000 characters.');
  const inputImage=source?imageBlock(source):null;
  const sdk=await import(pathToFileURL(piSdkEntry(pi)).href);
  const runtime=await sdk.ModelRuntime.create({allowModelNetwork:false});
  let provider=selected.includes('/')?selected.split('/')[0]:'';
  if (!provider) {
    try {provider=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.pi/agent/settings.json'),'utf8')).defaultProvider || '';} catch {}
    if(!provider){const choices=['openai-codex','openrouter'].filter(p=>runtime.hasConfiguredAuth(p));if(choices.length===1)provider=choices[0];}
  }
  if(!provider)throw Error('Select a Pi provider with image support first.');
  const models=await runtime.getAvailableOfType('image',provider);
  if(models.length){
    const model=models.find((m:any)=>m.id==='google/gemini-2.5-flash-image') || models[0];
    const result=await runtime.generateImages(model,{input:[{type:'text',text:prompt},...(inputImage?[inputImage]:[])]},{signal});
    const image=result.output?.find((b:any)=>b.type==='image');
    if(result.stopReason==='error'||!image)throw Error('The selected provider did not return an image. Check model access and quota.');
    return imageBlock(image.data);
  }
  // The reference ChatGPT subscription uses the Codex image backend. Request tokens
  // only for that provider via Pi; never forward another provider's API key.
  if(provider!=='openai-codex'||!runtime.isUsingOAuth(provider))throw Error(`No image capability for ${provider}. No other provider was charged.`);
  const auth=await runtime.getAuth(provider);const token=auth?.auth?.apiKey;
  if(!token)throw Error('Connect the ChatGPT subscription in Pi first.');
  let account='';try{account=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString())['https://api.openai.com/auth']?.chatgpt_account_id||'';}catch{}
  const url='https://chatgpt.com/backend-api/codex/images/'+(inputImage?'edits':'generations');
  const res=await fetch(url,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,originator:'codex_cli_rs','x-codex-image-turn-id':randomUUID(),...(account?{'ChatGPT-Account-Id':account}:{})},body:JSON.stringify({model:'gpt-image-2',prompt,background:'opaque',quality:'auto',size:'auto',...(inputImage?{images:[{image_url:`data:${inputImage.mimeType};base64,${inputImage.data}`}]}:{})})});
  if(!res.ok||!res.body){await res.body?.cancel();throw Error(`ChatGPT image request failed (HTTP ${res.status}). Check subscription access and quota.`);}
  const chunks=[];let size=0;
  for await(const chunk of res.body as any){size+=chunk.length;if(size>16*1024*1024)throw Error('Image response too large.');chunks.push(Buffer.from(chunk));}
  return imageBlock(JSON.parse(Buffer.concat(chunks).toString()).data?.[0]?.b64_json);
}
