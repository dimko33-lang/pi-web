// The caller supplies a bounded local Piper WAV. No URLs or external audio input.
const fs=require('node:fs');
async function main(){
  const size=fs.fstatSync(0).size;if(size<=44||size>16*1024**2)throw Error();
  global.self={location:{href:'file:///encoder/'}};
  const c=await require('@ffmpeg/core')({wasmBinary:fs.readFileSync(require.resolve('@ffmpeg/core/wasm')),locateFile:s=>s});
  c.FS.writeFile('answer.wav',fs.readFileSync(0));
  if(c.exec('-v','error','-f','wav','-i','answer.wav','-map','0:a:0','-ac','1','-ar','48000','-c:a','libopus','-application','voip','-b:a','48k','-f','ogg','voice.ogg')!==0)throw Error();
  const data=c.FS.readFile('voice.ogg');if(data.length>2*1024**2)throw Error();process.stdout.write(Buffer.from(data));
}
main().catch(()=>{process.exitCode=1;});
