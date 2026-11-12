const http=require('http'),fs=require('fs'),path=require('path');
try{fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n').forEach(l=>{const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')})}catch{}
const SERVER_KEY=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'';
const BASE=process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com';
const MODEL=process.env.MODEL||'gemini-3.5-flash',PORT=+process.env.PORT||3000;
const SKILL=fs.readFileSync(path.join(__dirname,'SKILL.md'),'utf8').replace(/^---[\s\S]*?---\s*/,'');
const ADDON=`

# App environment
You are running inside a web app with a live skill-map panel. Do NOT draw the ASCII skill map in chat. Instead call the update_skill_map tool (full list of subskills every time) after the diagnostic, after every level change, and whenever the user asks for progress. Mention level changes in one short sentence. Keep every message short, and still end with exactly one question. Treat the user's first message as confirmed intent to be taught.`;
const TOOL={functionDeclarations:[{name:'update_skill_map',description:'Display the current skill map to the user. Always send every subskill.',parameters:{type:'object',properties:{topic:{type:'string'},subskills:{type:'array',items:{type:'object',properties:{name:{type:'string'},level:{type:'integer',description:'0 to 5'},focus:{type:'boolean',description:'true for the current focus subskill'}},required:['name','level']}}},required:['topic','subskills']}}]};

async function turn(msgs,map,send,KEY){
  const contents=msgs.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
  const system=SKILL+ADDON+(map?'\n\nCurrent skill map (authoritative, do not inflate levels): '+JSON.stringify(map).slice(0,3000):'');
  for(let n=0;n<5;n++){
    const r=await fetch(BASE+'/v1beta/models/'+MODEL+':streamGenerateContent?alt=sse',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':KEY},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,tools:[TOOL],generationConfig:{maxOutputTokens:2000}})});
    if(!r.ok){let t=await r.text();try{t=JSON.parse(t).error.message}catch{}send({type:'error',status:r.status,message:'Gemini API '+r.status+': '+String(t).slice(0,300)});return}
    const parts=[],dec=new TextDecoder();let buf='',finish='';
    for await(const c of r.body){
      buf+=dec.decode(c,{stream:true}).replace(/\r\n/g,'\n');let i;
      while((i=buf.indexOf('\n\n'))>=0){
        const raw=buf.slice(0,i);buf=buf.slice(i+2);
        const line=raw.split('\n').find(l=>l.startsWith('data:'));if(!line)continue;
        let e;try{e=JSON.parse(line.slice(5))}catch{continue}
        if(e.error){send({type:'error',message:e.error.message});return}
        const cand=(e.candidates||[])[0];if(!cand)continue;
        if(cand.finishReason)finish=cand.finishReason;
        for(const p of (cand.content&&cand.content.parts)||[]){
          if(p.thought)continue;
          parts.push(p);
          if(p.text)send({type:'text',text:p.text});
        }
      }
    }
    const calls=parts.filter(p=>p.functionCall);
    if(!calls.length){if(!parts.some(p=>p.text)&&finish&&finish!=='STOP')send({type:'error',message:'Gemini stopped: '+finish});return}
    contents.push({role:'model',parts});
    contents.push({role:'user',parts:calls.map(p=>{send({type:'map',map:p.functionCall.args||{}});
      const fr={name:p.functionCall.name,response:{result:'Skill map displayed to the user.'}};if(p.functionCall.id)fr.id=p.functionCall.id;return{functionResponse:fr}})});
  }
}
const hits=new Map(),LIMIT=+process.env.RATE_LIMIT_PER_HOUR||40;
const allowed=ip=>{const now=Date.now(),a=(hits.get(ip)||[]).filter(t=>now-t<36e5);if(a.length>=LIMIT){hits.set(ip,a);return false}a.push(now);hits.set(ip,a);return true};
setInterval(()=>{const n=Date.now();for(const[k,a]of hits)if(!a.some(t=>n-t<36e5))hits.delete(k)},6e5).unref();
const body=(req,max=3e5)=>new Promise((ok,no)=>{let s='',n=0;req.on('data',c=>{n+=c.length;if(n>max){no(new Error('too large'));req.destroy()}else s+=c});req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch{ok({})}});req.on('error',no)});
const H={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"};
const json=(res,c,o)=>{res.writeHead(c,{...H,'content-type':'application/json'});res.end(JSON.stringify(o))};
const clean=m=>{const o=[];if(!Array.isArray(m))return o;for(const x of m.slice(-60)){if(x&&(x.role==='user'||x.role==='assistant')&&typeof x.content==='string'&&x.content){const t=x.content.slice(0,8000),l=o[o.length-1];if(l&&l.role===x.role)l.content+='\n\n'+t;else o.push({role:x.role,content:t})}}while(o.length&&o[0].role!=='user')o.shift();return o};
const ipOf=req=>String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',').pop().trim();
const PAGE=fs.readFileSync(path.join(__dirname,'public','index.html'));
http.createServer(async(req,res)=>{try{
  const u=req.url.split('?')[0],uk=String(req.headers['x-user-key']||'').trim().slice(0,200);
  if(req.method==='GET'&&u==='/healthz')return json(res,200,{ok:true});
  if(req.method==='GET'&&u==='/api/status')return json(res,200,{serverKey:!!SERVER_KEY,model:MODEL});
  if(req.method==='GET'&&u==='/api/check'){
    if(!uk)return json(res,200,{ok:false,message:'Paste a key first.'});
    const r=await fetch(BASE+'/v1beta/models/'+MODEL,{headers:{'x-goog-api-key':uk}});
    return json(res,200,r.ok?{ok:true}:{ok:false,message:r.status===429?'The key is valid but rate limited right now.':'Google rejected this key ('+r.status+'). Check it and try again.'})}
  if(req.method==='POST'&&u==='/api/chat'){
    const b=await body(req),msgs=clean(b.messages),key=uk||SERVER_KEY;
    res.writeHead(200,{...H,'content-type':'application/x-ndjson','cache-control':'no-cache','x-accel-buffering':'no'});
    const send=o=>res.write(JSON.stringify(o)+'\n');
    if(!msgs.length)send({type:'error',message:'Empty message.'});
    else if(!key)send({type:'error',status:401,message:'Add a Gemini API key to continue.'});
    else if(!uk&&!allowed(ipOf(req)))send({type:'error',status:429,message:'The shared limit is reached. Add your own free Gemini key (API key button) to keep going.'});
    else try{await turn(msgs,b.map&&typeof b.map==='object'?b.map:null,send,key)}catch(e){send({type:'error',message:'Could not reach Gemini. Check your connection and retry.'})}
    return res.end()}
  if(req.method==='GET'&&u==='/'){res.writeHead(200,{...H,'content-type':'text/html; charset=utf-8'});return res.end(PAGE)}
  json(res,404,{error:'not found'})
}catch(e){try{json(res,500,{error:'server error'})}catch{}}}).listen(PORT,'0.0.0.0',()=>{
  const url='http://localhost:'+PORT;console.log('Socratic Tutor running at '+url+(SERVER_KEY?'':'  (visitors bring their own Gemini key)'));
  if(process.stdout.isTTY&&!process.env.NO_OPEN){const c=process.platform==='darwin'?'open':process.platform==='win32'?'start ""':'xdg-open';require('child_process').exec(c+' '+url,()=>{})}
});
