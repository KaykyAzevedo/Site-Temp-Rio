// Chrome headless LOCAL, sem ERP/Supabase/rede. Usa funcoes e CSS reais; dados ficticios.
// node supabase/tests/pronto-despacho.browser.cjs [diretorio-de-evidencias]
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||path.join(os.tmpdir(),'sentinela-despacho-browser'));
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sentinela-despacho-chrome-'));
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
  await run(`document.documentElement.innerHTML='<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture Pronto despacho</title></head><body><main id="painel-pedidoserp"><div id="pe-quadro"></div><section id="pe-arquivo-canhotos">Arquivo 057</section></main><div id="modal-detalhe" class="hidden"><div class="adm-modal-painel"><button id="btn-fechar-modal">Fechar</button><div id="qa-modal"></div></div></div></body>';`);
  const css=fs.readFileSync(path.join(repo,'css/admin.css'),'utf8');
  await run(`{const s=document.createElement('style');s.textContent=${JSON.stringify(css+'\nbody{background:var(--adm-fundo);color:var(--adm-tinta);font:14px Arial;padding:16px;margin:0}*{box-sizing:border-box}.hidden{display:none!important}button,input{font:inherit}button{cursor:pointer}i{display:inline-block;min-width:12px}')} ;document.head.append(s);}`);
  await run(fs.readFileSync(path.join(repo,'supabase/functions/_shared/rota-core.js'),'utf8'));
  const src=fs.readFileSync(path.join(repo,'js/admin.js'),'utf8'),a=src.indexOf('    var PE_COLUNAS ='),b=src.indexOf('    var kanbanSegmento',a);
  assert.ok(a>0&&b>a);
  await run(`window.qaAgora='2026-11-24T21:00:00Z';window.qaTick=null;window.qaChamadas=0;window.qaVisivel=true;
   const DataOriginal=Date;window.Date=class extends DataOriginal{constructor(...args){super(...(args.length?args:[window.qaAgora]));}static now(){return DataOriginal.parse(window.qaAgora);}};
   window.setInterval=(fn)=>{window.qaTick=fn;return 1;};
   var $=s=>document.querySelector(s),celular=()=>innerWidth<1024,sb={from(){throw Error('GET indevido');}},NUM=new Intl.NumberFormat('pt-BR'),papel='vendedor',dados={pedidos:[]},abasParaRedesenhar={},sobrepos={atual:null};
   var esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   var brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100),cmpCadastros=()=>({}),docDigitos=s=>String(s||''),docNorm=s=>s,geoNorm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   var secaoVisivel=()=>window.qaVisivel,dataHora=s=>String(s||''),cartaoVazio=s=>s,focaveis=e=>Array.from(e.querySelectorAll('button,a,input')).filter(x=>!x.disabled),desenharPedidosErpAba=()=>{},desenharPedidos=()=>{};
   var abrirModal=html=>{document.querySelector('#qa-modal').innerHTML=html;document.querySelector('#modal-detalhe').classList.remove('hidden');};
   window.TempRioCanhoto={urlAssinada(){window.qaChamadas++;return Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');}};
   ${src.slice(a,b)}
   pe.carregado=true;pe.can052=true;pe.cfg=TempRioRotaCore.cfgDe({hora_saida:'08:00'});
   pe.itens=Array.from({length:32},(_,i)=>({cd_pedido:i+1,cliente_tipo:'cnpj',cliente_nome:i===0?'<Cliente>':'Cliente '+(i+1),etapa:'atendido',dt_pedido:'2026-11-20T12:00-03:00',dt_saida:'2026-11-23T17:23-03:00',valor_centavos:100}));
   pe.itens.forEach(x=>pe.canhotos[x.cd_pedido]=[{caminho:'ficticio-'+x.cd_pedido+'.jpg',enviado_em:x.cd_pedido===31?'2026-11-23T00:00-03:00':x.cd_pedido===32?'2026-11-24T00:00-03:00':'2026-11-21T12:00-03:00'}]);
   pe.itens.push({cd_pedido:1537,cliente_tipo:'cnpj',cliente_nome:'Pronto teste',etapa:'atendido',dt_pedido:'2026-11-24T10:00-03:00',dt_saida:'2026-11-24T17:23-03:00',valor_centavos:10000});
   peRedesenharQuadro();peIniciarAba();`);
  eq(await run(`document.querySelectorAll('[data-pe-col]').length`),7,'7 colunas');
  eq(await run(`document.querySelectorAll('#pe-historico').length`),1,'historico unico abaixo');
  eq(await run(`document.querySelector('#pe-historico').open`),false,'recolhido');
  eq(await run(`document.querySelector('[data-pe-col=recebido] .adm-kanban-contagem').textContent`),'2','recebidos recentes');
  eq(await run(`document.querySelector('[data-pe-col=recebido] .adm-kanban-total').textContent`),'R$ 2,00','total recentes');
  eq(await run(`document.querySelector('[data-pe-col=pronto_despacho] [data-pe-pedido]').getAttribute('data-pe-pedido')`),'1537','pronto');
  eq(await run(`document.querySelectorAll('#pe-historico tbody tr').length`),25,'primeira pagina25');
  await run(`document.querySelector('#pe-historico').open=true`);await sleep(20);
  await run(`document.querySelector('[data-pe-hist-pag="1"]').click()`);
  eq(await run(`document.querySelectorAll('#pe-historico tbody tr').length`),5,'segunda pagina5');
  eq(await run(`document.querySelector('#pe-historico').open`),true,'permanece aberto');
  await run(`{const i=document.querySelector('#pe-historico-busca');i.value='<Cliente>';i.dispatchEvent(new Event('input'));}`);
  eq(await run(`document.querySelectorAll('#pe-historico tbody tr').length`),1,'busca local');
  eq(await run(`document.activeElement.id`),'pe-historico-busca','foco preservado');
  eq(await run(`document.querySelector('#pe-historico tbody tr td:nth-child(2)').textContent`),'<Cliente>','nome escapado');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  eq(await run(`document.activeElement.getAttribute('data-pe-pedido')`),'1','Tab entra na linha');
  await run(`document.querySelector('#pe-historico [aria-label^="Ver canhoto"]').click();document.querySelector('[data-canhoto-ver]').click()`);await sleep(20);
  eq(await run(`document.querySelectorAll('#pe-canhoto img').length`),1,'foto no fluxo existente');
  eq(await run(`window.qaChamadas`),1,'uma URL assinada ao clicar');
  await run(`document.querySelector('#modal-detalhe').classList.add('hidden');window.qaAgora='2026-11-25T10:59:59.999Z';peRedesenharQuadro();`);
  eq(await run(`document.querySelectorAll('[data-pe-col=pronto_despacho] [data-pe-pedido="1537"]').length`),1,'antes08');
  await run(`window.qaAgora='2026-11-25T11:00:00Z';qaTick()`);
  eq(await run(`document.querySelectorAll('[data-pe-col=enviado] [data-pe-pedido="1537"]').length`),1,'primeiro tick08 muda DOM');
  eq(await run(`document.querySelector('[data-pe-col=recebido] .adm-kanban-contagem').textContent`),'1','ontem migrou historico');
  await run(`window.qaAgora='2026-11-26T03:00:00Z';qaTick()`);
  eq(await run(`document.querySelector('[data-pe-col=recebido] .adm-kanban-contagem').textContent`),'0','virada SP');
  await run(`pe.historico.busca='';peRedesenharQuadro();`);
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name),Buffer.from(r.data,'base64'));};
  await shot('despacho-desktop.png');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await run(`document.querySelector('[data-pe-seg=pronto_despacho]').click();`);
  eq(await run(`innerWidth`),390,'viewport mobile real');
  eq(await run(`document.documentElement.scrollWidth<=innerWidth`),true,'mobile sem overflow global');
  eq(await run(`document.querySelector('[data-pe-col=pronto_despacho]').classList.contains('is-seg-ativa')`),true,'segmento mobile');
  eq(await run(`Array.from(document.querySelectorAll('[data-pe-col]')).filter(x=>getComputedStyle(x).display!=='none').length`),1,'mobile uma coluna visivel');
  await shot('despacho-mobile.png');
  eq(errors,[],'sem excecoes browser');
  const result={checks,ok:true,profile,evidencias:out};fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {if(ws){try{await send('Browser.close',{},null);}catch{}ws.close();}child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
