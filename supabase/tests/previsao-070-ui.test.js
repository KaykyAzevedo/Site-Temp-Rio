'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const U=require('../../js/admin-previsao.js');
test('070 seletor distingue previsão e definitiva com estado acessível',()=>{
 const h=U.htmlModos('previsao');
 assert.match(h,/aria-label="Modo de planejamento"/);
 assert.match(h,/data-rota-modo="previsao" aria-pressed="true"/);
 assert.match(h,/data-rota-modo="definitiva" aria-pressed="false"/);
 assert.match(h,/Rota de amanhã/);assert.match(h,/Pronto pra despacho/);
 assert.match(U.htmlModos('definitiva'),/data-rota-modo="definitiva" aria-pressed="true"/);
});
test('070 data marcada mostra leitura para equipe e calendário apenas com permissão explícita',()=>{
 assert.doesNotMatch(U.htmlSaida(15,{valor:'2026-12-09'}),/data-calendario|data-saida070-remover/);
 const h=U.htmlSaida(15,{podeEditar:true,valor:'2026-12-09',hoje:'2026-11-26'});
 assert.match(h,/09\/12\/2026/);assert.match(h,/data-calendario="saida070-15"/);assert.match(h,/data-saida070-remover="15"/);
});
test('070 erro é explícito e uma gravação pendente desabilita o calendário e remoção',()=>{
 const h=U.htmlSaida(15,{podeEditar:true,valor:'2026-12-09',hoje:'2026-11-26',salvando:true,erro:'Falha <RPC>'});
 assert.match(h,/Falha &lt;RPC&gt;/);assert.match(h,/data-saida070-remover="15" disabled/);assert.match(h,/Salvando/);
 const selecionado=h.match(/<button[^>]*data-cal-dia="2026-12-09"[^>]*>/)[0];assert.match(selecionado,/ disabled/);
});

const fs=require('node:fs'),vm=require('node:vm'),R=require('../functions/_shared/rota-core.js');
function estado(cd,estado='pronto_despacho'){return {cd_pedido:cd,entregue:estado==='historico',pendente:!['historico','recebido'].includes(estado),reprogramado:false,data_recebimento:estado==='recebido'?'2026-11-27':null,pronto_despacho:estado==='pronto_despacho',estado_070:estado,data_saida_marcada:null,origem_data_saida:null,data_rota_reservada:null,historico_em:null};}
function pedidosUI(){
 class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-27T10:00:00-03:00']));}}
 const ctx={window:{TempRioRotaCore:R,TempRioPrevisao:U,addEventListener(){}},Intl,Date:Clock,Promise,console,celular:()=>false,localStorage:{getItem:()=>null},esc:String};
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8'),a=src.indexOf('    var PE_COLUNAS ='),b=src.indexOf('    function peFecharLegenda',a);
 return vm.runInNewContext(src.slice(a,b)+';({pe,PE_COLUNAS,peIndice,peRecebidoRecente,peDataEntrega});',ctx);
}
test('070 coluna real usa estado/flag server; ERP bruto não decide Pronto/Recebidos',()=>{
 const a=pedidosUI();Object.assign(a.pe,{estadosDia:'2026-11-27',estadosH:{1:estado(1),2:estado(2,'recebido'),3:estado(3,'historico'),4:estado(4,'aberto')}});
 for(const [cd,indice] of [[1,4],[2,6],[3,6],[4,0]])assert.equal(a.peIndice({cd_pedido:cd,etapa:'atendido'}),indice);
 assert.equal(a.PE_COLUNAS[4].titulo,'Pronto pra despacho');assert.equal(a.peRecebidoRecente({cd_pedido:2}),true);assert.equal(a.peRecebidoRecente({cd_pedido:3}),false);
 assert.match(a.peDataEntrega({cd_pedido:1}),/Pronto pra despacho/);assert.equal(a.peDataEntrega({cd_pedido:2}),'Recebido em 27/11/2026');
 a.pe.estadosDia='2026-11-26';assert.equal(a.peIndice({cd_pedido:1,etapa:'conferido'}),-1,'não infere após virada sem estado novo');
});
test('070 adaptador exige prontidão coerente/estado/data; sem fallback paraH antigo',async()=>{
 for(const e of [{entregue:false,pendente:true},{...estado(1),pronto_despacho:false},{...estado(1),entregue:true}])await assert.rejects(U.lerEstados({rpc:async()=>({data:[e]})},[1]),/070|prontidão/);
 for(const code of ['PGRST202','57014','42501'])await assert.rejects(U.lerEstados({rpc:async()=>({error:{code,message:code}})},[1]),new RegExp(code));
});
test('070 leitura em blocos200 publica só conjunto completo; falha bloco2 não vira vazio',async()=>{
 const blocos=[],ids=Array.from({length:401},(_,i)=>i+1),sb={rpc:async(n,a)=>{assert.equal(n,'rota_070_estados_pedidos');blocos.push(a.p_cds.length);return {data:a.p_cds.map(cd=>estado(cd))};}};
 const m=await U.lerEstados(sb,ids);assert.deepEqual(blocos,[200,200,1]);assert.equal(Object.keys(m).length,401);
 let chamadas=0;await assert.rejects(U.lerEstados({rpc:async(n,a)=>++chamadas===2?{error:{code:'57014',message:'bloco2'}}:{data:a.p_cds.map(cd=>estado(cd))}},ids),/bloco2/);assert.equal(chamadas,2);
});

