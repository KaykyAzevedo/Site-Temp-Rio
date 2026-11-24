'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../functions/_shared/whatsapp-core.js');
const agora=new Date('2026-11-24T15:00:00Z');
function banco(){
 const T={solidcon_pedidos_erp:[1,2,3].map(n=>({cd_pedido:n,etapa:'atendido',dt_pedido:'2026-11-01T12:00:00-03:00',dt_saida:n===3?'2026-11-16T12:00:00-03:00':'2026-11-24T09:00:00-03:00',dt_atendido:'2026-11-24T09:01:00-03:00',cliente_tipo:'cnpj',documento:String(12000000000000+n),cliente_nome:'Cliente '+n,caixas_24:1,caixas_48:0,caixas_outras:0})),
 rota_config:[{id:1,feriados_sem_saida:true}],rota_veiculos:[{id:'s10',nome:'S10',modo:'porta',ativo:true,dias_sem_saida:[0,6],capacidade_volume:null}],rota_cliente_veiculo:[],rota_pedido_veiculo:[1,2,3].map(n=>({cd_pedido:n,veiculo:'s10'})),rota_cliente_regras:[],rota_pedido_ignorado:[],pedido_canhoto:[{id:1,cd_pedido:1,substituido_em:null},{id:2,cd_pedido:2,substituido_em:'ontem'}]};
 const sb={from(t){let rows=(T[t]||[]).slice(),range=null;const q={select(){return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},is(k,v){rows=rows.filter(r=>r[k]==v);return q;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q;},gte(k,v){rows=rows.filter(r=>r[k]>=v);return q;},lt(k,v){rows=rows.filter(r=>r[k]<v);return q;},order(){return q;},limit(n){rows=rows.slice(0,n);return q;},range(a,b){range=[a,b];return q;},then(ok,bad){return Promise.resolve({data:range?rows.slice(range[0],range[1]+1):rows}).then(ok,bad);}};return q;},rpc(name){if(name==='rota_050_ler')return Promise.resolve({data:null});if(name==='solidcon_rota_posicoes')return Promise.resolve({data:[]});throw Error(name);}};
 return {T,sb};
}
test('WhatsApp usa canhoto ativo e idade de faturamento, igual ao painel',async()=>{
 const {sb}=banco();const d=await W.coletarRota(sb,agora);assert.equal(d.canhotos[1],true);assert.ok(!d.canhotos[2]);const m=W.montarRota(d,'s10',agora,{});assert.equal(m.resumo.paradas,1);assert.match(m.texto,/Cliente 2/);assert.ok(!m.texto.includes('Cliente 1'));
});
test('alerta parado nao confunde criacao antiga com faturamento recente ou entrega assinada',async()=>{
 const {sb}=banco();const d=await W.coletarAlertas(sb,agora);assert.deepEqual(d.parados.map(p=>p.cd_pedido),[3]);
 assert.match(W.montarAlertas(d,agora,{}).texto,/8d faturado sem canhoto/);
});
test('Enviou do dia e faturamento, sem usar data de suposta entrega e sem mudar modelo Meta',async()=>{
 const {T,sb}=banco();T.solidcon_pedidos_erp[0].dt_saida='2026-11-23T23:59:00-03:00';T.solidcon_pedidos_erp[1].dt_saida=null;T.solidcon_pedidos_erp[1].dt_nota='2026-11-24T00:00:00-03:00';T.solidcon_pedidos_erp[2].dt_saida='2026-11-24T09:00:00-03:00';T.solidcon_pedidos_erp[2].dt_atendido='2026-11-25T12:00:00-03:00';
 const m=await W.gerar(sb,'pedidos_dia',agora,{});assert.equal(m.resumo.enviou,2);assert.equal(m.partes[0].template,'pedidos_do_dia');
});
test('erro na leitura de canhotos nao e tratado como ausencia',async()=>{
 const {sb}=banco(),original=sb.from;sb.from=t=>t==='pedido_canhoto'?{select(){return this;},is(){return this;},order(){return this;},range(){return Promise.resolve({error:{code:'57014',message:'timeout'}});}}:original(t);
 await assert.rejects(W.coletarRota(sb,agora),e=>e.code==='57014');
});

test('sem 052 continua pendente; leitura truncada nao gera rota incorreta',async()=>{
 const {sb}=banco(),original=sb.from;
 sb.from=t=>t==='pedido_canhoto'?{select(){return this;},is(){return this;},order(){return this;},range(){return Promise.resolve({error:{code:'42P01',message:'relation pedido_canhoto does not exist'}});}}:original(t);
 const d=await W.coletarRota(sb,agora);assert.equal(W.montarRota(d,'s10',agora,{}).resumo.paradas,2);
 sb.from=t=>t==='pedido_canhoto'?{select(){return this;},is(){return this;},order(){return this;},range(){return Promise.resolve({data:Array(1000).fill({cd_pedido:1})});}}:original(t);
 await assert.rejects(W.coletarRota(sb,agora),/limite de leitura de canhotos/);
});
