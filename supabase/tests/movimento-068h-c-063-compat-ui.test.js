'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const R=require('../functions/_shared/rota-core.js'),M=require('../../js/admin-movimento.js');
const read=p=>fs.readFileSync(require.resolve('../../'+p),'utf8');
const p={cd_pedido:1,etapa:'atendido',dt_pedido:'2026-11-25T09:00:00-03:00',dt_saida:'2026-11-26T09:00:00-03:00',cliente_tipo:'cnpj',cliente_nome:'Cliente QA'};
const marca={cd_pedido:1,id:1,confirmado_em:'2026-11-26T09:00:00-03:00',confirmado_nome:'Márcio <QA>'};
class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-26T15:00:00Z']));}}
function ambiente(config=true){
 const calls=[],sb={rpc:async(n,a)=>{calls.push({n,a});if(/^rota_063_(confirmar|desfazer)_entrega$/.test(n))return {error:{code:'42501',message:'permission denied for function '+n}};
  if(n==='rota_063_ler_entregas')return {data:[marca]};if(n==='rota_068_estados_pedidos')return {data:[{cd_pedido:1,entregue:false}]};if(n==='pode_marcar_rota')return {data:true};return {data:[]};},
 from(t){const q={select(){return q},order(){return q},eq(){return q},limit(){return q},is(){return q},in(){return q},then(ok,bad){return Promise.resolve({data:t==='solidcon_pedidos_erp'?[p]:t==='rota_config'?[{id:1}]:[]}).then(ok,bad)}};return q;}};
 const w={TempRioRotaCore:R,TempRioMovimento:M,addEventListener(){},dispatchEvent(){}};
 if(config)vm.runInNewContext(read('js/admin-068-partes.js'),{window:w,Object});
 vm.runInNewContext(read('js/entrega-admin.js'),{window:w,Intl,Date:Clock,Promise});
 const opts={sb,papel:'admin',podeMarcar:true,instalada:true,sessao:1,cfg:R.cfgDe({}),confirmacoes:{},agora:new Clock()};
 return {w,sb,calls,opts,UI:w.TempRioEntregaAdmin};
}
test('H+C: HTML real carrega modo de leitura063 antes do adapter; C UI/Problema continua oculta nesta variante',()=>{
 const {w}=ambiente(),html=read('admin.html');assert.equal(w.TempRio068Partes.Acoes063,false);assert.equal(w.TempRio068Partes.C,false);
 assert.ok(html.indexOf('src="./js/admin-068-partes.js"')<html.indexOf('src="./js/entrega-admin.js"'));assert.ok(!html.includes('src="./js/admin-068.js"'));
});
test('H+C: leitura063 instalada não autoriza Recebido/Desfazer em nenhum papel; rótulo legado preservado',()=>{
 const {UI,opts}=ambiente();
 for(const papel of ['admin','marca_rota','vendedor'])for(const confirmacoes of [{},{1:marca}]){
  const h=UI.html(p,{...opts,papel,confirmacoes});assert.ok(!h.includes('data-entrega063-acao'),'nenhuma ação063 em '+papel);
  if(confirmacoes[1])assert.match(h,/Márcio &lt;QA&gt;/);
 }
});
test('H+C: API exportada de confirmar/desfazer bloqueia antes das RPCs revogadas42501',async()=>{
 const {UI,sb,calls}=ambiente();
 for(const acao of ['confirmar','desfazer'])await assert.rejects(UI.executar(sb,acao,1,1,'motivo','00000000-0000-4000-8000-000000000001'),/indisponível/);
 assert.equal(calls.filter(c=>/^rota_063_(confirmar|desfazer)_entrega$/.test(c.n)).length,0);
});
test('H+C: loader real Pedidos conserva confirmação e rótulo, mas não oferece mutação063 após ler RPC com sucesso',async()=>{
 const a=ambiente(),ctx={window:a.w,Intl,Date:Clock,Promise,sb:a.sb,papel:'admin',celular:()=>false,localStorage:{getItem:()=>null},document:{getElementById:()=>null,querySelectorAll:()=>[]},$:()=>null,peAtualizarTopo(){},secaoVisivel:()=>false,abasParaRedesenhar:{},vendPaginar:f=>Promise.resolve(f()),solidTabelaAusente:()=>false,esc:String,brl:String,NUM:new Intl.NumberFormat('pt-BR'),cmpCadastros:()=>({}),docDigitos:x=>x||'',docNorm:x=>x,geoNorm:x=>String(x||'').toLowerCase()};
 const src=read('js/admin.js'),ini=src.indexOf('    var PE_COLUNAS ='),fim=src.indexOf('    function peFecharLegenda',ini);
 const app=vm.runInNewContext(src.slice(ini,fim)+';({pe,carregarPedidosErp,peRecebidoHtml});',ctx);await app.carregarPedidosErp();
 assert.equal(app.pe.entrega063,true);assert.equal(app.pe.confirmacoes[1].id,1);assert.match(app.peRecebidoHtml(p),/Márcio &lt;QA&gt;/);assert.ok(!app.peRecebidoHtml(p).includes('data-entrega063-acao'));
 assert.ok(a.calls.some(c=>c.n==='rota_063_ler_entregas'));assert.ok(!a.calls.some(c=>/^rota_063_(confirmar|desfazer)_entrega$/.test(c.n)));
});
test('H+C: lista e detalhe Rotas reais preservam leitura sem botões063 incompatíveis',()=>{
 const a=ambiente(),ctx={window:a.w,Intl,Date:Clock,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console};
 vm.runInNewContext(read('js/admin-rota.js').replace('    raiz.TempRioRota = {','    raiz.qa={st,celulaFechada,seletorPedidoV2};desenhar=function(){};\n    raiz.TempRioRota = {'),ctx);
 const {st,celulaFechada,seletorPedidoV2}=a.w.qa;Object.assign(st,{papel:'admin',podeMarcar:true,entrega063:true,v2:true,cfg:R.cfgDe({}),confirmacoes:{1:marca},estadosH:{1:{entregue:false}},estadosDia:'2026-11-26'});
 for(const html of [celulaFechada([{p,veiculo:'s10'}],'s10','Cliente'),seletorPedidoV2({p,veiculo:'s10'},'Cliente',true)])assert.ok(!html.includes('data-entrega063-acao'));
});
test('Guard C: evento antigo de botão legado não abre diálogo nem chama RPC após mudança de modo',()=>{
 const a=ambiente(false),botao={getAttribute:n=>n==='data-entrega063-cd'?'1':'confirmar',remove(){this.removido=true;}},el={querySelectorAll:()=>[botao]};
 a.UI.ligar(el,()=>a.opts);const handlerAntigo=botao.onclick;a.w.TempRio068Partes={Acoes063:false};
 a.UI.ligar(el,()=>a.opts);assert.equal(botao.removido,true);handlerAntigo({stopPropagation(){}});assert.equal(a.calls.length,0);
});
test('Compatibilidade legado: adapter sem modoH/C mantém ações063 para releases anteriores',async()=>{
 const {UI,opts}=ambiente(false),calls=[];assert.match(UI.html(p,opts),/data-entrega063-acao="confirmar"/);
 await UI.executar({rpc:async(n,a)=>{calls.push({n,a});return {data:{id:1,ativa:true}};}},'confirmar',1,null,'motivo','00000000-0000-4000-8000-000000000001');assert.equal(calls[0].n,'rota_063_confirmar_entrega');
});
