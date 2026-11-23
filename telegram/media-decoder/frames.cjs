// Only MEMFS is exposed to this single-threaded WebAssembly decoder. No host paths, URLs or audio.
const fs = require('node:fs');
const formats = {'image/gif':'gif','video/mp4':'mov','video/quicktime':'mov','video/webm':'matroska'};
async function main() {
  const format = formats[process.argv[2]];
  if (!Object.hasOwn(formats,process.argv[2])) throw Error();
  let bytes=0; const chunks=[];
  for await (const b of process.stdin) {bytes+=b.length;if(bytes>5000000) throw Error();chunks.push(b);}
  if (!bytes) throw Error();
  global.self={location:{href:'file:///decoder/'}};
  const core=await require('@ffmpeg/core')({wasmBinary:fs.readFileSync(require.resolve('@ffmpeg/core/wasm')),locateFile:s=>s});
  core.FS.writeFile('input',Buffer.concat(chunks));
  const input=['-protocol_whitelist','file','-max_alloc','33554432','-f',format,'-i','input'];
  core.ffprobe('-v','error',...input,'-select_streams','v:0','-show_entries','stream=width,height:format=duration','-of','json','-o','info');
  const meta=JSON.parse(core.FS.readFile('info',{encoding:'utf8'}));
  const {width,height}=meta.streams[0], duration=Number(meta.format.duration);
  if (!(width>0 && height>0 && width<=4096 && height<=4096 && width*height<=8294400 && duration>0 && duration<=120)) throw Error();
  core.reset();
  // First frame and up to five later frames, sampled in presentation order. EOF pads unused cells.
  const interval=(duration/6).toFixed(6);
  const vf=`select='isnan(prev_selected_t)+gt(floor(t/${interval}),floor(prev_selected_t/${interval}))',scale=384:256:force_original_aspect_ratio=decrease,pad=384:256:(ow-iw)/2:(oh-ih)/2,setsar=1,tile=3x2`;
  if(core.exec('-v','error','-threads','1',...input,'-map','0:v:0','-an','-sn','-dn','-vf',vf,'-frames:v','1','-threads','1','-q:v','3','out.jpg')!==0) throw Error();
  const frame=core.FS.readFile('out.jpg');if(frame.length>1000000 || frame[0]!==255 || frame[1]!==216) throw Error();
  process.stdout.write(frame);
}
main().catch(()=>{process.exitCode=1;});
