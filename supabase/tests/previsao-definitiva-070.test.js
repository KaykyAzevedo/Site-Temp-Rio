'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const R=require('../functions/_shared/rota-core.js'),W=require('../functions/_shared/whatsapp-core.js');
const dir=path.join(__dirname,'fixtures/070'),read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
let F=read('foto_070_producao.json').rows[0].foto;if(typeof F==='string')F=JSON.parse(F);
const antes=read('estados-base575-196.json'),depois=read('estados-candidato070-196.json'),pos=read('estados-candidato070-pos00-196.json');
const map=rows=>Object.fromEntries(rows.map(x=>[x.cd_pedido,x])),states=map(depois.estados),posstates=map(pos.estados);
const ps=F.pedidos.map(p=>({...p,documento:null,cliente_nome:null}));
const opts={cfg:R.cfgDe(F.config[0]),pedidos_estado:states,hoje:'2026-11-26',veiculos:F.veiculos,marcacao:true,porPedido:Object.fromEntries(ps.map(p=>[p.cd_pedido,'s10']))};
const ids=pl=>Object.keys(pl.entregues).map(Number).sort((a,b)=>a-b);
const p={cd_pedido:700001,etapa:'aberto',dt_pedido:'2026-11-25T10:00:00-03:00',documento:'10000000000001',cliente_tipo:'cnpj',caixas_24:1};
const clients={[p.documento]:{nome:'QA',pos:[-22.92,-43.25],bairro:'QA',cidade:'Rio de Janeiro'}};
const ready={entregue:false,pendente:true,pronto_despacho:true,estado_070:'pronto_despacho',data_saida_marcada:null};
const o={cfg:R.cfgDe({feriados_sem_saida:false}),marcacao:true,porPedido:{[p.cd_pedido]:'s10'},pedidos_estado:{[p.cd_pedido]:ready},modo_planejamento:'definitiva',hoje:'2026-11-26'};
test('070 fotoREAL hash unico196/183 e pendentes17 MESMOS IDs575',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'foto_070_producao.json'))).digest('hex'),'c8c88e541a472370f857def508fb317274fa0574d1851c773708f098d2ebe58f');
 assert.equal(ps.length,196);assert.equal(ps.filter(p=>p.etapa==='atendido').length,183);
 const pend=e=>e.filter(x=>x.pendente).map(x=>x.cd_pedido);assert.equal(pend(antes.estados).length,17);assert.deepEqual(pend(antes.estados),pend(depois.estados));
 assert.equal(depois.estados.filter(x=>x.entregue).length,174);
});
test('070 fotoREAL coluna Pronto usa4 canonicos e nao183 etapasERP',()=>{
 assert.deepEqual(ps.filter(p=>R.etapaEntrega(p,opts)==='pronto_despacho').map(p=>p.cd_pedido),[1547,1554,1556,1563]);
 for(const cd of [1365,1370,1379]){assert.equal(states[cd].entregue,true);assert.equal(R.etapaEntrega(ps.find(p=>p.cd_pedido===cd),opts),'recebido');}
});
test('070 fotoREAL previsao17 versus definitiva4 semlegados/RecebidosHoje',()=>{
 const forecast=R.planejar(ps,{},'2026-11-27',{...opts,modo_planejamento:'previsao'}),def=R.planejar(ps,{},'2026-11-27',{...opts,modo_planejamento:'definitiva'});
 assert.deepEqual([...ids(forecast),...forecast.fica.map(x=>x.p.cd_pedido),...forecast.aguardando.map(x=>x.p.cd_pedido)].sort((a,b)=>a-b),depois.estados.filter(e=>e.pendente).map(e=>e.cd_pedido));assert.equal(ids(forecast).length,12,'5 ficam por capacidade, preservando regra anterior');assert.deepEqual(ids(def),[1547,1554,1556,1563]);
});
test('070 pos00 fotoREAL13 pendentes e4 reservas Recebidos sem retornoautomatico',()=>{
 assert.equal(pos.estados.filter(e=>e.pendente).length,13);
 for(const cd of [1547,1554,1556,1563])assert.deepEqual([posstates[cd].entregue,posstates[cd].pendente,posstates[cd].data_recebimento,posstates[cd].historico_em],[false,false,'2026-11-27','2026-11-28']);
 assert.deepEqual(ids(R.planejar(ps,{},'2026-11-27',{...opts,hoje:'2026-11-27',pedidos_estado:posstates,reservas_070:pos.reservas_070,modo_planejamento:'definitiva'})),[1547,1554,1556,1563]);
});
test('070 flag pronta prevalece horario/ERP conferido semheuristica alternativa',()=>{
 assert.equal(R.etapaEntrega(p,{...o,agora:'2026-11-26T20:00-03:00'}),'pronto_despacho');
 assert.equal(R.etapaEntrega({...p,etapa:'conferido'},{...o,pedidos_estado:{[p.cd_pedido]:{...ready,pronto_despacho:false}}}),'conferido');
});
test('070 definitiva exige mapas completos e coerentes',()=>{
 assert.throws(()=>R.planejar([p],clients,'2026-11-27',{...o,pedidos_estado:{}}),/070/);
 assert.throws(()=>R.planejar([p],clients,'2026-11-27',{...o,pedidos_estado:{[p.cd_pedido]:{...ready,pendente:false}}}),/070/);
 assert.throws(()=>R.planejar([p],clients,'2026-11-27',{...o,modo_planejamento:'adivinhar'}),/070/);
});
test('070 data30 nao entra27 mas entra30 e domingo29 semsaida',()=>{
 const op={...o,pedidos_estado:{[p.cd_pedido]:{...ready,data_saida_marcada:'2026-11-30'}}};
 assert.deepEqual(ids(R.planejar([p],clients,'2026-11-27',op)),[]);assert.deepEqual(ids(R.planejar([p],clients,'2026-11-30',op)),[p.cd_pedido]);assert.deepEqual(ids(R.planejar([p],clients,'2026-11-29',op)),[]);
});
test('070 reserva manual conjuntoexato e cancelada nao habilita recebido',()=>{
 const received={...ready,pendente:false,pronto_despacho:false,estado_070:'recebido'},r={dia:'2026-11-27',origem:'manual',versao:1,itens:[{cd_pedido:p.cd_pedido,veiculo_id:'s10',ativo:true,pronto_ao_reservar:true}]};
 assert.deepEqual(ids(R.planejar([p],clients,'2026-11-27',{...o,pedidos_estado:{[p.cd_pedido]:received},reservas_070:{'2026-11-27':r}})),[p.cd_pedido]);
 assert.deepEqual(ids(R.planejar([p],clients,'2026-11-27',{...o,pedidos_estado:{[p.cd_pedido]:received},reservas_070:{'2026-11-27':{...r,itens:[{...r.itens[0],ativo:false}]}}})),[]);
 assert.deepEqual(ids(R.planejar([p],clients,'2026-11-27',{...o,reservas_070:{'2026-11-27':{...r,itens:[]}}})),[]);
});
test('070 foto050 persistida nao some ao irHistorico, previsao e definitiva',()=>{
 const fx={data:'2026-11-27',estado:'fechada',itens:[{cd_pedido:p.cd_pedido,veiculo_id:'s10',ordem:1}]},h={...ready,entregue:true,pendente:false,pronto_despacho:false,estado_070:'historico'};
 for(const modo of ['previsao','definitiva'])assert.deepEqual(ids(R.planejar([p],clients,'2026-11-27',{...o,modo_planejamento:modo,pedidos_estado:{[p.cd_pedido]:h},fechada:fx})),[p.cd_pedido]);
});
test('070 semana definitiva exclui aberto e preserva reserva/planejamento futuro',()=>{
 const a={...p,cd_pedido:700002},op={...o,pedidos_estado:{[p.cd_pedido]:{...ready,data_saida_marcada:'2026-11-30'},[a.cd_pedido]:{...ready,pronto_despacho:false}},porPedido:{[p.cd_pedido]:'s10',[a.cd_pedido]:'s10'}};
 const res=R.planejarSemana([p,a],clients,'2026-11-30',op);assert.equal(res.resumo.pedidos,1);assert.ok(JSON.stringify(res).includes(String(p.cd_pedido)));assert.ok(!JSON.stringify(res).includes(String(a.cd_pedido)));
});
test('070 coletor estados limita200, deduplica e recusa ausencia/malformado',async()=>{
 const ps=Array.from({length:401},(_,i)=>({cd_pedido:i+1})),calls=[];
 const sb={rpc(n,a){calls.push(a.p_cds.length);return Promise.resolve({data:a.p_cds.map(cd_pedido=>({cd_pedido,...ready}))});}};
 assert.equal(Object.keys(await R.coletarEstados070(sb,ps.concat(ps[0]))).length,401);assert.deepEqual(calls,[200,200,1]);
 await assert.rejects(R.coletarEstados070({rpc(){return Promise.resolve({error:{code:'42883'}});}},[p]),/070/);
 await assert.rejects(R.coletarEstados070({rpc(){return Promise.resolve({data:[]});}},[p]),/incompleto/);
});

