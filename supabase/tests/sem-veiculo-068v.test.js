'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js'),W=require('../functions/_shared/whatsapp-core.js');
const dia='2026-11-27',p={cd_pedido:880001,documento:'12000000000881',cliente_tipo:'cnpj',dt_pedido:'2026-11-24T10:00:00-03:00',etapa:'separando',caixas_24:5000};
const cs={[p.documento]:{nome:'QA CEASA',logradouro:'Mercado CEASA',pos:R.ROTA.CEASA_CENTRO,bairro:'QA'}};
const cfg=R.cfgDe({feriados_sem_saida:false,hora_saida:'08:00'});
test('068V sem escolha nem enderecoCEASA/etapa atribuemveiculo emv1/v2',()=>{
 for(const marcacao of [false,true]){const r=R.planejar([p],cs,dia,{cfg,marcacao});assert.equal(r.semVeiculo,1);assert.deepEqual(r.semVeiculoPedidos,[{cd_pedido:880001}]);assert.equal(r.aguardando[0].veiculo,null);assert.equal(r.aguardando[0].semVeiculo,true);assert.equal(r.aguardando[0].faltaMarcar,true);assert.deepEqual(R.itensDaRota(r),[]);assert.ok(r.ordem.every(id=>r.veiculos[id].volume===0));}
});
test('068V fotoAUTOsomente fallback nao atribui e permanece byteintacta',()=>{
 const fx={data:dia,estado:'fechada',automatico:true,itens:[{cd_pedido:p.cd_pedido,veiculo_id:'s10',ordem:1}]},before=JSON.stringify(fx),e={entregue:true,pendente:false,pronto_despacho:false};
 const r=R.planejar([p],cs,dia,{cfg,marcacao:true,fechada:fx,pedidos_estado:{[p.cd_pedido]:e},modo_planejamento:'definitiva'});
 assert.equal(r.semVeiculo,1);assert.deepEqual(R.itensDaRota(r),[]);assert.equal(JSON.stringify(fx),before);
});
test('068V plano manual explicito preservado sem escolhaPP/cliente',()=>{
 const r=R.planejar([p],cs,dia,{cfg,marcacao:true,plano:{[p.cd_pedido]:{dia,veiculo_id:'caminhao'}}});assert.equal(r.semVeiculo,0);assert.equal(r.caminhao.pedidos[0].p.cd_pedido,p.cd_pedido);
});
test('068V semana semveiculo fica fora linhas/capacidade; escolha vence',()=>{
 const r=R.planejarSemana([p],cs,'2026-11-23',{cfg});assert.equal(r.semVeiculo,1);assert.equal(r.faltaMarcar.length,1);assert.ok(r.dias.every(d=>d.volume===0));
 const a=R.planejar([p],cs,dia,{cfg,marcacao:true,porPedido:{[p.cd_pedido]:'caminhao'}});assert.equal(a.semVeiculo,0);assert.equal(a.caminhao.pedidos.length,1);
});
test('068V chefe cita N semveiculo mesmo semrota e respeita parametrosMeta',()=>{
 const d={pedidos:[p],clientes:cs,cfg,v2:true,excecoes:{},porPedido:{}};const msg=W.montarChefe(d,new Date(dia+'T08:00:00-03:00'),{});
 assert.equal(msg.resumo.semVeiculo,1);assert.match(msg.texto,/1 pedido sem veiculo/);assert.ok(msg.partes.every(parte=>W.renderizar(parte).length<=W.WA.CORPO_MAX));assert.equal(msg.resumo.pedidos,0);
});
