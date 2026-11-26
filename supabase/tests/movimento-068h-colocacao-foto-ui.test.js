'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js'),Cal=require('../../js/admin-calendario.js');
const w={TempRioRotaCore:R,TempRioCalendario:Cal};
vm.runInNewContext(fs.readFileSync(require.resolve('../../js/admin-rota-quadro.js'),'utf8'),w);const Q=w.TempRioRotaQuadro;
function app({inicio='2026-11-23',destino='2026-11-27',veiculo='s10',reprogramado=true,entregue=false,pendente=!entregue,removido=false,versao=3}={}){
 class Clock extends Date{constructor(...a){super(...(a.length?a:['2026-11-26T15:00:00Z']));}}
 const ctx={window:{TempRioRotaCore:R,TempRioRotaQuadro:Q},Intl,Date:Clock,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console};
 const src=fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8');
 vm.runInNewContext(src.replace('    raiz.TempRioRota = {','    raiz.qa={st,aplicarLeituraSemana065,montarDadosQuadro065};desenhar=function(){};\n    raiz.TempRioRota = {'),ctx);
 const a=ctx.window.qa,s=a.st,frota=[{id:'s10',nome:'S10',modo:'porta',ativo:true,capacidade_volume:2700,dias_sem_saida:[0,6]},{id:'caminhao',nome:'CEASA',modo:'cd_ceasa',ativo:true,dias_sem_saida:[0]}];
 const pedido={cd_pedido:1,documento:'11222333000181',etapa:'atendido',dt_pedido:'2026-11-25T09:00:00-03:00',dt_saida:'2026-11-26T09:00:00-03:00',cliente_nome:'Pedido reprogramado',caixas_24:1};
 Object.assign(s,{ativo:true,vista:'semana',v2:true,podeMarcar:true,pln046:true,papel:'admin',frota047:true,frotaLinhas:frota,frota:R.frotaDe(frota),cfg:R.cfgDe({}),cfgLinha:{},pedidos:[pedido],clientes:{[pedido.documento]:{nome:'Cliente QA',bairro:'Centro',cidade:'Rio de Janeiro',pos:R.ROTA.ORIGEM}},sem065:true,porPedido:{1:'s10'},confirmacoes:{1:{cd_pedido:1,id:1,confirmado_em:'2026-11-26T09:00:00-03:00',reprogramado}},diasSaida:{1:'2026-11-26'},fx050:true,fxFoto:{data:'2026-11-26',estado:'fechada',itens:[{cd_pedido:1,veiculo_id:'s10',ordem:1}]}});
 const foto=JSON.stringify(s.fxFoto),itens=destino?[{cd_pedido:1,dia:destino,veiculo_id:veiculo,ordem:2,removido}]:[];
 a.aplicarLeituraSemana065(inicio,{data:{status:'ok',inicio,hoje:'2026-11-26',versao,itens,sem_saida:[],fechados:[],pedidos_estado:{1:{entregue,pendente,reprogramado}}}});
 function construir(){return Q.normalizarEstado(a.montarDadosQuadro065(inicio));}
 function posicoes(q){const out=[];for(const d of q.dias)for(const c of d.cartoes)out.push({cd:c.cd_pedido,dia:d.dia,veiculo:c.veiculo});for(const c of q.bandeja)out.push({cd:c.cd_pedido,dia:null,veiculo:c.veiculo});return out;}
 return {a,s,foto,construir,posicoes};
}
for(const [inicio,destino] of [['2026-11-23','2026-11-27'],['2026-12-07','2026-12-09']]){
 test('UIH-R2 plano ativo vence foto antiga: '+inicio+' → '+destino,()=>{
  const a=app({inicio,destino}),q=a.construir();
  assert.deepEqual(a.posicoes(q),[{cd:1,dia:destino,veiculo:'s10'}]);assert.equal(JSON.stringify(a.s.fxFoto),a.foto,'foto histórica preservada integralmente');
  assert.equal(q.dias.flatMap(d=>d.cartoes).find(c=>c.cd_pedido===1).bloqueado,false);
 });
}
test('UIH-R2 troca A reprogramada mostra veículo do plano ativo, sem restaurar veículo da foto',()=>{
 const a=app({veiculo:'caminhao'});assert.deepEqual(a.posicoes(a.construir()),[{cd:1,dia:'2026-11-27',veiculo:'caminhao'}]);assert.equal(JSON.stringify(a.s.fxFoto),a.foto);
});
test('UIH-R2 retirada explícita sem linha de plano permanece na bandeja, inclusive semana sem versão salva',()=>{
 const a=app({destino:null,versao:0});const q=a.construir();assert.deepEqual(a.posicoes(q),[{cd:1,dia:null,veiculo:'s10'}]);assert.equal(JSON.stringify(a.s.fxFoto),a.foto);
});
test('UIH-R2 linha removida reprogramada tem precedência sobre foto e aparece uma vez na bandeja',()=>{
 const a=app({destino:'2026-11-26',removido:true});assert.deepEqual(a.posicoes(a.construir()),[{cd:1,dia:null,veiculo:'s10'}]);assert.equal(JSON.stringify(a.s.fxFoto),a.foto);
});
test('Compatibilidade: sem reprogramação ativa a foto fechada continua projetada na origem',()=>{
 const a=app({reprogramado:false});assert.deepEqual(a.posicoes(a.construir()),[{cd:1,dia:'2026-11-26',veiculo:'s10'}]);assert.equal(JSON.stringify(a.s.fxFoto),a.foto);
});
test('Histórico entregue permanece fora de pendentes, com foto preservada',()=>{
 const a=app({reprogramado:false,entregue:true});assert.deepEqual(a.posicoes(a.construir()),[]);assert.equal(JSON.stringify(a.s.fxFoto),a.foto);
});
test('Foto mista: reprogramado vai ao plano ativo, outro pedido permanece na foto, sem duplicação',()=>{
 const a=app();a.s.pedidos.push({...a.s.pedidos[0],cd_pedido:2,cliente_nome:'Sem reprogramação'});a.s.estadosH[2]={entregue:false,pendente:true,reprogramado:false};a.s.fxFoto.itens.push({cd_pedido:2,veiculo_id:'s10',ordem:2});
 const antes=JSON.stringify(a.s.fxFoto);assert.deepEqual(a.posicoes(a.construir()).sort((x,y)=>x.cd-y.cd),[{cd:1,dia:'2026-11-27',veiculo:'s10'},{cd:2,dia:'2026-11-26',veiculo:'s10'}]);assert.equal(JSON.stringify(a.s.fxFoto),antes);
});
