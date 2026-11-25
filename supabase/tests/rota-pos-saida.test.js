'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../functions/_shared/rota-core.js');
const p = {cd_pedido:1537,documento:'12345678000100',etapa:'atendido',dt_pedido:'2026-11-24T07:00:00-03:00',dt_atendido:'2026-11-24T17:54:00-03:00'};
const cfg = {hora_saida:'08:00',feriados_sem_saida:false};
test('1537: foto de 24 nao antecipa faturado a noite; painel e resumo usam saida25',()=>{
 const ctx={cfg,saidas:{1537:'2026-11-24'},agora:'2026-11-24T18:00:00-03:00'};
 assert.equal(R.saidaEntrega(p,ctx),'2026-11-25T08:00:00-03:00');
 assert.equal(R.etapaEntrega(p,ctx),'pronto_despacho');
 for(const [hora,etapa] of [['07:59:00','pronto_despacho'],['08:00:00','enviado'],['08:01:00','enviado']])
  assert.equal(R.etapaEntrega(p,{...ctx,agora:`2026-11-25T${hora}-03:00`}),etapa);
 assert.equal(R.saidaEntrega(p,{cfg,saidas:{1537:'2026-11-26'}}),'2026-11-26T08:00:00-03:00');
 assert.equal(R.saidaEntrega({...p,dt_atendido:'2026-11-24T08:00:00-03:00'},ctx),'2026-11-24T08:00:00-03:00');
 assert.equal(R.saidaEntrega(p,{cfg,fechada:{data:'2026-11-24',itens:[{cd_pedido:1537}]}}),'2026-11-25T08:00:00-03:00');
});
test('inclusao automatica depois da saida adia para proxima rota; manual salvo permanece',()=>{
 const pedido={...p,etapa:'separando'},clientes={[p.documento]:{nome:'Teste',pos:null}},dia='2026-11-24';
 const opts={cfg,marcacao:true,fechada:{data:dia,estado:'fechada',itens:[]}};
 for(const [hora,n] of [['07:59:00',1],['08:00:00',1],['08:01:00',0],['10:30:00',0]]){
  const o={...opts,agora:`${dia}T${hora}-03:00`};
  assert.equal(R.propostaSeparando([pedido],clientes,dia,o).adicoes.length,n,hora);
  const pl=R.planejar([pedido],clientes,dia,o);
  if(!n){assert.equal(pl.fica[0].proxima,'2026-11-25');assert.ok(!pl.entregues[1537]);}
 }
 const manual={...opts,agora:`${dia}T10:30:00-03:00`,fechada:{data:dia,itens:[{cd_pedido:1537,veiculo_id:'s10',ordem:1,origem:'adicionado'}]}};
 assert.ok(R.planejar([pedido],clientes,dia,manual).entregues[1537]);
 const sabado={...opts,agora:'2026-11-27T10:30:00-03:00',fechada:{data:'2026-11-27',itens:[]}};
 assert.equal(R.planejar([pedido],clientes,'2026-11-27',sabado).fica[0].proxima,'2026-11-30');
});
test('adiado nao perde veiculo quando ERP avanca durante a noite; marcacao e045 prevalecem',()=>{
 const x={...p,dt_sep_inicio:'2026-11-24T10:30:00-03:00'},cs={[p.documento]:{nome:'Teste'}},o={cfg,marcacao:true};
 const plano=extra=>R.planejar([x],cs,'2026-11-25',{...o,...extra});
 assert.ok(plano().entregues[1537]);assert.equal(plano().s10.pedidos[0].marcacao,'separando');
 assert.equal(R.propostaSeparando([x],cs,'2026-11-25',{...o,agora:'2026-11-25T07:59-03:00',fechada:{data:'2026-11-25',itens:[]}}).adicoes.length,1,'foto fechada cedo tambem admite adiado antes da saida');
 assert.equal(plano({porPedido:{1537:'caminhao'}}).caminhao.pedidos[0].veiculo,'caminhao');
 assert.ok(!plano({ignorados:{1537:true}}).entregues[1537]);
 assert.equal(R.planejar([{...x,dt_sep_inicio:'2026-11-24T07:59:00-03:00'}],cs,'2026-11-25',o).aguardando.length,1);
});
test('primeiro fechamento automatico atrasado nao captura criacao ou separacao pos0800',()=>{
 const x={...p,etapa:'conferido',dt_sep_inicio:'2026-11-24T10:30:00-03:00',caixas_24:1,caixas_48:0,caixas_outras:0},cs={[p.documento]:{nome:'Teste'}};
 const o={cfg,marcacao:true,porPedido:{1537:'s10'},fechamentoAutomatico:true};
 assert.ok(!R.planejar([x],cs,'2026-11-24',o).entregues[1537]);
 assert.ok(R.planejar([{...x,dt_sep_inicio:'2026-11-24T08:00:00-03:00'}],cs,'2026-11-24',o).entregues[1537]);
 assert.ok(!R.planejar([{...x,dt_pedido:'2026-11-24T10:30:00-03:00',dt_sep_inicio:null}],cs,'2026-11-24',o).entregues[1537]);
 assert.ok(R.planejar([x],cs,'2026-11-24',{...o,fechamentoAutomatico:false}).entregues[1537],'fechamento manual nao recebe o filtro automatico');
});
