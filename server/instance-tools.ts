import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { generatePicture } from './instance-image.ts';
export async function science(request: {action:string,code?:string,seconds?:number,arxiv_id?:string,format?:string}, scope=randomBytes(16).toString('hex')):Promise<any> {
  if(!['python','download','files'].includes(request.action)||!/^([a-f0-9]{32})$/.test(scope))throw Error('Invalid science operation.');
  const line=JSON.stringify({...request,scope})+'\n';if(Buffer.byteLength(line)>128000)throw Error('Scientific request too large.');
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection('/run/pi-web-science/worker.sock');const chunks:Buffer[]=[];let size=0;
    socket.setTimeout(320000,()=>socket.destroy(Error('Computation timed out.')));
    socket.once('connect',()=>socket.write(line));socket.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>256000){socket.destroy(Error('Scientific output limit exceeded.'));return;}chunks.push(chunk);});
    socket.once('error',()=>reject(Error('Isolated science service unavailable; code was not run on the host.')));
    socket.once('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());if(value.error)throw Error(value.error);resolve(value);}catch(e){reject(e);}});
  });
}
export async function executeTool(request:any,pi:string,model:string){
  if(request.action==='image')return generatePicture(request.prompt,pi,model,undefined,request.image);
  return science(request);
}
