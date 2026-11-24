'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js');
const dia='2026-11-24';
const pedido=(extra={})=>({cd_pedido:1528,etapa:'atendido',dt_pedido:'2026-11-20T12:00:00-03:00',dt_saida:'2026-11-23T17:23:00-03:00',dt_nota:'2026-11-23T17:24:00-03:00',dt_atendido:'2026-11-23T17:24:00-03:00',documento:'12000000000001',caixas_24:1,caixas_48:0,caixas_outras:0,...extra});
const opts=(extra={})=>({marcacao:true,porPedido:{1528:'s10'},canhotos:{},hoje:dia,...extra});
test('1528-like: atendido e saiu sem canhoto continuam na rota; canhoto retira',()=>{
 for(const etapa of ['saiu','atendido']){const p=pedido({etapa});assert.equal(R.pendenteEntrega(p,{},dia),true);assert.ok(R.planejar([p],{},dia,opts()).entregues[1528]);assert.ok(!R.planejar([p],{},dia,opts({canhotos:{1528:true}})).entregues[1528]);}
});
test('7 dias ainda entra, 8 dias vai para enviadosAntigos; data SP e fallback nota/atendido',()=>{
 assert.equal(R.pendenteEntrega(pedido({dt_saida:'2026-11-17T23:59:00-03:00'}),{},dia),true);
 const p=pedido({dt_saida:'2026-11-16T02:59:59Z'});const pl=R.planejar([p],{},dia,opts());assert.ok(!pl.entregues[1528]);assert.equal(pl.enviadosAntigos.length,1);
 assert.equal(R.faturadoEm(pedido({dt_saida:null})), '2026-11-23T17:24:00-03:00');
 assert.equal(R.faturadoEm(pedido({dt_saida:null,dt_nota:null})), '2026-11-23T17:24:00-03:00');
 assert.equal(R.planejar([p],{},dia,opts({canhotos:{1528:true}})).enviadosAntigos.length,0);
});
test('canhoto ativo prevalece sobre etapa e nao confunde marcado proximo ponto com recebido',()=>{
 assert.equal(R.pendenteEntrega(pedido({etapa:'conferido'}),{1528:true},dia),false);
 assert.equal(R.pendenteEntrega(pedido(),{},dia),true);
});
test('foto fechada conserva faturado sem canhoto e o exclui ao receber/ficar antigo',()=>{
 const p=pedido(),o=opts({fechada:{data:dia,itens:[{cd_pedido:1528,veiculo_id:'s10',ordem:1}]}});
 assert.ok(R.planejar([p],{},dia,o).entregues[1528]);assert.ok(!R.planejar([p],{},dia,{...o,canhotos:{1528:true}}).entregues[1528]);
 assert.equal(R.planejar([pedido({dt_saida:'2026-11-01T12:00:00-03:00'})],{},dia,o).enviadosAntigos.length,0);
});
test('separando com canhoto nao e reintroduzido automaticamente na fechada',()=>{
 const p=pedido({etapa:'separando'}),o=opts({fechada:{data:dia,itens:[]},canhotos:{1528:true}});
 assert.equal(R.propostaSeparando([p],{},dia,o).adicoes.length,0);
});

test('semana e sugestao de juntar usam idade de hoje e excluem canhoto/antigo',()=>{
 const p=pedido({dt_saida:'2026-11-17T12:00:00-03:00'}),clientes={[p.documento]:{nome:'Cliente',bairro:'Barra',cidade:'Rio',pos:[R.ROTA.ORIGEM[0]+.01,R.ROTA.ORIGEM[1]+.01]}};
 const sem=extra=>R.planejarSemana([p],clientes,'2026-11-30',opts(extra));
 assert.equal(sem().resumo.pedidos,1,'sete dias hoje permanece candidato da semana futura');
 assert.equal(sem({canhotos:{1528:true}}).resumo.pedidos,0);
 const base=pedido({cd_pedido:1,etapa:'conferido'}),rota=R.planejar([base],clientes,dia,opts({porPedido:{1:'s10'}}));
 const juntar=extra=>R.sugestoesJuntar([base,p],clientes,rota,opts(extra));
 assert.deepEqual(juntar().sugestoes[0].cds,[1528]);
 assert.equal(juntar({canhotos:{1528:true}}).sugestoes.length,0);
 p.dt_saida='2026-11-15T12:00:00-03:00';
 assert.equal(sem().resumo.pedidos,0);assert.equal(juntar().sugestoes.length,0);
});
