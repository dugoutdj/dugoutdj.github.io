import { sha256, getSessionToken } from '../../_lib/security.js';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...CORS,...headers}});
export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}
export async function onRequestPost({request,env}){
  const raw=getSessionToken(request);
  if(raw&&env?.DB){
    try{
      const hash=await sha256(raw);
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();
    }catch{}
  }
  return json({ok:true},200,{'Set-Cookie':'ddj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
}
