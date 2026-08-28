const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...CORS,...headers}});
export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}
export async function onRequestPost(){return json({ok:true},200,{'Set-Cookie':'ddj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});}