function rotaUI(){
 class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-26T18:12:51-03:00']));}}
 const calls=[],spy={...R};for(const n of ['planejar','planejarSemana','sugestoesJuntar'])spy[n]=function(...a){calls.push({n,opts:a.at(-1),mapaAtual:w.qa&&w.qa.st.estadosH});return R[n](...a);};
 const w={TempRioRotaCore:spy,TempRioCalendario:require('../../js/admin-calendario.js'),TempRioPrevisao:U,TempRioMovimento:{uuid:()=> '00000000-0000-4000-8000-000000000001'}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../js/admin-rota-quadro.js'),'utf8'),w);
 const ctx={window:w,Date:Clock,Intl,Promise,console,setTimeout,clearTimeout,setInterval,clearInterval};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8').replace('    raiz.TempRioRota = {','    raiz.qa={st,aplicarLeituraSemana065,montarDadosQuadro065,optsPlano,planos,calcularJuntar,trocarModo070,confirmarDefinitiva070,fecharRotaDia,htmlDefinitiva070};desenhar=function(){};\n    raiz.TempRioRota = {'),ctx);
 const a=w.qa,s=a.st,frota=[{id:'s10',nome:'S10',modo:'porta',ativo:true,capacidade_volume:2700,dias_sem_saida:[0,6]}];
 const pedidos=[1,2,3].map(cd=>({cd_pedido:cd,etapa:cd===1?'atendido':'aberto',dt_pedido:'2026-11-25T12:00:00-03:00',documento:'11222333000181',caixas_24:1}));
 Object.assign(s,{ativo:true,vista:'semana',v2:true,podeMarcar:true,pln046:true,papel:'admin',sem065:true,frota047:true,frotaLinhas:frota,frota:R.frotaDe(frota),cfg:R.cfgDe({}),cfgLinha:{},pedidos,clientes:{},porPedido:{1:'s10',2:'s10',3:'s10'},semanaIni:'2026-11-23'});
 const leitura={status:'ok',inicio:'2026-11-23',hoje:'2026-11-26',versao:1,itens:[1,2].map((cd,i)=>({cd_pedido:cd,dia:'2026-11-27',veiculo_id:'s10',ordem:i+1})),sem_saida:[],fechados:[],pedidos_estado:{1:estado(1),2:estado(2,'aberto'),3:estado(3,'aberto')}};
 a.aplicarLeituraSemana065('2026-11-23',{data:leitura});const quadro=()=>w.TempRioRotaQuadro.normalizarEstado(a.montarDadosQuadro065('2026-11-23'));
 return {w,a,s,calls,leitura,quadro,ler:()=>a.aplicarLeituraSemana065('2026-11-23',{data:leitura})};
}
test('070 dois modos preservam rascunhos próprios, filtram futuro e transmitem opts aos3planejadores',()=>{
 const x=rotaUI();assert.equal(x.quadro().dias.find(d=>d.dia==='2026-11-27').cartoes.length,2);
 const rasc={sentinela:'rascunhoPrevisao'};x.s.semQuadroRasc['2026-11-23']=rasc;x.a.trocarModo070('definitiva');
 assert.ok(!x.s.semQuadroRasc['2026-11-23']);const q=x.quadro();assert.deepEqual(Array.from(q.dias.find(d=>d.dia==='2026-11-27').cartoes,c=>c.cd_pedido),[1]);assert.equal(q.bandeja.length,0);
 x.a.planos();x.a.calcularJuntar(x.a.planos().hoje,{});x.leitura.versao=0;x.leitura.itens=[];x.ler();x.quadro();
 for(const c of x.calls.filter(c=>c.opts.modo_planejamento==='definitiva')){assert.equal(c.opts.pedidos_estado,c.mapaAtual);assert.equal(c.opts.reservas_070,x.s.reservas070);}
 assert.ok(x.calls.some(c=>c.n==='planejarSemana'&&c.opts.modo_planejamento==='definitiva'));
 x.a.trocarModo070('previsao');assert.equal(x.s.semQuadroRasc['2026-11-23'],rasc);
});
test('070 recebido apósvirada permanece na reserva, sem voltar à bandeja; foto fechada entregue preservada bloqueada',()=>{
 const x=rotaUI();x.s.modo070='definitiva';x.leitura.pedidos_estado[1]=estado(1,'recebido');x.leitura.itens=[];x.ler();
 x.s.reservas070={'2026-11-27':{dia:'2026-11-27',versao:1,itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1,pronto_ao_reservar:true,ativo:true}]}};
 let q=x.quadro();assert.equal(q.dias.find(d=>d.dia==='2026-11-27').cartoes[0].cd_pedido,1);assert.equal(q.bandeja.length,0);
 assert.equal(U.itensDefinitiva(q,'2026-11-27',x.s.estadosH,x.s.reservas070).length,1);
 x.s.reservas070['2026-11-27'].itens[0].ativo=false;assert.equal(x.quadro().dias.find(d=>d.dia==='2026-11-27').cartoes.length,0);
 x.leitura.pedidos_estado[1]=estado(1,'historico');x.ler();x.s.definitiva070['2026-11-26']={foto:{data:'2026-11-26',estado:'fechada',itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1}]}};
 q=x.quadro();const c=q.dias.find(d=>d.dia==='2026-11-26').cartoes[0];assert.ok(c);assert.equal(c.bloqueado,true);assert.equal(q.bandeja.length,0);
});
test('070 salvar somente Prontos preserva itens nãoPronto ocultos e marcações de outra seleção',()=>{
 const persistidos=[{cd_pedido:2,dia:'2026-11-27',veiculo_id:'s10',ordem:2},{cd_pedido:3,dia:'2026-11-26',veiculo_id:'s10'}],enviar=[{cd_pedido:1,dia:'2026-11-27',veiculo_id:'s10',ordem:1}];
 const r=U.mesclarItensOcultos(enviar,persistidos,{1:estado(1),2:estado(2,'aberto'),3:estado(3,'aberto')},'2026-11-26',[]);assert.deepEqual(r.map(x=>x.cd_pedido),[1,2]);assert.equal(persistidos.length,2);
});
test('070 confirmação usa versão070 e conjunto completo de veículos; recusa nãoPronto/datafutura',async()=>{
 const x=rotaUI();x.s.modo070='definitiva';x.s.definitiva070['2026-11-27']={status:'ok',dia:'2026-11-27',cabecalho:{versao:9},foto:null,reservas_070:{}};
 let payload;x.s.sb={rpc:async(n,a)=>{if(n==='rota_070_definitiva_salvar'){payload=a;return {data:{status:'erro',motivo:'versao_antiga'}};}throw Error('RPC indevida '+n);}};
 await x.a.confirmarDefinitiva070();assert.equal(payload.p_versao_base,9);assert.equal(payload.p_dia,'2026-11-27');assert.equal(payload.p_itens.length,1);assert.equal(payload.p_itens[0].cd_pedido,1);assert.match(x.s.msgSemana,/versao_antiga/);assert.equal(x.s.definitiva070['2026-11-27'].cabecalho.versao,9);
 const q=x.quadro();x.s.estadosH[1].data_saida_marcada='2026-11-30';assert.throws(()=>U.itensDefinitiva(q,'2026-11-27',x.s.estadosH,{}),/outra data/);
 x.s.estadosH[1].data_saida_marcada=null;x.s.estadosH[1].pronto_despacho=false;assert.throws(()=>U.itensDefinitiva(q,'2026-11-27',x.s.estadosH,{}),/não está pronto/);
});

