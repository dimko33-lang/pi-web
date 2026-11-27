// Decode only explicitly supported audio containers. Host fd 0 is read-only; never expose host paths or URLs to WASM.
const fs=require('node:fs');
const {once}=require('node:events');
async function main(){
  const st=fs.fstatSync(0);if(!st.isFile()||!st.size||st.size>4*1024**3)throw Error();
  global.self={location:{href:'file:///decoder/'}};
  const c=await require('@ffmpeg/core')({wasmBinary:fs.readFileSync(require.resolve('@ffmpeg/core/wasm')),locateFile:s=>s});
  const F=c.FS;F.writeFile('input',new Uint8Array(0));const n=F.lookupPath('/input').node;n.usedBytes=st.size;
  n.stream_ops={...n.stream_ops,read:(_s,heap,start,len,pos)=>{if(!Number.isSafeInteger(pos)||pos<0)throw Error();return fs.readSync(0,heap,start,Math.min(len,Math.max(0,st.size-pos)),pos);}};
  const fmt=process.argv[2]||'ogg';if(!['ogg','mp3','wav'].includes(fmt))throw Error();
  const input=['-protocol_whitelist','file','-max_alloc','33554432','-f',fmt,'-i','input'];
  c.ffprobe('-v','error',...input,'-select_streams','a:0','-show_entries','stream=codec_name:format=duration','-of','json','-o','info');
  const meta=JSON.parse(F.readFile('info',{encoding:'utf8'}));const duration=Number(meta.format.duration);
  if(!/^(opus|vorbis|mp3|pcm_[a-z0-9]+)$/.test(meta.streams[0]?.codec_name||'')||!Number.isFinite(duration)||duration<=0)throw Error();
  for(let start=0;start<duration;start+=30){
    c.reset();if(c.exec('-v','error','-threads','1',...(start?['-ss',String(start)]:[]),...input,'-t','30','-map','0:a:0','-vn','-dn','-sn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le','out')!==0)throw Error();
    const pcm=F.readFile('out');F.unlink('out');if(pcm.length>960000||(!pcm.length&&!start))throw Error();
    if(!pcm.length)break;
    if(!process.stdout.write(Buffer.from(pcm)))await once(process.stdout,'drain');
  }
}
main().catch(()=>{process.exitCode=1;});
