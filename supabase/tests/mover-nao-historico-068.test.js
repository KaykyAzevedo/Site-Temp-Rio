'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js'),W=require('../functions/_shared/whatsapp-core.js');
const rpcTabela=require('./rpc-paginada-fixture.js');
const p={cd_pedido:688005,etapa:'atendido',dt_saida:'2026-11-01T10:00-03:00',dt_pedido:'2026-10-30T10:00-03:00',cliente_tipo:'cnpj',documento:'11222333000181',cliente_nome:'HH QA',valor_centavos:100,caixas_24:1};
const c={cd_pedido:p.cd_pedido,id:p.cd_pedido,confirmado_em:'2026-11-26T10:00-03:00',confirmado_nome:null,reprogramado:true};
const cfg=R.cfgDe({hora_saida:'08:00',canhoto_desde:'2026-11-23T00:00-03:00'});
test('H reprogramacao explicita vence canhoto/legado/063 e idade ERP para pendencia',()=>{
 const ctx={confirmacoes:{[p.cd_pedido]:c},cfg};
 assert.equal(R.confirmacaoEntrega(ctx.confirmacoes,p.cd_pedido),null);
 assert.equal(R.recebidoEntrega(p,{[p.cd_pedido]:true},cfg,ctx.confirmacoes),false);
 assert.equal(R.recebidoEm(p,{...ctx,canhotos:{[p.cd_pedido]:[{enviado_em:'2026-11-25T10:00-03:00'}]}}),null);
 assert.equal(R.enviadoAntigo(p,{},'2026-11-26',cfg,ctx),false);
 assert.equal(R.pendenteEntrega(p,{[p.cd_pedido]:true},'2026-11-26',cfg,ctx),true);
});
test('H opts.reprogramados funciona em consumidor com mapa do backend',()=>{
 assert.equal(R.pendenteEntrega(p,{},'2026-11-26',cfg,{reprogramados:{[p.cd_pedido]:true}}),true);
 assert.equal(R.enviadoAntigo(p,{},'2026-11-26',cfg,{reprogramados:{[p.cd_pedido]:true}}),false);
 assert.equal(R.pendenteEntrega(p,{},'2026-11-26',cfg,{}),false);
});
test('H leitura063 preserva flag e recusa tipo malformado',async()=>{
 const d=await R.coletarConfirmacoes({rpc:()=>Promise.resolve({data:[c]})},[p]);
 assert.equal(d.porPedido[p.cd_pedido].reprogramado,true);
 await assert.rejects(R.coletarConfirmacoes({rpc:()=>Promise.resolve({data:[{...c,reprogramado:'false'}]})},[p]),/invalido/);
});
test('H resumo nao conta recebido reprogramado como entregue',()=>{
 const d={pedidos:[],entregas:[{...p,status:'entregue',data_entrega:'2026-11-26'}],confirmacoes:{[p.cd_pedido]:c},coletado:'2026-11-26T12:00-03:00'};
 assert.equal(W.montarPedidosDia(d,'2026-11-26T12:00-03:00',{}).resumo.enviou,0);
 assert.equal(W.montarPedidosDia({...d,confirmacoes:{}},'2026-11-26T12:00-03:00',{}).resumo.enviou,1);
});
test('H coletor tambem busca estado063 de snapshot sem fonteERP',async()=>{
 const calls=[];
 const sb={from(t){const q={select(){return q},eq(){return q},is(){return q},in(){return q},gte(){return q},lt(){return q},order(){return q},limit(){return q},range(){return q},then(ok,bad){return Promise.resolve({data:t==='solidcon_pedidos_erp_sync'?[{coletado_em:'2026-11-26T12:00-03:00'}]:[]}).then(ok,bad)}};return q},
 rpc(n,a){if(n==='rota_068_entregas')return rpcTabela([{...p,status:'entregue',data_entrega:'2026-11-26'}]);
 assert.equal(n,'rota_063_ler_entregas');calls.push(a.p_cds);return Promise.resolve({data:[c]});}};
 const d=await W.coletarPedidosDia(sb,'2026-11-26T12:00-03:00');
 assert.deepEqual(calls,[[p.cd_pedido]]);
 assert.equal(W.montarPedidosDia(d,'2026-11-26T12:00-03:00',{}).resumo.enviou,0);
});
