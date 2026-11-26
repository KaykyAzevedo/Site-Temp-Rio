'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js'),M=require('../../js/admin-movimento.js'),Cal=require('../../js/admin-calendario.js');
const read=p=>fs.readFileSync(require.resolve('../../'+p),'utf8');
function app({entregue=false,pendente=false,foto=false,reprogramado=false}={}){
 class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-26T19:49:19Z']));}}
 const calls=[],spy={...R};for(const n of ['planejar','planejarSemana','sugestoesJuntar'])spy[n]=function(...a){calls.push({n,opts:a.at(-1)});return R[n](...a);};
 const w={TempRioRotaCore:spy,TempRioCalendario:Cal},ctx={window:w,Intl,Date:Clock,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console};
 vm.runInNewContext(read('js/admin-rota-quadro.js'),w);
 const src=read('js/admin-rota.js');vm.runInNewContext(src.replace('    raiz.TempRioRota = {','    raiz.qa={st,aplicarLeituraSemana065,montarDadosQuadro065,pedidoSomenteLeituraSaida,optsPlano,planos,planejarDetalheDia,calcularJuntar};desenhar=function(){};\n    raiz.TempRioRota = {'),ctx);
 const a=w.qa,s=a.st,frota=[{id:'s10',nome:'S10',modo:'porta',ativo:true,capacidade_volume:2700,dias_sem_saida:[0,6]}];
 const p={cd_pedido:1,documento:'11222333000181',etapa:'atendido',dt_pedido:'2026-11-25T09:00:00-03:00',dt_saida:'2026-11-26T09:00:00-03:00',caixas_24:1};
 Object.assign(s,{ativo:true,vista:'semana',v2:true,podeMarcar:true,pln046:true,papel:'admin',sem065:true,frota047:true,frotaLinhas:frota,frota:R.frotaDe(frota),cfg:R.cfgDe({}),cfgLinha:{},pedidos:[p],clientes:{},porPedido:{1:'s10'},fx050:foto,fxFoto:foto?{data:'2026-11-26',itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1}]}:null});
 const leitura={status:'ok',inicio:'2026-11-23',hoje:'2026-11-26',versao:1,itens:[],sem_saida:[],fechados:foto?['2026-11-26']:[],pedidos_estado:{1:{entregue,pendente,reprogramado}}};
 function ler(){a.aplicarLeituraSemana065('2026-11-23',{data:leitura});}
 function quadro(){return w.TempRioRotaQuadro.normalizarEstado(a.montarDadosQuadro065('2026-11-23'));}
 ler();return {a,s,w,calls,leitura,ler,quadro};
}
test('RecebidoHoje(!entregue,!pendente) é movível, mas não reaparece sozinho em bandeja/sugestões',()=>{
 const x=app();assert.equal(x.a.pedidoSomenteLeituraSaida(1),false);assert.equal(x.quadro().bandeja.length,0);assert.equal(x.quadro().dias.flatMap(d=>d.cartoes).length,0);
});
test('RecebidoHoje fica visível na foto como origem movível; somente reprogramação explícita reabre fila',()=>{
 const x=app({foto:true}),q=x.quadro();assert.equal(q.bandeja.length,0);assert.ok(q.dias.find(d=>d.dia==='2026-11-26').cartoes.some(c=>c.cd_pedido===1&&!c.bloqueado));
 x.leitura.pedidos_estado[1]={entregue:false,pendente:true,reprogramado:true};x.leitura.itens=[{cd_pedido:1,dia:'2026-11-27',veiculo_id:'s10',ordem:1}];x.ler();
 const novo=x.quadro();assert.ok(!novo.dias.find(d=>d.dia==='2026-11-26').cartoes.length);assert.equal(novo.dias.find(d=>d.dia==='2026-11-27').cartoes[0].cd_pedido,1);
});
test('Problema movível em foto passada não é autorretornado à fila; permite solicitar tentativa explícita',()=>{
 const x=app({foto:true,entregue:false,pendente:false});x.s.fxFoto.data='2026-11-25';x.s.pedidos[0].dt_saida='2026-11-25T09:00:00-03:00';x.leitura.fechados=['2026-11-25'];x.ler();
 const q=x.quadro(),card=q.dias.find(d=>d.dia==='2026-11-25').cartoes[0];assert.ok(card);assert.equal(card.bloqueado,false);assert.equal(q.bandeja.length,0);
 const r=x.w.TempRioRotaQuadro.aplicarAcao(q,{tipo:'mover',cd_pedido:1,paraDia:'2026-11-27',veiculo:'s10'});assert.equal(r.ok,true);assert.equal(r.pontual.dia,'2026-11-27');assert.equal(x.s.fxFoto.data,'2026-11-25');
});
test('Legado anterior23 finalizado continua fora; pedido realmente pendente antigo continua editável',()=>{
 const x=app({entregue:true,pendente:false});x.s.pedidos[0].dt_pedido='2026-10-01T09:00:00-03:00';x.s.pedidos[0].dt_saida='2026-10-03T09:00:00-03:00';
 assert.equal(x.a.pedidoSomenteLeituraSaida(1),true);assert.equal(x.quadro().bandeja.length,0);
 x.s.pedidos[0].etapa='aberto';x.s.pedidos[0].dt_saida=null;x.leitura.pedidos_estado[1]={entregue:false,pendente:true,reprogramado:false};x.ler();
 assert.equal(x.quadro().bandeja[0].cd_pedido,1);assert.equal(x.a.pedidoSomenteLeituraSaida(1),false);
});
test('Mapa065 antigo/incompleto ou incoerente falha explicitamente, sem autorizar origem pela flagfalse',()=>{
 for(const estado of [{entregue:false},{entregue:true,pendente:true}]){
  const x=app();x.leitura.pedidos_estado[1]=estado;x.ler();assert.equal(x.s.estadosH,null);assert.equal(x.s.semMsgErro,true);assert.match(x.s.msgSemana,/estado|pendência/i);assert.equal(x.a.pedidoSomenteLeituraSaida(1),true);
 }
});
test('AdapterEstados exige os2booleanos e recusa incoerência; não publica bloco parcial',async()=>{
 for(const estado of [{entregue:false},{entregue:true,pendente:true}])await assert.rejects(M.lerEstados({rpc:async()=>({data:[{cd_pedido:1,...estado}]})},[1]),/estado|incompleta|incoerente/i);
 const r=await M.lerEstados({rpc:async()=>({data:[{cd_pedido:1,entregue:false,pendente:false}]})},[1]);assert.equal(r[1].pendente,false);
});
test('Planejadores reais recebem opts.pedidos_estado em planos/detalhe/juntar e montadorSemana',()=>{
 const x=app({pendente:true});assert.equal(x.a.optsPlano().pedidos_estado,x.s.estadosH);
 const planos=x.a.planos();x.a.planejarDetalheDia('2026-11-27',planos,x.a.optsPlano());x.a.calcularJuntar(planos.hoje,{});x.s.sem065Dados['2026-11-23'].versao=0;x.quadro();
 assert.ok(x.calls.some(c=>c.n==='planejar'));assert.ok(x.calls.some(c=>c.n==='planejarSemana'));assert.ok(x.calls.some(c=>c.n==='sugestoesJuntar'));
 for(const c of x.calls)assert.equal(c.opts.pedidos_estado,x.s.estadosH,c.n+' usa mapa canônico');
});
test('Core fornecido: mapa canônico prevalece sobre reprogramados/heurística; fornecido incompleto não vira fallback',()=>{
 const p={cd_pedido:1,etapa:'aberto',dt_pedido:'2026-11-01T12:00:00-03:00'},cfg=R.cfgDe({});
 for(const estado of [{entregue:false,pendente:false},{entregue:true,pendente:false},{entregue:false,pendente:true}])assert.equal(R.pendenteEntrega(p,{},'2026-11-26',cfg,{pedidos_estado:{1:estado},reprogramados:{1:true}}),estado.pendente);
 for(const mapa of [{},{1:{entregue:false}},{1:{entregue:true,pendente:true}}])assert.throws(()=>R.pendenteEntrega(p,{},'2026-11-26',cfg,{pedidos_estado:mapa}),/canonico|invalido/);
});
