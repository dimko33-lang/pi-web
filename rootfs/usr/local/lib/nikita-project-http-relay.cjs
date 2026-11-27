// Trusted ingress only. The application shares the network namespace, never this socket directory.
const net=require('node:net'),fs=require('node:fs');const path='/ingress/http.sock';try{fs.unlinkSync(path);}catch(e){if(e.code!=='ENOENT')throw e;}
net.createServer(client=>{const app=net.createConnection(5080,'127.0.0.1');client.on('error',()=>app.destroy());app.on('error',()=>client.destroy());client.pipe(app).pipe(client);}).listen(path,()=>fs.chmodSync(path,0o666));
