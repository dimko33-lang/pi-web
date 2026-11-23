// Internal, one request on stdin. No credential or model prompt on the command line.
import {executeTool} from '../server/instance-tools.ts';
const chunks=[];let size=0;
try{
  for await(const b of process.stdin){size+=b.length;if(size>8_000_000)throw Error('Input too large.');chunks.push(b);}
  const {request,model}=JSON.parse(Buffer.concat(chunks).toString());
  const result=await executeTool(request, process.env.PI_WEB_PI_BIN || '', model || '');
  process.stdout.write(JSON.stringify({result}));
}catch(e){process.stdout.write(JSON.stringify({error:'Tool could not complete the request. Check service availability, provider image access and quota.'}));process.exitCode=1;}
