'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fixture=require.resolve('./rota-fechada-whatsapp.test.js');
const source=fs.readFileSync(fixture,'utf8');
// Reutiliza SOMENTE a fixture anterior, sem registrar/executar seus testes.
const {banco}=vm.runInNewContext(source.slice(0,source.indexOf('const SEG_0830'))+';({banco})',{require:createRequire(fixture)});
const W=require('../functions/_shared/whatsapp-core.js');
const hoje='2026-11-23',agora=new Date('2026-11-23T12:00:00Z');
function base(){
 const b=banco({linha:{data:hoje,estado:'fechada',revisao:4,versao:1},itens:[{cd_pedido:8000,veiculo_id:'s10',ordem:1,origem:'previsao'},{cd_pedido:8005,veiculo_id:'caminhao',ordem:7,origem:'previsao'}]});
 b.T.solidcon_pedidos_erp[1].etapa='separando';
 return b;
}
test('tique inclui separando depois de fechada com revisao e ordem so do veiculo afetado; retry nao repete',async()=>{
 const b=base(),original=b.sb.rpc.bind(b.sb);let called=0;
 b.sb.rpc=(name,args)=>{
  if(name!=='rota_054_incluir')return original(name,args);
  called++;assert.equal(args.p_revisao,4);assert.equal(args.p_data,hoje);
  assert.deepEqual(Array.from(args.p_ordem,x=>x.cd_pedido).sort(),[8000,8001]);assert.ok(args.p_ordem.every(x=>x.veiculo_id==='s10'));
  b.T.rota_dia_item.push({cd_pedido:8001,veiculo_id:'s10',ordem:2,origem:'separando'});b.T.rota_dia_fechada[0].revisao=5;
  return Promise.resolve({data:{incluidos:1}});
 };
 assert.equal((await W.fecharRotaAuto(b.sb,agora)).incluidos,1);await W.fecharRotaAuto(b.sb,agora);assert.equal(called,1);
 assert.equal(b.T.rota_dia_item.find(x=>x.veiculo_id==='caminhao').ordem,7);
});
test('mensagem fechada nao usa proposta separando antes da confirmacao do servidor',async()=>{
 const b=base();assert.equal((await W.gerar(b.sb,'rota_s10',agora,{})).resumo.paradas,1);
 b.T.rota_dia_item.push({cd_pedido:8001,veiculo_id:'s10',ordem:2,origem:'separando'});
 assert.equal((await W.gerar(b.sb,'rota_s10',agora,{})).resumo.paradas,2);
});
test('conflito com ajuste causa nova coleta/revisao; nunca reutiliza ordem antiga',async()=>{
 const b=base(),original=b.sb.rpc.bind(b.sb);const rev=[];
 b.sb.rpc=(name,args)=>{if(name!=='rota_054_incluir')return original(name,args);rev.push(args.p_revisao);if(rev.length===1){b.T.rota_dia_fechada[0].revisao=5;return Promise.resolve({error:{code:'40001',message:'mudou'}});}return Promise.resolve({data:{incluidos:1}});};
 assert.equal((await W.fecharRotaAuto(b.sb,agora)).incluidos,1);assert.deepEqual(rev,[4,5]);
});
test('erro da054 propaga; dia reaberto nao recebe inclusao automatica',async()=>{
 const b=base(),original=b.sb.rpc.bind(b.sb);b.sb.rpc=(name,args)=>name==='rota_054_incluir'?Promise.resolve({error:{code:'42501',message:'negado'}}):original(name,args);
 await assert.rejects(W.fecharRotaAuto(b.sb,agora),e=>e.code==='42501');
 b.T.rota_dia_fechada[0].estado='reaberta';assert.equal((await W.fecharRotaAuto(b.sb,agora)).motivo,'reaberta');
});