function saidaUI(){
 let agora='2026-11-26T18:12:51-03:00',atualizacoes=0;const pendentes=[],calls=[];
 class Clock extends Date{constructor(...a){super(...(a.length?a:[agora]));}}
 const sb={rpc(n,a){calls.push({n,a});return new Promise(resolve=>pendentes.push(resolve));}};
 const w={TempRioRotaCore:R,TempRioPrevisao:U,TempRioCalendario:require('../../js/admin-calendario.js'),TempRioMovimento:{uuid:()=> '00000000-0000-4000-8000-000000000001'},addEventListener(){},dispatchEvent(){}};
 const ctx={window:w,sb,papel:'admin',Intl,Date:Clock,Promise,console,celular:()=>false,localStorage:{getItem:()=>null},esc:String,$:()=>null,CustomEvent:class{}};
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8'),a=src.indexOf('    var PE_COLUNAS ='),b=src.indexOf('    function peFecharLegenda',a);
 const app=vm.runInNewContext(src.slice(a,b)+';peRedesenhar=function(){};carregarPedidosErp=function(){atualizarTeste();return Promise.resolve();};({pe,peSalvarSaida070,peOpcoesSaida070});',Object.assign(ctx,{atualizarTeste:()=>atualizacoes++}));
 Object.assign(app.pe,{estadosDia:'2026-11-26',estadosH:{1:estado(1)},podeMarcar:true,itens:[{cd_pedido:1}]});
 return {app,ctx,calls,pendentes,atualizacoes:()=>atualizacoes,virar:()=>agora='2026-11-27T00:00:01-03:00',esperar:async()=>{for(let i=0;i<10&&!pendentes.length;i++)await Promise.resolve();assert.ok(pendentes.length);}};
}
test('070 data marcada só muda apósRPCok; erro+retry mantêm UUID/payload e não há salvar065 direto',async()=>{
 const x=saidaUI(),p=x.app.peSalvarSaida070(1,'2026-11-30');await x.esperar();assert.equal(x.app.pe.estadosH[1].data_saida_marcada,null);assert.equal(x.app.pe.salvando070[1],true);
 x.pendentes[0]({error:{code:'57014',message:'Tente novamente'}});await p;assert.match(x.app.pe.erros070[1],/Tente novamente/);assert.equal(x.atualizacoes(),0);
 const p2=x.app.peSalvarSaida070(1,'2026-11-30');for(let i=0;i<10&&x.pendentes.length<2;i++)await Promise.resolve();assert.deepEqual(x.calls[1].a,x.calls[0].a);assert.equal(x.calls[0].n,'rota_070_saida_salvar');assert.equal(x.calls[0].a.p_data,'2026-11-30');
 x.pendentes[1]({data:{status:'ok',cd_pedido:1,data_saida_marcada:'2026-11-30'}});await p2;assert.equal(x.atualizacoes(),1);assert.equal(x.calls.length,2);assert.equal(Object.keys(x.app.pe.req070).length,0);
});
test('070 resposta antiga de sessão descartada antes dos caches/DOM, inclusive disponibilidade do calendário',async()=>{
 const x=saidaUI(),p=x.app.peSalvarSaida070(1,'2026-11-30');await x.esperar();x.ctx.sb={};x.app.pe.seq++;x.app.pe.salvando070={};x.app.pe.erros070={};x.pendentes[0]({error:{message:'erro sessão antiga'}});await p;
 assert.deepEqual(Object.keys(x.app.pe.erros070),[]);assert.equal(x.atualizacoes(),0);
 const y=saidaUI(),c=y.app.peOpcoesSaida070(1).calendario.carregarMes('2026-12-01');await y.esperar();y.ctx.sb={};y.app.pe.seq++;y.app.pe.cal070={};y.pendentes[0]({data:{status:'ok',cd_pedido:1,de:'2026-12-01',ate:'2026-12-31',veiculo_id:'s10',dias:[]}});await assert.rejects(c,/Sessão/);assert.deepEqual(Object.keys(y.app.pe.cal070),[]);
});
test('070 mutação pendente atravessando00h relê e descarta erro do dia anterior; origem Histórico não chamaRPC',async()=>{
 const x=saidaUI(),p=x.app.peSalvarSaida070(1,'2026-11-30');await x.esperar();x.virar();x.pendentes[0]({error:{message:'erro de ontem'}});await p;assert.equal(x.atualizacoes(),1);assert.equal(x.app.pe.erros070[1],'');
 const y=saidaUI();y.app.pe.estadosH[1]=estado(1,'historico');await y.app.peSalvarSaida070(1,'2026-11-30');assert.equal(y.calls.length,0);
});
test('070 mesclar filtro não colide com ordem dos ocultos nem altera o registro original',()=>{
 const original=[{cd_pedido:2,dia:'2026-11-27',veiculo_id:'s10',ordem:1}],enviar=[{cd_pedido:1,dia:'2026-11-27',veiculo_id:'s10',ordem:1}];
 const r=U.mesclarItensOcultos(enviar,original,{1:estado(1),2:estado(2,'aberto')},'2026-11-26',[]);assert.equal(r.find(i=>i.cd_pedido===2).ordem,1);assert.equal(r.find(i=>i.cd_pedido===1).ordem,2);assert.equal(enviar[0].ordem,1);
});

