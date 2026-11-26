'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base='../../';
const Cal=require(base+'js/admin-calendario.js'),M=require(base+'js/admin-movimento.js');
const R=require('../functions/_shared/rota-core.js');
const w={TempRioRotaCore:R,TempRioCalendario:Cal};
vm.runInNewContext(fs.readFileSync(require.resolve(base+'js/admin-rota-quadro.js'),'utf8'),w);
const Q=w.TempRioRotaQuadro;
function quadro(entregue=false){
 const d=Q.dadosExemplo();d.movimentoAtomico=true;d.dias.forEach(x=>x.cartoes.forEach(c=>c.entregue=entregue));d.bandeja.forEach(c=>c.entregue=entregue);return Q.normalizarEstado(d);
}
test('H: Hoje/passado saem por RPC pontual, sem rascunho de plano fechado',()=>{
 const s=quadro();
 for(const col of s.dias.filter(d=>d.dia<=s.hoje))for(const c of col.cartoes){
  assert.equal(c.bloqueado,false);
  const r=Q.aplicarAcao(s,{tipo:'mover',cd_pedido:c.cd_pedido,paraDia:'2026-11-27',veiculo:'s10'});
  assert.equal(r.ok,true);assert.equal(r.pontual.dia,'2026-11-27');assert.equal(r.estado.temRascunho,s.temRascunho);assert.equal(r.estado.dias[0].cartoes.length,s.dias[0].cartoes.length);
  const b=Q.aplicarAcao(s,{tipo:'remover',cd_pedido:c.cd_pedido});assert.equal(b.ok,true);assert.equal(b.pontual.dia,null);
 }
});
test('H: passado→Hoje destino continua recusado; origem Hoje liberada e futuro validado',()=>{
 const d=quadro();d.dias.find(x=>x.dia===d.hoje).fechada=false;d.fechados=[];
 const s=Q.normalizarEstado(d),c=s.dias[0].cartoes[0];
 assert.equal(Q.aplicarAcao(s,{tipo:'mover',cd_pedido:c.cd_pedido,paraDia:s.hoje,veiculo:'s10'}).ok,false);
 for(const dia of ['2026-11-24','2026-11-29','2026-11-28'])assert.equal(Q.aplicarAcao(s,{tipo:'mover',cd_pedido:c.cd_pedido,paraDia:dia,veiculo:'s10'}).ok,false);
});
test('H: backend false vence ERP/foto/bloqueio legado; true bloqueia todas as origens',()=>{
 const d=quadro();const c=d.dias[0].cartoes[0];c.bloqueado=true;c._bloqueadoProprio=true;c.veiculoSomenteLeitura=true;c.etapa='atendido';c.dt_saida='2026-11-20';c.entregue=false;
 let s=Q.normalizarEstado(d),n=s.dias[0].cartoes[0];assert.equal(n.bloqueado,false);assert.equal(n.veiculoSomenteLeitura,false);
 c.entregue=true;s=Q.normalizarEstado(d);assert.equal(s.dias[0].cartoes[0].bloqueado,true);
 for(const tipo of ['mover','remover','trocar_veiculo'])assert.equal(Q.aplicarAcao(s,{tipo,cd_pedido:c.cd_pedido,paraDia:'2026-11-27',veiculo:'s10'}).ok,false);
});
test('Calendário qualquer semana/mês, não limitado à semana atual; flags preservadas ao normalizar',()=>{
 const s=quadro(),c=s.dias[0].cartoes[0];s.calendarioH['2026-12']={fechados:[],feriados:[],sem_saida:[]};
 const r=Q.aplicarAcao(s,{tipo:'mover',cd_pedido:c.cd_pedido,paraDia:'2026-12-09',veiculo:'s10'});assert.equal(r.ok,true);assert.equal(r.pontual.dia,'2026-12-09');
 const html=Q.html(s);assert.match(html,/data-calendario/);assert.ok(!html.includes('data-rq-mover-dia='));
 assert.equal(Q.normalizarEstado(s).dias[0].cartoes[0].entregue,false);
 assert.equal(Cal.mes('2026-12-31',1),'2027-01-01');assert.equal(Cal.somar('2028-02-28',1),'2028-02-29');assert.equal(Cal.somar('2026-02-29',0),null);
 const h=Cal.html({mes:'2026-12-01',hoje:'2026-11-26',min:'2026-11-26',indisponivel:d=>d==='2026-12-09'?'Oficina':''});
 assert.match(h,/data-cal-dia="2026-12-06"[^>]*disabled/);assert.match(h,/data-cal-dia="2026-12-09"[^>]*disabled/);assert.ok(h.includes('Próximo mês'));assert.ok(h.includes('Dezembro 2026'));
});
test('Estado backend em blocos200; falha/incompleto nunca publica mapa parcial',async()=>{
 const chamadas=[],ids=Array.from({length:401},(_,i)=>i+1),sb={rpc:async(n,a)=>{chamadas.push(a.p_cds);return {data:a.p_cds.map(cd=>({cd_pedido:cd,entregue:false}))};}};
 const m=await M.lerEstados(sb,ids);assert.deepEqual(chamadas.map(x=>x.length),[200,200,1]);assert.equal(Object.keys(m).length,401);
 let n=0;await assert.rejects(M.lerEstados({rpc:async()=>++n===2?{error:{message:'57014'}}:{data:ids.slice(0,200).map(cd=>({cd_pedido:cd,entregue:false}))}},ids),/57014/);
 await assert.rejects(M.lerEstados({rpc:async()=>({data:[]})},[1]),/incompleta/);
});
test('Movimento usa única RPC, UUID idêntico no retry; sem salvar065/escrever tabelas',async()=>{
 const req={cd_pedido:1,dia:'2026-12-09',veiculo:'s10',requisicao:'12345678-1234-4234-8234-123456789abc'},calls=[];
 const sb={rpc:async(n,a)=>{calls.push({n,a});return calls.length===1?{error:{message:'Falha temporária'}}:{data:{status:'ok',repetido:true,origem:{inicio:'2026-11-23'},destino:{inicio:'2026-12-07'}}};}};
 await assert.rejects(M.mover(sb,req),/temporária/);const r=await M.mover(sb,req);assert.equal(r.repetido,true);assert.equal(calls[0].a.p_requisicao,calls[1].a.p_requisicao);assert.ok(calls.every(c=>c.n==='rota_068_mover_pedido'));
});
function integracao(){
 class Relogio extends Date{constructor(...a){super(...(a.length?a:['2026-11-26T15:00:00Z']));}}
 let id=0;const win={TempRioRotaCore:R,TempRioRotaQuadro:Q,TempRioMovimento:{...M,uuid:()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`}};
 const ctx={window:win,Intl,Date:Relogio,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console};
 let src=fs.readFileSync(require.resolve(base+'js/admin-rota.js'),'utf8');
 src=src.replace('    raiz.TempRioRota = {','    raiz.qa={st,aplicarLeituraSemana065,montarDadosQuadro065,persistirMovimentoPedido,pedidoSomenteLeituraSaida};desenhar=function(){};recarregarTudo=function(){raiz.recargas=(raiz.recargas||0)+1;};\n    raiz.TempRioRota = {');
 vm.runInNewContext(src,ctx);const a=win.qa,s=a.st;
 const frota=[{id:'s10',nome:'S10',modo:'porta',capacidade_volume:2700,dias_sem_saida:[0,6],ativo:true}];
 Object.assign(s,{ativo:true,vista:'semana',v2:true,podeMarcar:true,pln046:true,papel:'admin',frota047:true,frotaLinhas:frota,frota:R.frotaDe(frota),cfg:R.cfgDe({}),cfgLinha:{},pedidos:[{cd_pedido:1,etapa:'atendido',dt_pedido:'2026-11-20',dt_saida:'2026-11-25',cliente_nome:'Pedido com problema',caixas_24:1}],clientes:{},sem065:true});
 const leitura=(inicio='2026-11-23',entregue=false)=>({data:{status:'ok',inicio,hoje:'2026-11-26',versao:2,itens:[{cd_pedido:1,dia:'2026-11-26',veiculo_id:'s10',ordem:1}],sem_saida:[],fechados:['2026-11-26'],pedidos_estado:{1:{entregue,reprogramado:false}}}});
 a.aplicarLeituraSemana065('2026-11-23',leitura());
 return {a,s,win,leitura};
}
test('Integração real: ERP atendido +059/063/problema não excluem card com flag false; Histórico trava A',()=>{
 const {a,s,leitura}=integracao();s.diasSaida={1:'2026-11-25'};s.confirmacoes={1:{confirmado_em:'2026-11-25T15:00Z'}};
 const st=Q.normalizarEstado(a.montarDadosQuadro065('2026-11-23')),card=st.dias.flatMap(d=>d.cartoes).find(c=>c.cd_pedido===1);
 assert.ok(card);assert.equal(card.entregue,false);assert.equal(card.bloqueado,false);assert.equal(a.pedidoSomenteLeituraSaida(1),false);
 a.aplicarLeituraSemana065('2026-11-23',leitura('2026-11-23',true));assert.equal(a.pedidoSomenteLeituraSaida(1),true);
});
test('Integração real: erro não move card; retry usa UUID, sucesso relê semanas origem/destino sem salvar065',async()=>{
 const {a,s,win,leitura}=integracao(),calls=[];let falha=true;
 s.sb={rpc:async(n,args)=>{calls.push({n,args});if(n==='rota_068_mover_pedido')return falha?{error:{message:'Falha temporária'}}:{data:{status:'ok',origem:{inicio:'2026-11-23'},destino:{inicio:'2026-12-07'}}};return leitura(args.p_inicio);}};
 const acao={cd_pedido:1,dia:'2026-12-09',veiculo:'s10'},estado={inicio:'2026-11-23',temRascunho:false};
 await a.persistirMovimentoPedido(acao,estado);assert.equal(s.semMsgErro,true);assert.equal(s.sem065Dados['2026-11-23'].itens[0].dia,'2026-11-26');assert.equal(s.semSalvando,false);
 falha=false;await a.persistirMovimentoPedido(acao,estado);assert.equal(s.semMsgErro,false);assert.equal(win.recargas,1);
 const m=calls.filter(c=>c.n==='rota_068_mover_pedido');assert.equal(m.length,2);assert.equal(m[0].args.p_requisicao,m[1].args.p_requisicao);
 assert.deepEqual(calls.filter(c=>c.n==='rota_065_ler_semana').map(c=>c.args.p_inicio),['2026-11-23','2026-12-07']);assert.ok(!calls.some(c=>c.n==='rota_065_salvar_semana'));
});
test('Integração real: resposta de sessão antiga não altera cache nem dispara releitura',async()=>{
 const {a,s,win}=integracao();let resolver;s.sb={rpc:()=>new Promise(ok=>resolver=ok)};
 const p=a.persistirMovimentoPedido({cd_pedido:1,dia:'2026-12-09',veiculo:'s10'},{inicio:'2026-11-23'});
 await Promise.resolve();s.sessao++;s.sb=null;s.estadosH=null;s.movimentoReq={};
 resolver({data:{status:'ok',origem:{inicio:'2026-11-23'},destino:{inicio:'2026-12-07'}}});await p;
 assert.equal(s.estadosH,null);assert.equal(win.recargas,undefined);assert.deepEqual(Object.keys(s.movimentoReq),[]);
});
test('Pedidos/A: só flag canônica trava; RecebidoHoje/problema e vencido editáveis; virada descarta flag antiga',async()=>{
 let agora='2026-11-26T23:59:00-03:00';class Relogio extends Date{constructor(...a){super(...(a.length?a:[agora]));}}
 const calls=[],sb={rpc:async(n,a)=>{calls.push({n,a});return {data:{status:'ok',resultado:'pedido',plano:null}};}};
 const win={TempRioRotaCore:R,TempRioMovimento:M,addEventListener(){},dispatchEvent(){}};
 const sandbox={window:win,Intl,Date:Relogio,sb,papel:'admin',celular:()=>false,localStorage:{getItem:()=>null},document:{getElementById:()=>null,querySelectorAll:()=>[]},$:()=>null,peAtualizarTopo(){},secaoVisivel:()=>false,abasParaRedesenhar:{},esc:String,NUM:new Intl.NumberFormat('pt-BR')};
 const src=fs.readFileSync(require.resolve(base+'js/admin.js'),'utf8'),ini=src.indexOf('    var PE_COLUNAS ='),fim=src.indexOf('    function peFecharLegenda',ini);
 const a=vm.runInNewContext(src.slice(ini,fim)+';({pe,pePedidoJaSaiu,peSalvarVeiculoPedido,peVeiculoHtml});',sandbox);
 const p={cd_pedido:1,etapa:'atendido',dt_pedido:'2026-11-01',dt_saida:'2026-11-25'};
 Object.assign(a.pe,{itens:[p],cfg:R.cfgDe({}),podeMarcar:true,estadosDia:'2026-11-26',estadosH:{1:{entregue:false}},porPedido:{1:'s10'}});
 assert.equal(a.pePedidoJaSaiu(p),false);assert.match(a.peVeiculoHtml(p),/data-pe-veiculo=/);
 await a.peSalvarVeiculoPedido(1,'caminhao');assert.equal(calls.length,1);assert.equal(calls[0].n,'rota_068_trocar_veiculo');
 a.pe.estadosH[1].entregue=true;assert.equal(a.pePedidoJaSaiu(p),true);await a.peSalvarVeiculoPedido(1,'s10');assert.equal(calls.length,1);
 a.pe.estadosH[1].entregue=false;agora='2026-11-27T00:00:00-03:00';assert.equal(a.pePedidoJaSaiu(p),true,'não usa flagfalse de ontem após00hSP');
});
test('Calendário H: lê5/6 semanas, avulso/fechados coerentes, falha não publica parcial e retry relê',async()=>{
 const {a,s}=integracao();
 // Use a separate hook to exercise the real month reader without exporting a production test API.
 const src=fs.readFileSync(require.resolve(base+'js/admin-rota.js'),'utf8');const ctx={window:{TempRioRotaCore:R},Intl,Date,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console};
 vm.runInNewContext(src.replace('    raiz.TempRioRota = {','    raiz.qa={st,lerCalendarioH};desenhar=function(){};\n    raiz.TempRioRota = {'),ctx);
 const api=ctx.window.qa;Object.assign(api.st,{ativo:true,cfg:R.cfgDe({})});let chamadas=0,falha=true;
 api.st.sb={rpc:async(n,args)=>{chamadas++;if(falha&&args.p_inicio==='2026-12-07')return {error:{message:'57014'}};return {data:{status:'ok',fechados:['2026-12-10'],sem_saida:[{dia:'2026-12-09',veiculo_id:'s10'}]}};}};
 await assert.rejects(api.lerCalendarioH('2026-12-01'),/57014/);assert.equal(Object.keys(api.st.calendarioH).length,0);
 falha=false;const d=await api.lerCalendarioH('2026-12-01');assert.equal(chamadas,10);assert.ok(d.fechados.includes('2026-12-10'));assert.ok(d.sem_saida.some(x=>x.dia==='2026-12-09'));
});
test('Ordenação dentro de dia futuro conserva posição escolhida no rascunho; não usa RPC sem parâmetro de ordem',()=>{
 const s=quadro(),dia=s.dias.find(d=>d.dia==='2026-11-27'),cd=dia.cartoes[2].cd_pedido;
 const r=Q.aplicarAcao(s,{tipo:'mover',cd_pedido:cd,paraDia:dia.dia,ordem:1});
 assert.equal(r.ok,true);assert.equal(r.pontual,undefined);assert.equal(r.estado.temRascunho,true);
 assert.equal(r.estado.dias.find(d=>d.dia===dia.dia).cartoes[0].cd_pedido,cd);
});
