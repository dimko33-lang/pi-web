const net=require('node:net');
net.createServer(client=>{const upstream=net.createConnection('/run/deps.sock');client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.pipe(upstream).pipe(client);}).listen(18880,'127.0.0.1');