test('070 remover marca usa endpoint atômico e não inclui p_data nem escrita065 paralela',async()=>{
 const x=saidaUI();x.app.pe.estadosH[1].data_saida_marcada='2026-11-30';const p=x.app.peSalvarSaida070(1,null);await x.esperar();assert.equal(x.calls[0].n,'rota_070_saida_remover');assert.ok(!Object.hasOwn(x.calls[0].a,'p_data'));assert.equal(x.app.pe.estadosH[1].data_saida_marcada,'2026-11-30');
 x.pendentes[0]({data:{status:'ok',cd_pedido:1,data_saida_marcada:null}});await p;assert.equal(x.atualizacoes(),1);assert.equal(x.calls.length,1);
 const y=saidaUI();y.ctx.papel='vendedor';y.app.pe.podeMarcar=false;await y.app.peSalvarSaida070(1,null);assert.equal(y.calls.length,0);
});
test('070 calendário só habilita disponibilidade consultada; 42501 não vira mês livre',async()=>{
 const x=saidaUI();assert.match(x.app.peOpcoesSaida070(1).calendario.indisponivel('2026-12-09'),/Consulte/);
 const p=x.app.peOpcoesSaida070(1).calendario.carregarMes('2026-12-01');await x.esperar();x.pendentes[0]({error:{code:'42501',message:'Sem permissão'}});await assert.rejects(p,/permissão/);assert.deepEqual(Object.keys(x.app.pe.cal070),[]);
 await assert.rejects(U.lerDefinitiva({rpc:async()=>({data:{status:'ok',dia:'2026-11-27',reservas_070:{}}})},'2026-11-27'),/incompleta/);
});
test('070 confirmação erro+retry reaproveita UUID e payload; versão070 preservada antes do ok',async()=>{
 const x=rotaUI();x.s.modo070='definitiva';x.s.definitiva070['2026-11-27']={cabecalho:{versao:5},foto:null};const calls=[];
 x.s.sb={rpc:async(n,p)=>{calls.push({n,p});return {error:{code:'57014',message:'Timeout'}};}};
 await x.a.confirmarDefinitiva070();await x.a.confirmarDefinitiva070();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(x.s.definitiva070['2026-11-27'].cabecalho.versao,5);
});
test('070 fechar rota real usa definitiva mesmo com previsão selecionada e não inclui aberto do plano',async()=>{
 const x=rotaUI();x.s.modo070='previsao';x.s.fx050=true;x.s.pedidos[0].dt_pedido='2026-11-20T10:00:00-03:00';let itens;
 x.s.sb={rpc:async(n,p)=>{assert.equal(n,'rota_050_fechar');itens=p.p_itens;return {data:{status:'ok'}};}};
 x.a.fecharRotaDia();for(let i=0;i<10;i++)await Promise.resolve();assert.ok(x.calls.some(c=>c.n==='planejar'&&c.opts.modo_planejamento==='definitiva'));
 assert.equal(itens.length,1);assert.equal(itens[0].cd_pedido,1);assert.equal(x.s.modo070,'previsao');
});

