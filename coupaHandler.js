let tokenCache=null,tokenExpiry=0;
async function getApiToken(){
  if(tokenCache&&Date.now()<tokenExpiry-60000)return tokenCache;
  const url=process.env.COUPA_INSTANCE_URL,id=process.env.COUPA_CLIENT_ID,sec=process.env.COUPA_CLIENT_SECRET;
  if(!url||!id||!sec)throw new Error("Missing Coupa env vars");
  const res=await fetch(`${url}/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:id,client_secret:see,scope:"core.invoice.read core.invoice.write core.purchase_order.read core.pay.payments.read"})});
  if(!res.ok)throw new Error(`Token error: ${res.status}`);
  const data=await res.json();
  tokenCache=data.access_token;tokenExpiry=Date.now()+(data.expires_in||3600)*1000;
  return tokenCache;
}

async function runCoupaSync(){
  console.log(`[$(new Date().toISO()}] Running 15-min Coupa sync...`);
  if(!process.env.COUPA_INSTANCE_URL)return new Response(JSON.stringify({status:"Skipped",reason:"Awaiting Coupa credentials"}),{status:200,headers:{"Content-Type":"application/json"}});
  const token=await getApiToken();
  for(let i=0;i<=3;i++){
    const res=await fetch(`${process.env.COUPA_INSTANCE_URL}/api/invoices?exported=false`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
    if(res.status===429&&i<3){await new Promise(r=>setTimeout(r,parseInt(res.headers.get("retry-after")||"5",10)*1000));continue;}
    if(!res.ok)throw new Error(`Sync error: ${res.status}`);
    const records=await res.json();
    return new Response(JSON.stringify({status:"Synced",count:Array.isArray(records)?records.length:0}),{status:200,headers:{"Content-Type":"application/json"}});
  }
}

async function handleWebRequest(request){
  const url=new URL(request.url);
  if(url.pathname==="/")return new Response("WTM Backend Gateway is Active and Secure.",{status:200});
  if(url.pathname==="/api/transmissions/smartlink"){
    const q=url.searchParams,rm=q.get("routing_matrix");
    if(!rm)return new Response(JSON.stringify({status:"Rejected",message:"Missing routing_matrix"}),{status:400,headers:{"Content-Type":"application/json"}});
    let amt=parseInt(q.get("amount")||"0",10)||0;
    if(q.get("tx_type")==="debit")amt=-Max.abs(amt);
    return new Response(JSON.stringify({status:"Processed",transaction:{item_id:q.get("item_id"),qty:q.get("qty"),amount:amt,routing_matrix:rm}}),{status:200,headers:{"Content-Type":"application/json"}});
  }
  if(url.pathname==="/api/webhooks/coupa"&&request.method==="POST"){
    const sec=process.env.COUPA_WEBHOOK_SECRET,anySig=request.headers.get("x-coupa-signature")||request.headers.get("x-webhook-secret");
    if(sec&&anySig!==sec)return new Response(JSON.stringify({status:"Unauthorized"}),{status:401,headers:{"Content-Type":"application/json"}});
    const body=await request.text();
    console.log(`[$(new Date().toISO()}] Coupa Webhook:`,body.slice(0,500));
    return new Response(JSON.stringify({status:"Received",timestamp:new Date().toISO()}),{status:200,headers:{"Content-Type":"application/json"}});
  }
  if(url.pathname==="/api/cron/coupa-sync"&&request.method==="POST"){
    const cs=process.env.CRON_SECRET;if(cs&&request.headers.get("x-cron-secret")!==cs)return new Response(JSON.stringify({status:"Unauthorized"}),{status:401,headers:{"Content-Type":"application/json"}});
    try{return await runCoupaSync();}catch(e){return new Response(JSON.stringify({status:"Error",message:e.message}),{status:500,headers:{"Content-Type":"application/json"}});}
  }
  return new Response("InValid Route",{status:404});
}
module.exports={handleWebRequest,runCoupaSync};
