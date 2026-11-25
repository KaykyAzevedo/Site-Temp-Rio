// Chrome headless LOCAL, sem ERP/Supabase/rede. Usa funcoes e CSS reais; dados ficticios.
// node supabase/tests/entrega-sem-canhoto.browser.cjs [diretorio-de-evidencias]
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||path.join(os.tmpdir(),'sentinela-entrega063-browser'));
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sentinela-entrega063-chrome-'));
const chrome=process.env.CHROME_EXE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,session,id=0,checks=0;const pending=new Map(),errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={},sess=session){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(sess?{sessionId:sess}:{})}));});}
async function run(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
(async()=>{
 try {
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;!fs.existsSync(portFile)&&i<100;i++)await sleep(100);
  const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
  ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
  session=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});
  await run(`document.documentElement.innerHTML='<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recebido063 QA</title></head><body><main id="qa"></main></body>';`);
  await run('const estilo=document.createElement("style");estilo.textContent='+JSON.stringify(fs.readFileSync(path.join(repo,'css/admin.css'),'utf8')+'\nbody{font:16px system-ui;padding:16px}dialog label{display:block;margin:12px 0}dialog textarea{display:block;width:100%}dialog button{margin-right:12px}dialog h2{font-size:20px}*{box-sizing:border-box}')+';document.head.append(estilo);');
  await run(fs.readFileSync(path.join(repo,'supabase/functions/_shared/rota-core.js'),'utf8'));
  await run(fs.readFileSync(path.join(repo,'js/entrega-admin.js'),'utf8'));
  await run(`
   window.p={cd_pedido:1530,etapa:'atendido',dt_saida:'2026-11-23T17:00:00-03:00'};
   window.marca=null;window.papel='vendedor';window.pode=true;window.foto=false;window.requests=[];window.eventos=0;window.seq=1;
   if(!crypto.randomUUID)crypto.randomUUID=()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   window.sb={rpc(n,a){requests.push([n,a]);if(n==='rota_063_confirmar_entrega')marca={id:1,cd_pedido:1530,confirmado_nome:'Marcio <QA>',confirmado_em:new Date().toISOString()};else marca=null;const resposta={data:{id:1,ativa:!!marca}};return window.hold063?new Promise(r=>window.resolve063=()=>r(resposta)):Promise.resolve(resposta);},from(){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return Promise.resolve({data:[{confirmado_em:new Date().toISOString(),confirmado_nome:'<img src=x onerror=alert(1)>',motivo:'<script>alert(1)</script>'}]});}};return q;}};
   window.opts=()=>({sb,papel,podeMarcar:pode,sessao:seq,instalada:true,confirmacoes:marca?{1530:marca}:{},canhotos:foto?{1530:[{enviado_em:new Date().toISOString()}]}:{},cfg:TempRioRotaCore.cfgDe({hora_saida:'08:00'})});
   window.render=()=>{document.querySelector('#qa').innerHTML=TempRioEntregaAdmin.html(p,opts());TempRioEntregaAdmin.ligar(document.querySelector('#qa'),opts);};
   addEventListener('temprio-entrega063',()=>{eventos++;render();});render();
  `);
  eq(await run(`document.querySelector('[data-entrega063-cd]').textContent`),'Recebido','Marcio vendedor marca_rota tem Recebido');
  await run(`document.querySelector('[data-entrega063-cd]').click()`);
  eq(await run(`document.querySelector('dialog h2').textContent`),'Marcar pedido #1530 como recebido?','confirmacao curta');
  eq(await run(`!!document.querySelector('dialog textarea[maxlength="300"]')`),true,'motivo opcional');
  await run(`hold063=true;document.querySelector('dialog textarea').value='OK do dono';document.querySelector('dialog form').requestSubmit();seq++;hold063=false;resolve063();`);
  eq(await run(`requests[0][0]`),'rota_063_confirmar_entrega','RPC propria');
  eq(await run(`requests[0][1].p_motivo`),'OK do dono','motivo enviado');
  eq(await run(`eventos`),1,'evento para atualizar telas');
  eq(await run(`document.querySelector('#qa').textContent`),'Recebido (marcado por Marcio <QA>)','rotulo com autor');
  eq(await run(`!!document.querySelector('[data-entrega063-acao=desfazer]')`),false,'vendedor nao desfaz');
  await run(`papel='admin';render();document.querySelector('[data-entrega063-cd]').click();`);
  eq(await run(`document.querySelector('dialog h2').textContent`),'Desfazer marcação do pedido #1530?','admin desfaz');
  eq(await run(`!!document.querySelector('dialog img,dialog script')`),false,'auditoria escapada');
  await run(`document.querySelector('dialog form').requestSubmit();`);
  eq(await run(`requests[1][0]`),'rota_063_desfazer_entrega','desfazer RPC exclusiva');
  eq(await run(`document.querySelector('[data-entrega063-cd]').textContent`),'Recebido','desfeito volta acao');
  await run(`foto=true;render();`);
  eq(await run(`document.querySelector('#qa').textContent`),'Recebido (canhoto)','foto precede');
  await run(`foto=false;pode=false;papel='vendedor';render();`);
  eq(await run(`!!document.querySelector('[data-entrega063-cd]')`),false,'vendedor sem marca nao ve botao');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await run(`pode=true;render();document.querySelector('[data-entrega063-cd]').click();`);
  eq(await run(`document.documentElement.scrollWidth<=innerWidth`),true,'modal mobile sem overflow');
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,'recebido-mobile.png'),Buffer.from(shot.data,'base64'));
  eq(errors,[],'sem excecoes browser');
  const result={checks,ok:true,evidencias:out};fs.writeFileSync(path.join(out,'browser063.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {if(ws){try{await send('Browser.close',{},null);}catch{}ws.close();}child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
