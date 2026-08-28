const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,OPTIONS'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...CORS}});
const encoder=new TextEncoder();
async function sha256(value){const d=await crypto.subtle.digest('SHA-256',encoder.encode(value));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cookie(request,name){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}
export async function onRequestGet({request,env}){try{if(!env.DB)return json({authenticated:false});const raw=cookie(request,'ddj_session');if(!raw)return json({authenticated:false});const hash=await sha256(raw);const row=await env.DB.prepare('SELECT c.email,s.expires_at FROM sessions s JOIN coaches c ON c.id=s.coach_id WHERE s.token_hash=?').bind(hash).first();if(!row||Number(row.expires_at)<=Date.now())return json({authenticated:false});return json({authenticated:true,email:row.email});}catch(error){console.error('GET /api/auth/me error:',error);return json({authenticated:false});}}
