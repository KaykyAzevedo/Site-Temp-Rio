// Renderiza detalhe com funcoes reais do admin e CSS real, Chrome local sem rede/projeto.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Module=require('node:module'),{spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||path.join(os.tmpdir(),'sentinela-nf-browser'));
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,session,id=0,checks=0;const pending=new Map(),errors=[];
function send(method,params={},s=session){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(s?{sessionId:s}:{})}));});}
async function run(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
function check(ok,msg){assert.ok(ok,msg);checks++;}
(async()=>{
 const fixture=path.join(__dirname,'admin-compras-painel.test.js'),src=fs.readFileSync(fixture,'utf8');
 const prefix=src.slice(0,src.indexOf('\ntest(')).replace('brl:n=>(n/100).toFixed(2)',"brl:n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100)");
 const m=new Module(fixture);m.filename=fixture;m.paths=Module._nodeModulePaths(__dirname);m._compile(prefix+';module.exports={app,banco,doc};',fixture);
 const {app,banco,doc}=m.exports,{T,sb}=banco();
 T.solidcon_vendas_clientes=[{dia:'2026-06-26',cd_pdv:1,nr_cupom:1,tipo:'cnpj',documento:doc,valor_centavos:10000}];T.solidcon_pedidos_erp=[];
 T.solidcon_vendas_nf=[{cd_nota:550,numero:550,serie:'1',dia:'2026-06-25',dt:'2026-06-25T18:30:00-03:00',documento:doc,cd_pedido:538,valor_centavos:2164320,total_nota_centavos:2421121,st_centavos:233458,nf_cupom:false},
  {cd_nota:551,numero:551,serie:'1',dia:'2026-06-26',dt:'2026-06-26T18:30:00-03:00',documento:doc,cd_pedido:null,valor_centavos:10000,total_nota_centavos:10000,st_centavos:0,nf_cupom:true}];
 T.solidcon_vendas_nf_dias=[{dia:'2026-06-25'},{dia:'2026-06-26'}];
 const q=app(sb);q.scli.lista=[{tipo:'cnpj',documento:doc,nome:'Mercado de teste'}];await q.carregarCompras();q.erp();
 check(q.cmp.por[doc].total===2174320,'soma produtos+PDV sem repetir NF vinculada');
 const total=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(q.cmp.por[doc].total/100);
 const html='<h1>Mercado de teste</h1><p>Total de produtos + PDV: '+total+'</p><p>'+q.cmpFonteNota()+'</p>'+q.cmpNotasHtml(doc);
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sentinela-nf-chrome-'));
 const child=spawn(process.env.CHROME_EXE||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 try{
  const active=path.join(profile,'DevToolsActivePort');for(let i=0;!fs.existsSync(active)&&i<100;i++)await sleep(100);
  const [port,endpoint]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/);ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});
  await run(`document.documentElement.innerHTML='<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main></main></body>';document.querySelector('main').innerHTML=${JSON.stringify(html)};`);
  const admin=fs.readFileSync(path.join(repo,'js/admin.js'),'utf8'),ca=admin.indexOf('    function cmpNotasEstado('),cb=admin.indexOf('    function cmpRedesenhar()',ca);
  assert.ok(ca>0&&cb>ca);
  await run(`var cmp={nfNotas:${JSON.stringify(q.cmp.nfNotas)},nfVista:{}},NUM=new Intl.NumberFormat('pt-BR');
   var esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   var brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100),cmpData=s=>s.split('-').reverse().join('/');
   ${admin.slice(ca,cb)}`);
  const css=fs.readFileSync(path.join(repo,'css/admin.css'),'utf8');
  await run(`{const s=document.createElement('style');s.textContent=${JSON.stringify(css+'\nbody{background:var(--adm-fundo);color:var(--adm-tinta);font:14px Arial;padding:16px;margin:0}*{box-sizing:border-box}.overflow-x-auto{overflow-x:auto}.mt-3{margin-top:12px}.mt-4{margin-top:16px}.flex{display:flex}.flex-wrap{flex-wrap:wrap}.gap-3{gap:12px}details{border:1px solid var(--adm-borda);padding:12px}summary{cursor:pointer;padding:12px}table{min-width:680px}')} ;document.head.append(s);}`);
  check(await run(`document.querySelectorAll('table tbody tr').length===2`),'duas notas no detalhe');
  check(await run(`!document.querySelector('details').open`),'detalhe recolhido');
  await run(`document.querySelector('summary').click()`);
  check(await run(`document.querySelector('details').open`),'clique expande nativo');
  const texto=await run(`document.body.textContent`);
  for(const valor of ['21.643,20','24.211,21','2.334,58','Vinculada ao PDV; soma pelos cupons'])check(texto.includes(valor),'valor/aviso '+valor);
  check(await run(`document.querySelectorAll('th[scope=col]').length===7`),'cabecalhos acessiveis');
  async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name),Buffer.from(r.data,'base64'));}
  await shot('nf-desktop.png');
  await run(`window.nfOriginais=cmp.nfNotas.slice();for(let i=0;i<30;i++)cmp.nfNotas.push({...nfOriginais[0],cd_nota:1000+i,numero:600+i,valor_centavos:0,total_nota_centavos:0,st_centavos:null});cmpNotasEstado('${doc}').aberto=true;document.querySelector('[data-cmp-nf]').outerHTML=cmpNotasHtml('${doc}');`);
  check(await run(`document.querySelectorAll('tbody tr').length===25`),'NF pagina25');
  await run(`document.querySelector('[data-cmp-nf-pag="1"]').click()`);
  check(await run(`document.querySelectorAll('tbody tr').length===7`),'NF segunda pagina7');
  await run(`{const i=document.querySelector('[data-cmp-nf-busca]');i.value='550';i.dispatchEvent(new Event('input',{bubbles:true}));}`);
  check(await run(`document.querySelectorAll('tbody tr').length===1&&document.querySelector('tbody').textContent.includes('24.211,21')`),'busca acha NF antiga fora da primeira pagina');
  check(await run(`document.activeElement.hasAttribute('data-cmp-nf-busca')`),'busca preserva foco');
  await run(`cmp.nfNotas=nfOriginais;cmp.nfVista={};cmpNotasEstado('${doc}').aberto=true;document.querySelector('[data-cmp-nf]').outerHTML=cmpNotasHtml('${doc}');`);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  check(await run(`innerWidth===390&&document.documentElement.scrollWidth<=innerWidth`),'mobile sem overflow global');
  await run(`document.querySelector('.overflow-x-auto').scrollLeft=1000`);
  check(await run(`document.querySelector('.overflow-x-auto').scrollLeft>0`),'tabela pode rolar ate total e origem');
  await shot('nf-mobile.png');check(errors.length===0,'sem excecoes browser');
  const result={checks,ok:true,profile,semRede:true};fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(ws){try{await send('Browser.close',{},null);}catch{}ws.close();}child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
