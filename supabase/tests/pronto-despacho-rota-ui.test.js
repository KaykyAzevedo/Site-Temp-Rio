'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js');
test('059 carga real do painel Rotas preserva publicação047 e usa dia fechado no limite7',async()=>{
 const src=fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8');
 const sandbox={window:{TempRioRotaCore:R},Intl,Date,Promise,setTimeout,clearTimeout,setInterval,clearInterval,console};
 // Instrumentação só da fixture: expõe estado/loader e suprime renderização/mapas.
 vm.runInNewContext(src.replace('    raiz.TempRioRota = {','    raiz.qaRota = { st:st, carregar:carregar, optsPlano:optsPlano }; desenhar=function(){};\n    raiz.TempRioRota = {'),sandbox);
 const {st,carregar,optsPlano}=sandbox.window.qaRota,dia=R.diaSP(new Date()),cd=91537;
 const T={solidcon_pedidos_erp:[{cd_pedido:cd,etapa:'atendido',dt_saida:'2026-11-01T17:23-03:00',dt_pedido:'2026-11-01T10:00-03:00'}],
  rota_059_saidas:[{cd_pedido:cd,dia_saida:dia}],rota_saida:[{data:dia,veiculo_id:'s10',versao:42,paradas:[],resumo:{}}],
  rota_veiculos:[{id:'s10',nome:'S10',modo:'porta',ativo:true,dias_sem_saida:[0],ordem:1}],rota_config:[{id:1,hora_saida:'08:00'}],rota_pedido_veiculo:[{cd_pedido:cd,veiculo:'s10'}]};
 st.ativo=true;st.papel='vendedor';
 st.sb={from(t){const q={select(){return q;},in(){return q;},order(){return q;},gte(){return q;},is(){return q;},eq(){return q;},limit(){return q;},range(){return q;},then(ok,er){return Promise.resolve({data:T[t]||[]}).then(ok,er);}};return q;},rpc(n){
  if(n==='pode_marcar_rota'||n==='rota_050_ler')return Promise.resolve({data:n==='pode_marcar_rota'?false:null});
  return this.from('fixture_rpc_vazia');
 }};
 carregar();
 for(let i=0;st.carregando&&i<50;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(st.erro,null);assert.equal(st.carregado,true);
 assert.equal(st.saidas[dia+'|s10'].versao,42,'047 publicaçao preservada');
 assert.equal(st.diasSaida[cd],dia,'059 mapa de datas independente');
 const opts=optsPlano();assert.equal(opts.saidas[cd],dia);
 assert.equal(R.pendenteEntrega(T.solidcon_pedidos_erp[0],{},dia,opts.cfg,opts),true,'nao descarta faturamento antigo com despacho salvo hoje');
 sandbox.window.TempRioRota.sair();assert.equal(Object.keys(st.diasSaida).length,0);assert.equal(Object.keys(st.saidas).length,0);
});
