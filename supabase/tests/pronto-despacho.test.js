'use strict';
const rpcTabela = require('./rpc-paginada-fixture.js');
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js'),W=require('../functions/_shared/whatsapp-core.js');
const p=(extra={})=>({cd_pedido:1537,etapa:'atendido',dt_pedido:'2026-11-24T10:00:00-03:00',dt_saida:'2026-11-24T17:23:00-03:00',valor_centavos:100,cliente_tipo:'cnpj',cliente_nome:'Teste',...extra});
const cfg=R.cfgDe({hora_saida:'08:00:00'});
const ctx=(agora,extra={})=>({cfg,agora,canhotos:{},saidas:{},...extra});
test('059 véspera, limites SP 07:59:59.999/08h, igualdade faturamento e instante UTC',()=>{
 assert.equal(R.saidaEntrega(p(),ctx('2026-11-24T18:00-03:00')),'2026-11-25T08:00:00-03:00');
 for(const [agora,etapa] of [['2026-11-25T10:59:59.999Z','pronto_despacho'],['2026-11-25T11:00:00Z','enviado']]) assert.equal(R.etapaEntrega(p(),ctx(agora)),etapa);
 for(const em of ['2026-11-25T07:59:00-03:00','2026-11-25T08:00:00-03:00']) assert.equal(R.saidaEntrega(p({dt_saida:em}),ctx()),'2026-11-25T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p({dt_saida:'2026-11-25T08:00:00.001-03:00'}),ctx()),'2026-11-26T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p({dt_saida:'2026-11-25T02:59:00Z'}),ctx()),'2026-11-25T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p({dt_saida:null,dt_nota:'2026-11-24T17:48-03:00'}),ctx()),'2026-11-25T08:00:00-03:00');
 assert.equal(R.etapaEntrega(p({dt_saida:null}),ctx('2026-11-25T12:00Z')),'pronto_despacho');
});
test('061 rota fechada pode adiar mas nunca antecipar, domingo não é pulado; hora configurável e legado07h',()=>{
 assert.equal(R.saidaEntrega(p(),ctx(null,{saidas:{1537:'2026-11-28'}})),'2026-11-28T08:00:00-03:00');
 assert.equal(R.etapaEntrega(p(),ctx('2026-11-24T18:00-03:00',{saidas:{1537:'2026-11-24'}})),'pronto_despacho','faturamento posterior espera a proxima saida');
 assert.equal(R.saidaEntrega(p({dt_saida:'2026-11-28T17:00-03:00'}),ctx()),'2026-11-29T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p(),{cfg:R.cfgDe({hora_saida:'09:30'})}),'2026-11-25T09:30:00-03:00');
 assert.equal(R.saidaEntrega(p(),{}),'2026-11-25T07:00:00-03:00');
 const fx={data:'2026-11-26',itens:[{cd_pedido:1537}]};
 assert.equal(R.saidaEntrega(p(),ctx(null,{fechada:fx})),'2026-11-26T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p(),ctx(null,{fechada:{...fx,estado:'reaberta'}})),'2026-11-25T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p(),ctx(null,{fechada:{...fx,itens:[{cd_pedido:1537,removido_em:'agora'}]}})),'2026-11-25T08:00:00-03:00');
});
test('059 idade usa saída prevista, rota tardia não some; legado e canhoto preservados',()=>{
 const x=p({dt_saida:'2026-11-16T17:23-03:00'});
 assert.equal(R.enviadoAntigo(x,{},'2026-11-24',cfg),false);
 assert.equal(R.enviadoAntigo(x,{},'2026-11-25',cfg),true);
 assert.equal(R.pendenteEntrega(x,{},'2026-11-25',cfg,{saidas:{1537:'2026-11-26'}}),true);
 assert.equal(R.etapaEntrega(p(),ctx('2026-11-24T18:00-03:00',{canhotos:{1537:true}})),'recebido');
 assert.equal(R.etapaEntrega(p(),ctx('2026-11-24T18:00-03:00',{cfg:R.cfgDe({canhoto_desde:'2026-11-24T18:00-03:00'})})),'recebido');
});
test('059 recebido: mais recente ativo, hoje/ontem SP, substituídos e data ausente',()=>{
 const c=ctx('2026-11-25T02:59:59Z',{canhotos:{1537:[{enviado_em:'2026-11-22T23:59:59-03:00'},{enviado_em:'2026-11-23T00:00:00-03:00'},{enviado_em:'2026-11-24T10:00-03:00',substituido_em:'agora'}]}});
 assert.equal(R.recebidoEm(p(),c),'2026-11-23T00:00:00-03:00');assert.equal(R.recebidoRecente(p(),c),true);
 c.agora='2026-11-25T03:00:00Z';assert.equal(R.recebidoRecente(p(),c),false);
 c.canhotos[1537]=[{}];assert.equal(R.recebidoEm(p(),c),null);assert.equal(R.recebidoRecente(p(),c),false);
});
test('059 WhatsApp às17h pronto; 07:59 pronto; às08h enviou, mantém parâmetros/templates',()=>{
 const d={pedidos:[p(),p({cd_pedido:1538,etapa:'conferido'})],cfg,canhotos:{},coletado:'2026-11-24T20:00Z'};
 for(const [agora,pronto,enviou] of [['2026-11-24T20:00Z',2,0],['2026-11-25T10:59Z',2,0],['2026-11-25T11:00Z',1,1]]) {
  d.entregas=enviou?[{...p(),status:'entregue',data_entrega:'2026-11-25'}]:[];
  const m=W.montarPedidosDia(d,new Date(agora));assert.equal(m.resumo.pronto,pronto);assert.equal(m.resumo.enviou,enviou);assert.equal(m.partes[0].params.length,8);
 }
 d.entregas=[];d.saidas={1537:'2026-11-27'};assert.equal(W.montarPedidosDia(d,new Date('2026-11-25T12:00Z')).resumo.enviou,0);
});
test('059 coleta limitada/deduplicada; tabela ausente/timeout nunca vira ausência de rota',async()=>{
 const chamadas=[];const sb={from(t){assert.equal(t,'rota_059_saidas');return {select(){return this;},in(k,ids){chamadas.push(ids);return Promise.resolve({data:ids.map(cd_pedido=>({cd_pedido,dia_saida:'2026-11-25'}))});}};}};
 const lista=Array.from({length:501},(_,i)=>p({cd_pedido:i}));const mapa=await R.coletarSaidas(sb,lista.concat(lista));assert.equal(chamadas.length,3);assert.equal(Object.keys(mapa).length,501);
 for(const code of ['42P01','57014','42501']) await assert.rejects(R.coletarSaidas({from(){return {select(){return this;},in(){return Promise.resolve({error:{code,message:code}});}};}},[p()]),new RegExp(code));
});
test('059 coletores WA compartilham mapa com resumo/rota/alerta; faturado antigo despacha hoje',async()=>{
 const x=p({dt_saida:'2026-11-01T17:23-03:00',documento:'12000000000001',caixas_24:1,caixas_48:0,caixas_outras:0});
 const T={solidcon_pedidos_erp:[x],rota_config:[{id:1,hora_saida:'08:00'}],rota_059_saidas:[{cd_pedido:1537,dia_saida:'2026-11-25'}],rota_pedido_veiculo:[{cd_pedido:1537,veiculo:'s10'}],rota_veiculos:[{id:'s10',nome:'S10',modo:'porta',ativo:true,dias_sem_saida:[0],ordem:1}]};
 T.entregas=[];
 const sb={from(t){let rows=(T[t]||[]).slice();const q={select(){return q;},in(k,v){rows=rows.filter(x=>v.includes(x[k]));return q;},eq(k,v){rows=rows.filter(x=>x[k]===v);return q;},is(){return q;},gte(k,v){rows=rows.filter(x=>x[k]>=v);return q;},lt(){return q;},order(){return q;},limit(){return q;},range(){return q;},then(ok,er){return Promise.resolve({data:rows}).then(ok,er);}};return q;},rpc(n){if(n==='rota_068_entregas')return rpcTabela(T.entregas);return Promise.resolve({data:n==='rota_050_ler'?null:[]});}};
 const agora=new Date('2026-11-25T10:59:00Z');
 const d=await W.coletarPedidosDia(sb,agora);assert.equal(d.saidas[1537],'2026-11-25');assert.equal(W.montarPedidosDia(d,agora).resumo.pronto,1);assert.equal(W.montarPedidosDia(d,new Date('2026-11-25T11:00Z')).resumo.enviou,0,'faturamento/foto prevista isolados nao substituem leituraC');
 T.entregas=[{...x,status:'entregue',data_entrega:'2026-11-25'}];
 const canonico=await W.coletarPedidosDia(sb,agora);assert.equal(W.montarPedidosDia(canonico,agora).resumo.enviou,1,'R2 dono: retorno canonico manual ja conta antes da hora');
 const rota=await W.coletarRota(sb,agora);assert.equal(rota.saidas[1537],'2026-11-25');assert.equal(W.montarRota(rota,'s10',agora,{}).resumo.paradas,1);
 assert.equal((await W.coletarAlertas(sb,agora)).parados.length,0);
});
