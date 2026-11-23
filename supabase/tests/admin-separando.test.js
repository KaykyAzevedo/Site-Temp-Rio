'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js');
function app(){
 const window={TempRioRotaCore:R};
 const src=fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8').replace('raiz.TempRioRota = {','raiz.__sep={st,sincronizarSeparando,selosSeparando,optsPlano};raiz.TempRioRota = {');
 class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-23T12:00:00Z']));}}
 vm.runInNewContext(src,{window,Intl,Date:Clock,setTimeout,clearTimeout,console});
 const q=window.__sep,s=q.st;s.ativo=true;s.seq=1;s.papel='admin';s.v2=true;s.podeMarcar=true;s.fx050=true;s.fxRev=1;s.cfg=R.cfgDe({feriados_sem_saida:true});
 s.frota047=true;s.frotaLinhas=[{id:'s10',nome:'S10',ativo:true,modo:'porta',dias_sem_saida:[0,6],capacidade_volume:null}];
 s.pedidos=[{cd_pedido:1,documento:'12000000000001',etapa:'conferido',dt_pedido:'2026-11-23T06:00:00-03:00',caixas_24:1},{cd_pedido:3,documento:'12000000000003',etapa:'separando',dt_pedido:'2026-11-23T06:00:00-03:00',caixas_24:1}];
 s.clientes={};s.porPedido={1:'s10'};s.fxFoto={data:'2026-11-23',estado:'fechada',revisao:1,itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1,origem:'previsao'}]};
 return q;
}
function response(q){return {data:{incluidos:1,foto:{linha:{data:'2026-11-23',estado:'fechada',revisao:2},itens:q.st.fxFoto.itens.concat([{cd_pedido:3,veiculo_id:'s10',ordem:2,origem:'separando'}])}}};}
test('painel persiste proposta com revisao e usa a foto retornada, sem publicar',async()=>{
 const q=app();let calls=0;q.st.sb={rpc(name,args){calls++;assert.equal(name,'rota_054_incluir');assert.equal(args.p_revisao,1);assert.equal(args.p_ordem.length,2);return Promise.resolve(response(q));}};
 assert.equal(q.optsPlano().projetarSeparando,false);await q.sincronizarSeparando(q.st.sb);assert.equal(calls,1);assert.equal(q.st.fxRev,2);assert.equal(q.st.fxFoto.itens.length,2);
});
test('painel descarta resposta tardia de outra carga mesmo na mesma sessao',async()=>{
 const q=app();let resolve;q.st.sb={rpc(){return new Promise(r=>{resolve=r;});}};const promise=q.sincronizarSeparando(q.st.sb);const out=response(q);q.st.seq++;q.st.fxRev=10;await resolve(out);await promise;assert.equal(q.st.fxRev,10);
});
test('painel nao mascara erro da054 nem grava para leitor',async()=>{
 const q=app();q.st.sb={rpc(){return Promise.resolve({error:{code:'40001',message:'mudou'}});}};await assert.rejects(q.sincronizarSeparando(q.st.sb),e=>e.code==='40001');assert.equal(q.st.fxRev,1);
 q.st.podeMarcar=false;q.st.sb={rpc(){throw Error('nao deveria chamar');}};await q.sincronizarSeparando(q.st.sb);
 assert.match(q.selosSeparando([{entrouAoSeparar:true,diaSemReceber:true}]),/entrou ao separar/);assert.match(q.selosSeparando([{entrouAoSeparar:true,diaSemReceber:true}]),/conferir/);
});
