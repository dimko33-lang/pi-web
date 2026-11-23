// Read only fd 0, supplied by the transport. The WASM filesystem exposes that one file and memory-only output.
const fs=require('node:fs');
const formats={'image/gif':'gif','video/mp4':'mov','video/quicktime':'mov','video/webm':'matroska',
  'image/jpeg':'jpeg_pipe','image/png':'png_pipe','image/webp':'webp_pipe'};
async function main(){
  const mime=process.argv[2],st=fs.fstatSync(0);
  if(!Object.hasOwn(formats,mime)||!st.isFile()||!st.size||st.size>4*1024**3)throw Error('Input');
  global.self={location:{href:'file:///decoder/'}};
  const core=await require('@ffmpeg/core')({wasmBinary:fs.readFileSync(require.resolve('@ffmpeg/core/wasm')),locateFile:s=>s});
  const F=core.FS;F.writeFile('input',new Uint8Array(0));
  const node=F.lookupPath('/input').node;node.usedBytes=st.size;
  node.stream_ops={...node.stream_ops,read:(_stream,heap,start,len,pos)=>{
    if(!Number.isSafeInteger(pos)||pos<0)throw Error('Invalid offset');
    return fs.readSync(0,heap,start,Math.min(len,Math.max(0,st.size-pos)),pos);
  }};
  const input=['-protocol_whitelist','file','-max_alloc','67108864','-f',formats[mime],'-i','input'];
  core.ffprobe('-v','error',...input,'-select_streams','v:0','-show_entries','stream=width,height,duration:format=duration','-of','json','-o','info');
  const meta=JSON.parse(F.readFile('info',{encoding:'utf8'})), stream=meta.streams[0];
  if(!stream || !(stream.width>0 && stream.height>0 && stream.width*stream.height<=32000000)) throw Error('No decodable image');
  const still=mime.startsWith('image/')&&mime!=='image/gif',duration=Number(stream.duration)||Number(meta.format.duration);
  if(!still && !(Number.isFinite(duration)&&duration>0))throw Error('Unknown duration');
  const exec=(...args)=>{core.reset();return core.exec('-v','error','-threads','1',...args);};
  let count=0;
  for(let i=0;i<(still?1:6);i++){
    const seek=i?['-ss',(duration*i/6).toFixed(6)]:[];
    // Seek each time instead of decoding the entire movie through a frame-selection filter.
    const vf=still?'scale=\'min(1600,iw)\':\'min(1600,ih)\':force_original_aspect_ratio=decrease':'scale=384:256:force_original_aspect_ratio=decrease,pad=384:256:(ow-iw)/2:(oh-ih)/2';
    const name=`f${count+1}.bmp`; // Lossless intermediate: no JPEG encoder inside the video decode graph.
    if(exec(...(mime==='image/gif'?[]:seek),...input,...(mime==='image/gif'?seek:[]),'-map','0:v:0','-an','-sn','-dn','-vf',vf+',setsar=1','-frames:v','1','-threads','1','-q:v','3',name)!==0)throw Error('Decode failed');
    if(F.analyzePath(name).exists)count++;
  }
  if(!count)throw Error('No samples');
  if(exec('-f','image2','-start_number','1','-i','f%d.bmp',...(still?[]:['-vf','tile=3x2']),'-frames:v','1','-threads','1','-q:v','3','output.jpg')!==0)throw Error('Layout failed');
  const b=F.readFile('output.jpg');if(!b.length || b.length>5000000 || b[0]!==255 || b[1]!==216)throw Error('Output');
  process.stdout.write(b);
}
main().catch(()=>{process.exitCode=1;});
