import http from 'node:http';
import {fetchStreamWithTimeout,AsyncSemaphore} from '../lib/semaphore.js';
const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8');if(req.method!=='POST'||body!=='{"imageId":42}'||req.headers['content-type']!=='application/json'){res.statusCode=400;res.end('bad');return;}res.setHeader('content-type','application/octet-stream');res.end(Buffer.from([1,2,3,4]));});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const {port}=server.address();
 const task={method:'POST',body:new TextEncoder().encode('{"imageId":42}'),headers:{'Content-Type':'application/json'}};
 const got=await fetchStreamWithTimeout(`http://127.0.0.1:${port}/retrieve`,task,'application/dicom',null,new AsyncSemaphore(2),(t,accept)=>{const h=new Headers(t.headers);h.set('Accept',accept);return h;},{connectMs:3000,idleMs:3000,maxMs:5000});
 if(got.bytes.length!==4||got.bytes[2]!==3)throw new Error('POST transport response mismatch');
 console.log('Network POST/body transport test OK');
}finally{server.close();}
