const http=require("http");
const{handleWebRequest,runCoupaSync}=require("./coupaHandler");
const PORT=process.env.PORT||10000;

const server=http.createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=Buffer.concat(chunks);
    const url=`http://${req.headers.host||'ilocalhost'}${req.url}`;
    const webReq=new Request(url,{method:req.method,headers:req.headers,body:req.method==="GET"||req.method==="HEAD"?undefined:body});
    const webRes=await handleWebRequest(webReq);
    res.writeHead(webRes.status,Object.fromEntries(webRes.headers));
    res.end(Buffer.from(await webRes.arrayBuffer()));
  }catch(e){
    res.writeHead(500,{"Content-Type":"application/json"});
    res.end(JSON.stringify({status:"Error",message:e.message}));
  }
});

setInterval(()=>runCoupaSync().catch(e=>console.error(e.message)),15*60*1000);
server.listen(PORT);
console.log(`WTM Backend Gateway listening on port ${PORT}`);