test('070 confirmar amanhã inclui todosveículos mesmo com filtroS10 e preserva versão da reserva',async()=>{
 const x=rotaUI();x.s.modo070='definitiva';x.s.semFiltroVeic='s10';x.s.frotaLinhas.push({id:'caminhao',nome:'CEASA',modo:'cd_ceasa',ativo:true,capacidade_volume:null,dias_sem_saida:[0]});x.s.frota=R.frotaDe(x.s.frotaLinhas);
 x.leitura.pedidos_estado[2]=estado(2);x.leitura.itens[1].veiculo_id='caminhao';x.s.porPedido[2]='caminhao';x.ler();x.s.definitiva070['2026-11-27']={cabecalho:{versao:7},foto:null};
 let payload;x.s.sb={rpc:async(n,p)=>{assert.equal(n,'rota_070_definitiva_salvar');payload=p;return {error:{message:'fixture mantém payload'}};}};
 await x.a.confirmarDefinitiva070();assert.deepEqual(Array.from(payload.p_itens,i=>i.cd_pedido).sort(),[1,2]);assert.deepEqual(Array.from(payload.p_itens,i=>i.veiculo_id).sort(),['caminhao','s10']);assert.equal(payload.p_versao_base,7);
});
test('070 loader real atravessando00h descarta pacote completo e relê estado/reserva do dia27',async()=>{
 let agora='2026-11-26T23:59:59-03:00',resolver,leituras=0;
 class Clock extends Date{constructor(...a){super(...(a.length?a:[agora]));}static now(){return Date.parse(agora);}}
 const w={TempRioRotaCore:R,TempRioPrevisao:U,TempRioCalendario:require('../../js/admin-calendario.js')},ctx={window:w,Date:Clock,Intl,Promise,console,setTimeout,clearTimeout,setInterval,clearInterval};
 const src=fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8');vm.runInNewContext(src.replace('    raiz.TempRioRota = {','    raiz.qa={st,carregar,montarDadosQuadro065};desenhar=function(){};\n    raiz.TempRioRota = {'),ctx);const a=w.qa,s=a.st;
 const p={cd_pedido:1,etapa:'atendido',dt_pedido:'2026-11-25T12:00:00-03:00',dt_saida:'2026-11-26T18:00:00-03:00',documento:null,caixas_24:1};
 const T={solidcon_pedidos_erp:[p],rota_config:[{id:1}],rota_veiculos:[{id:'s10',nome:'S10',modo:'porta',ativo:true,dias_sem_saida:[0,6]}]};
 function leitura(dia){return {data:{status:'ok',inicio:'2026-11-23',hoje:dia,versao:0,itens:[],sem_saida:[],fechados:[],pedidos_estado:{1:dia==='2026-11-26'?estado(1):estado(1,'recebido')}}};}
 function query(t){const q={select(){return q;},order(){return q;},in(){return q;},gte(){return q;},eq(){return q;},is(){return q;},limit(){return q;},range(){return q;},then(ok,bad){return Promise.resolve({data:T[t]||[]}).then(ok,bad);}};return q;}
 const sb={from:query,rpc(n,p){
  if(n==='pode_marcar_rota')return Promise.resolve({data:true});
  if(n==='rota_065_ler_semana'){leituras++;if(leituras===1)return new Promise(r=>resolver=r);return Promise.resolve(leitura('2026-11-27'));}
  if(n==='rota_068ag_agendados_ler')return Promise.resolve({data:p.p_cds.map(cd=>({cd_pedido:cd,agendado:false,data_agendada:null,data_ancora:null,movido_manualmente:false,na_bandeja:false,dia_plano:null}))});
  if(n==='rota_050_ler')return Promise.resolve({data:null});
  if(n==='rota_070_definitiva_ler')return Promise.resolve({data:{status:'ok',dia:p.p_dia,cabecalho:null,foto:null,reservas_070:agora.includes('27T')&&p.p_dia==='2026-11-27'?{'2026-11-27':{dia:'2026-11-27',origem:'virada',versao:1,itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1,ativo:true,pronto_ao_reservar:true}]}}:{}}});
  return query('rpc_vazia');
 }};
 Object.assign(s,{sb,papel:'admin',ativo:true,semanaIni:'2026-11-23'});a.carregar();for(let i=0;i<100&&!resolver;i++)await new Promise(r=>setTimeout(r,1));assert.ok(resolver);
 agora='2026-11-27T00:00:01-03:00';resolver(leitura('2026-11-26'));for(let i=0;i<100&&(!s.carregado||s.carregando);i++)await new Promise(r=>setTimeout(r,1));
 for(let i=0;i<100&&!s.agendados;i++)await new Promise(r=>setTimeout(r,1));assert.equal(s.erro,null);assert.equal(s.estadosDia,'2026-11-27');assert.equal(leituras,2);assert.equal(s.estadosH[1].pronto_despacho,false);assert.equal(s.sem065Dados['2026-11-23'].hoje,'2026-11-27');assert.ok(s.reservas070['2026-11-27']);
 s.modo070='definitiva';const q=a.montarDadosQuadro065('2026-11-23');assert.equal(q.bandeja.length,0);assert.equal(q.dias.find(d=>d.dia==='2026-11-27').cartoes[0].cd_pedido,1);
});

