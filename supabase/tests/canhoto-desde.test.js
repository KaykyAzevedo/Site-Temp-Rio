'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js');
const corte='2026-11-23T12:00:00-03:00',dia='2026-11-24';
const ped=(cd,em)=>({cd_pedido:cd,documento:String(12000000000000+cd),etapa:'atendido',dt_pedido:'2026-11-20T12:00:00-03:00',dt_saida:em,dt_atendido:'2026-11-23T17:24:00-03:00',caixas_24:1,caixas_48:0,caixas_outras:0});
const novos=[1528,1529,1530,1532,1534].map(cd=>ped(cd,'2026-11-23T17:23:00-03:00'));
const antigos=[1525,1526,1527].map(cd=>ped(cd,'2026-11-23T11:00:00-03:00'));
test('056: tres da manha sao legado, cinco das17h continuam Enviado; fronteira exata',()=>{
 const cfg=R.cfgDe({canhoto_desde:corte});
 for(const p of antigos){assert.equal(R.legadoRecebido(p,cfg),true);assert.equal(R.pendenteEntrega(p,{},dia,cfg),false);}
 for(const p of novos){assert.equal(R.recebidoEntrega(p,{},cfg),false);assert.equal(R.pendenteEntrega(p,{},dia,cfg),true);}
 assert.equal(R.legadoRecebido(ped(9,'2026-11-23T14:59:59.999Z'),cfg),true);
 assert.equal(R.legadoRecebido(ped(9,'2026-11-23T15:00:00Z'),cfg),false);
 assert.equal(R.legadoRecebido({...antigos[0],etapa:'conferido'},cfg),false);
 assert.equal(R.recebidoEntrega(novos[0],{1528:true},cfg),true);
});
test('056: sem coluna conserva055; faturamento usa saida > nota > atendido',()=>{
 assert.equal(R.legadoRecebido(antigos[0],R.cfgDe({})),false);
 assert.equal(R.pendenteEntrega(antigos[0],{},dia,R.cfgDe({})),true);
 const cfg=R.cfgDe({canhoto_desde:corte});
 assert.equal(R.legadoRecebido({...antigos[0],dt_saida:null,dt_nota:'2026-11-23T11:59:00-03:00'},cfg),true);
 assert.equal(R.legadoRecebido({...antigos[0],dt_saida:null,dt_nota:null},cfg),false);
 assert.equal(R.legadoRecebido({...antigos[0],dt_saida:null,dt_nota:null,dt_atendido:null},cfg),false);
});
test('056: diaria/foto/semana/juntar/lista antiga excluem legado sem perder cinco novos',()=>{
 const ps=antigos.concat(novos),porPedido=Object.fromEntries(ps.map(p=>[p.cd_pedido,'s10'])),clientes=Object.fromEntries(ps.map(p=>[p.documento,{nome:'Cliente '+p.cd_pedido,pos:[R.ROTA.ORIGEM[0]+.01,R.ROTA.ORIGEM[1]+.01]}]));
 const opts={cfg:{canhoto_desde:corte},hoje:dia,marcacao:true,porPedido};
 assert.deepEqual(Object.keys(R.planejar(ps,clientes,dia,opts).entregues).map(Number),novos.map(p=>p.cd_pedido));
 const foto={data:dia,itens:ps.map((p,i)=>({cd_pedido:p.cd_pedido,veiculo_id:'s10',ordem:i+1}))};
 assert.equal(Object.keys(R.planejar(ps,clientes,dia,{...opts,fechada:foto}).entregues).length,5);
 assert.equal(R.planejarSemana(ps,clientes,'2026-11-30',opts).resumo.pedidos,5);
 const ref=novos[0],rota=R.planejar([ref],clientes,dia,opts);
 assert.equal(R.sugestoesJuntar(ps,clientes,rota,opts).sugestoes.flatMap(s=>s.cds).some(cd=>cd<1528),false);
 const velho=ped(1,'2026-11-01T12:00:00-03:00');
 assert.equal(R.planejar([velho],{},dia,opts).enviadosAntigos.length,0);
 assert.equal(R.planejar([velho],{},dia,{...opts,cfg:{}}).enviadosAntigos.length,1);
});
