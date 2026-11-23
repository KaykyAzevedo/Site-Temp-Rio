'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js');
const DIA='2026-11-23';
const frota=[
 {id:'s10',nome:'S10',modo:'porta',capacidade_volume:9,dias_sem_saida:[0,6],ativo:true,ordem:1},
 {id:'strada',nome:'Strada',modo:'porta',capacidade_volume:null,dias_sem_saida:[0],ativo:true,ordem:2},
 {id:'caminhao',nome:'CD',modo:'cd_ceasa',capacidade_volume:null,dias_sem_saida:[0],ativo:true,ordem:3}
];
function dados(){
 const pedidos=[1,2,3].map(n=>({cd_pedido:n,documento:String(12000000000000+n),etapa:n===3?'separando':'conferido',dt_pedido:'2026-11-23T09:00:00-03:00',caixas_24:2,caixas_48:0,caixas_outras:0}));
 const clientes={};pedidos.forEach((p,n)=>{clientes[p.documento]={nome:'Cliente '+p.cd_pedido,pos:[R.ROTA.ORIGEM[0]+.01*(n+1),R.ROTA.ORIGEM[1]+.01],bairro:'B',cidade:'Rio'};});
 const opts={marcacao:true,veiculos:frota,padroes:{},porPedido:{1:'s10',2:'strada'},cfg:{feriados_sem_saida:true},regras:{},ignorados:{}};
 return {pedidos,clientes,opts};
}
function fechada(d){d.opts.fechada={data:DIA,revisao:4,itens:[{cd_pedido:1,documento:d.pedidos[0].documento,veiculo_id:'s10',ordem:1,origem:'previsao'},{cd_pedido:2,documento:d.pedidos[1].documento,veiculo_id:'strada',ordem:9,origem:'previsao'}]};return d;}
function plano(d,dia=DIA){return R.planejar(d.pedidos,d.clientes,dia,d.opts);}
test('separando aberto entra sem marcacao na S10 mesmo acima da capacidade; outros continuam falta marcar',()=>{
 const d=dados();const pl=plano(d);assert.equal(R.ROTA.VEICULO_SEPARANDO,'s10');assert.ok(pl.entregues[3]);assert.equal(pl.veiculos.s10.pedidos.find(x=>x.p.cd_pedido===3).entrouAoSeparar,true);
 d.pedidos[2].etapa='aberto';assert.ok(!plano(d).entregues[3]);assert.ok(plano(d).aguardando.some(x=>x.p.cd_pedido===3));
});
test('separando prioridade pedido > padrao cliente > S10 fixa, sem regra CEASA automatica',()=>{
 const d=dados(),p=d.pedidos[2];d.clientes[p.documento].logradouro='CEASA';
 assert.ok(plano(d).veiculos.s10.pedidos.some(x=>x.p.cd_pedido===3));
 d.opts.padroes[p.documento]='caminhao';assert.ok(plano(d).veiculos.caminhao.pedidos.some(x=>x.p.cd_pedido===3));
 d.opts.porPedido[3]='strada';assert.ok(plano(d).veiculos.strada.pedidos.some(x=>x.p.cd_pedido===3));
});
test('separando fechado entra e so o veiculo afetado recalcula, proposta cobre todos os itens dele',()=>{
 const d=fechada(dados()),pl=plano(d);assert.ok(pl.entregues[3]);assert.equal(pl.veiculos.strada.ordemFixa,true);assert.equal(pl.veiculos.s10.ordemFixa,false);
 const prop=R.propostaSeparando(d.pedidos,d.clientes,DIA,d.opts);assert.deepEqual(prop.adicoes,[{cd_pedido:3,veiculo_id:'s10'}]);assert.deepEqual(prop.veiculos,['s10']);assert.deepEqual(prop.ordem.map(x=>x.cd_pedido).sort(),[1,3]);
 d.opts.fechada.itens.push({cd_pedido:3,veiculo_id:'s10',ordem:2,origem:'separando'});assert.equal(R.propostaSeparando(d.pedidos,d.clientes,DIA,d.opts).adicoes.length,0);
 d.pedidos[2].etapa='conferido';assert.equal(plano(d).veiculos.s10.pedidos.find(x=>x.p.cd_pedido===3).entrouAoSeparar,true);
});
test('045 e Remover de hoje vencem separando, inclusive pedido novo do cliente removido',()=>{
 const d=fechada(dados());d.opts.ignorados[3]=true;assert.ok(!plano(d).entregues[3]);assert.equal(plano(d).ignorados.length,1);
 d.opts.ignorados={};d.opts.fechada.itens.push({cd_pedido:3,veiculo_id:'s10',ordem:null,removido_em:'hoje'});assert.ok(!plano(d).entregues[3]);
 d.opts.fechada.itens=d.opts.fechada.itens.filter(x=>x.cd_pedido!==3);d.opts.fechada.itens[0].removido_em='hoje';d.pedidos[2].documento=d.pedidos[0].documento;
 assert.ok(!plano(d).entregues[3]);assert.equal(R.propostaSeparando(d.pedidos,d.clientes,DIA,d.opts).adicoes.length,0);
});
test('cliente nao recebe: separando entra com alerta, sem deslocar para outro dia',()=>{
 for(const f of [false,true]){const d=dados();if(f)fechada(d);d.opts.regras[d.pedidos[2].documento]={dias_sem_receber:[1]};const x=plano(d).veiculos.s10.pedidos.find(x=>x.p.cd_pedido===3);assert.ok(x);assert.equal(x.diaSemReceber,true);}
});
test('sem saida do veiculo ou feriado adia separando para proxima saida; domingo nao entra',()=>{
 const d=dados();let pl=plano(d,'2026-11-28');assert.ok(!pl.entregues[3]);assert.equal(pl.fica.find(x=>x.p.cd_pedido===3).proxima,'2026-11-30');
 assert.ok(!plano(d,'2026-11-29').entregues[3]);d.opts.cfg.feriados_extras=[DIA];assert.ok(!plano(d).entregues[3]);
 d.opts.fechada={data:'2026-11-28',itens:[]};assert.equal(R.propostaSeparando(d.pedidos,d.clientes,'2026-11-28',d.opts).adicoes.length,0);
});
test('veiculo inativo nao e usado nem substituido silenciosamente por outro',()=>{
 const d=dados();d.opts.veiculos=frota.map(v=>v.id==='s10'?{...v,ativo:false}:v);assert.ok(!plano(d).entregues[3]);assert.ok(plano(d).aguardando.find(x=>x.p.cd_pedido===3).veiculoInativo);
});
test('proposta mantem itens historicos/045 fora do calculo ao fim da ordem do veiculo afetado',()=>{
 const d=fechada(dados());d.opts.ignorados[1]=true;const prop=R.propostaSeparando(d.pedidos,d.clientes,DIA,d.opts);
 assert.deepEqual(prop.ordem.map(x=>x.cd_pedido),[3,1]);assert.ok(prop.ordem.every(x=>x.veiculo_id==='s10'));
});
