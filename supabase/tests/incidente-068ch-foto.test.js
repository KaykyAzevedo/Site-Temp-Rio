'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const R=require('../functions/_shared/rota-core.js');
const FORJA='C:/Users/emporio/Downloads/TempRio-trabalho/forja';
const PKG=path.join(FORJA,'pacote_068CH_r3_legado_pendencia_20261126');
const raw=fs.readFileSync(path.join(PKG,'evidencias_foto/entradas/foto_producao.json'));
assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'163f65801105543ed0f26a13afd1a4c94c0a8e6bccd7f4576d3f3fe6e8c278f6');
const f=JSON.parse(raw).rows[0].foto;
const estados=JSON.parse(fs.readFileSync(path.join(PKG,'evidencias_foto/estados_corrigidos_196.json')));
const antigo=JSON.parse(fs.readFileSync(path.join(PKG,'evidencias_foto/estados_H_3122f90.json')));
const base=JSON.parse(fs.readFileSync(path.join(PKG,'evidencias_foto/pendentes_baseline_SQL.json')));
const mapa=Object.fromEntries(estados.map(e=>[e.cd_pedido,e]));
const cfg=R.cfgDe(f.config[0]);
test('incidente foto real196/179: core com mapaSQL preserva conjunto17 do055 baseline',()=>{
 assert.equal(f.pedidos.length,196);assert.equal(f.pedidos.filter(p=>['saiu','atendido'].includes(p.etapa)).length,179);
 const ids=f.pedidos.filter(p=>R.pendenteEntrega(p,{},f.dia_sp,cfg,{pedidos_estado:mapa})).map(p=>p.cd_pedido).sort((a,b)=>a-b);
 assert.deepEqual(ids,base.filter(e=>e.pendente).map(e=>e.cd_pedido).sort((a,b)=>a-b));assert.equal(ids.length,17);
});
test('incidente flagsPG: legado1365-1379 excluido, prova antiga noH anterior falhava',()=>{
 for(let cd=1365;cd<=1379;cd++)if(mapa[cd]){
  assert.equal(mapa[cd].entregue,true);assert.equal(mapa[cd].pendente,false);
  assert.equal(antigo.find(e=>e.cd_pedido===cd).entregue,false);
 }
});
test('incidente RecebidosHOJE foto real: falsefalse nao volta a bandeja',()=>{
 const hoje=estados.filter(e=>!e.entregue&&!e.pendente);
 assert.deepEqual(hoje.map(e=>e.cd_pedido),[1548,1549,1550,1557,1558]);
 for(const e of hoje){assert.equal(e.data_recebimento,f.dia_sp);assert.equal(R.pendenteEntrega(f.pedidos.find(p=>p.cd_pedido===e.cd_pedido),{},f.dia_sp,cfg,{pedidos_estado:mapa}),false);}
});
test('incidente mapa canonico tem prioridade sobre reprogramacao local velha',()=>{
 const p=f.pedidos.find(p=>p.cd_pedido===1365);
 assert.equal(R.pendenteEntrega(p,{},f.dia_sp,cfg,{pedidos_estado:mapa,reprogramados:{1365:true},confirmacoes:{1365:{reprogramado:true}}}),false);
});
test('incidente mapa ausente permite consumidor legado, mapa parcial/incoerente falha',()=>{
 const p=f.pedidos.find(p=>p.cd_pedido===1365);
 assert.equal(R.pendenteEntrega(p,{},f.dia_sp,cfg,{}),false);
 for(const m of [{},{1365:{entregue:false}},{1365:{pendente:true}},{1365:{entregue:true,pendente:true}},{1365:{entregue:false,pendente:'true'}}]){
  assert.throws(()=>R.pendenteEntrega(p,{},f.dia_sp,cfg,{pedidos_estado:m}),/Estado canonico/);
 }
});
test('incidente novo pendente real antigo aberto nao e classificado pela data do pedido',()=>{
 const p={cd_pedido:999901,etapa:'aberto',dt_pedido:'2026-10-01T00:00:00-03:00'};
 assert.equal(R.pendenteEntrega(p,{},f.dia_sp,cfg,{pedidos_estado:{999901:{entregue:false,pendente:true}}}),true);
 assert.equal(R.pendenteEntrega(p,{},f.dia_sp,cfg,{}),true);
});