test('070 reserva manual exata distingue seleção de plano alterada sem ampliar a rota confirmada',()=>{
 const x=rotaUI();x.s.modo070='definitiva';x.leitura.pedidos_estado[2]=estado(2);x.ler();
 x.s.reservas070={'2026-11-27':{dia:'2026-11-27',origem:'manual',versao:1,itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1,pronto_ao_reservar:true,ativo:true}]}};
 x.s.definitiva070['2026-11-27']={dia:'2026-11-27',cabecalho:{dia:'2026-11-27',origem:'manual',versao:1},foto:null};
 assert.deepEqual(R.itensDaRota(R.planejar(x.s.pedidos,x.s.clientes,'2026-11-27',x.a.optsPlano())).map(i=>i.cd_pedido),[1]);
 const h=x.a.htmlDefinitiva070('2026-11-23');assert.match(h,/data-rota-070-pendente/);assert.match(h,/reserva atual tem 1 pedido; a seleção abaixo tem 2/);assert.match(h,/Confirme novamente/);
 x.s.reservas070['2026-11-27'].itens.push({cd_pedido:2,veiculo_id:'s10',ordem:2,ativo:true,pronto_ao_reservar:true});assert.doesNotMatch(x.a.htmlDefinitiva070('2026-11-23'),/data-rota-070-pendente/);
 x.s.reservas070['2026-11-27'].itens.forEach(i=>i.ordem=null);assert.doesNotMatch(x.a.htmlDefinitiva070('2026-11-23'),/data-rota-070-pendente/,'ordem automática equivalente não cria aviso falso');
});