function backend070(error070=false){
 const p2={...p,cd_pedido:700002};const tables={rota_veiculos:F.veiculos,solidcon_pedidos_erp:[p,p2],rota_config:[{id:1,hora_saida:'08:00',feriados_sem_saida:false,previsao_definitiva_070:true}],rota_pedido_veiculo:[{cd_pedido:p.cd_pedido,veiculo:'s10'},{cd_pedido:p2.cd_pedido,veiculo:'s10'}]};const calls=[];
 return {calls,from(t){let rows=(tables[t]||[]).slice();const q={select(){return q;},in(k,v){rows=rows.filter(x=>v.includes(x[k]));return q;},eq(k,v){rows=rows.filter(x=>x[k]===v);return q;},is(){return q;},order(){return q;},limit(){return q;},range(){return q;},then(ok,er){return Promise.resolve({data:rows}).then(ok,er);}};return q;},rpc(n,a){calls.push([n,a]);if(n==='rota_070_estados_pedidos')return Promise.resolve(error070?{error:{code:'42883',message:'ausente'}}:{data:a.p_cds.map(cd_pedido=>({cd_pedido,...ready,pronto_despacho:cd_pedido===p.cd_pedido}))});if(n==='rota_070_definitiva_ler')return Promise.resolve({data:{status:'ok',reservas_070:{},foto:null,cabecalho:null}});if(n==='rota_050_fechar_auto')return Promise.resolve({data:{fechou:true}});return Promise.resolve({data:n==='rota_050_ler'?{linha:null,itens:[]}:[]});}};
}
test('070 Edge coleta flags obrigatorias quando config ativa; falha nao regrideERP',async()=>{
 const b=backend070(),d=await W.coletarRota(b,new Date('2026-11-27T08:00:00-03:00'));
 assert.equal(d.ativa070,true);assert.equal(d.pedidos_estado[p.cd_pedido].pronto_despacho,true);assert.equal(d.pedidos_estado[700002].pronto_despacho,false);
 await assert.rejects(W.coletarRota(backend070(true),new Date('2026-11-27T08:00:00-03:00')),/Estado070/);
});
test('070 Edge08 fecha definitiva comPronto e nao previsao aberto',async()=>{
 const b=backend070();const res=await W.fecharRotaAuto(b,new Date('2026-11-27T08:00:00-03:00'));assert.equal(res.fechou,true,JSON.stringify(res));
 const close=b.calls.find(x=>x[0]==='rota_050_fechar_auto');assert.deepEqual(close[1].p_itens.map(x=>x.cd_pedido),[p.cd_pedido]);
});
