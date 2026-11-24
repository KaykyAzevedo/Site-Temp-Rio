'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../js/admin-compras.js');
const doc='11222333000181';
const cup=(n,dia='2026-11-23',valor=49500)=>({dia,cd_pdv:1,nr_cupom:n,tipo:'cnpj',documento:doc,valor_centavos:valor});
const ped=(n,extra={})=>({cd_pedido:n,documento:doc,cliente_tipo:'cnpj',cliente_nome:'Cliente NF',etapa:'atendido',valor_centavos:49500,dt_pedido:'2026-11-20T09:00:00-03:00',dt_saida:'2026-11-23T17:23:00-03:00',...extra});
test('1A pedido1530/cupom495 contam uma vez;1508 sem cupom somaNF',()=>{
 const r=C.juntar([cup(1530)],[ped(1530),ped(1508,{valor_centavos:300960})]);
 assert.equal(r.casados,1);assert.deepEqual(r.linhas.map(x=>x.origem),['PDV','NF']);assert.equal(r.linhas.reduce((s,l)=>s+l.valor_centavos,0),350460);
 assert.equal(r.linhas[1].dia,'2026-11-23');assert.equal(r.linhas[1].cliente_nome,'Cliente NF');
});
test('1A cada cupom no maximo um pedido; PKs distintas de mesmo valor continuam compras distintas',()=>{
 const r=C.juntar([cup(1),cup(2),cup(1)],[ped(1),ped(2),ped(3)]);
 assert.equal(r.casados,2);assert.equal(r.linhas.length,3);assert.equal(r.linhas.filter(x=>x.origem==='NF').length,1);
 assert.equal(C.juntar([cup(1)],[ped(1),ped(1)]).linhas.length,1,'retry do pedido nao duplica');
});
test('1A janelas sobrepostas priorizam fim mais cedo e cupom livre mais cedo; ordem de entrada nao altera soma',()=>{
 const ps=[ped(1,{dt_pedido:'2026-11-20T12:00:00-03:00',dt_saida:'2026-11-23T12:00:00-03:00'}),ped(2,{dt_pedido:'2026-11-01T12:00:00-03:00',dt_saida:'2026-11-24T12:00:00-03:00'})];
 const vs=[cup(1,'2026-11-10'),cup(2,'2026-11-20')];assert.equal(C.juntar(vs,ps).casados,2);assert.equal(C.juntar(vs.slice().reverse(),ps.slice().reverse()).casados,2);
});
test('1A janela inclusiva SP, +5 dias e fallback nota; data da suposta entrega nao substitui faturamento',()=>{
 const p=ped(1,{dt_pedido:'2026-11-21T02:59:59Z',dt_saida:null,dt_nota:'2026-11-24T02:59:59Z',dt_atendido:'2026-11-29T12:00:00-03:00'});
 assert.equal(C.juntar([cup(1,'2026-11-20')],[p]).casados,1);assert.equal(C.juntar([cup(1,'2026-11-28')],[p]).casados,1);
 assert.equal(C.juntar([cup(1,'2026-11-19')],[p]).casados,0);assert.equal(C.juntar([cup(1,'2026-11-29')],[p]).casados,0);
});
test('1A somente CNPJ faturado valido: sem tolerancia monetaria, zero valido e valor/data ausente sinalizados',()=>{
 const ps=[ped(1,{valor_centavos:null}),ped(2,{dt_saida:null,dt_atendido:null}),ped(3,{etapa:'conferido'}),ped(4,{cliente_tipo:'cpf',documento:null}),ped(5,{valor_centavos:0})];
 const r=C.juntar([cup(1,'2026-11-23',0)],ps);assert.equal(r.casados,1);assert.equal(r.semValor,1);assert.equal(r.semData,1);assert.equal(r.linhas.length,1);
 assert.equal(C.juntar([cup(1,'2026-11-23',49501)],[ped(1)]).linhas.length,2);
 assert.equal(C.juntar([cup(1)],[ped(1,{documento:'12345678000199'})]).linhas.length,2);
});
test('1A helper e puro e conserva cupom CPF sem usar CPF para ligar pedido',()=>{
 const vs=[{...cup(1),tipo:'cpf',documento:'00000000191'}],ps=[ped(1)];const antes=JSON.stringify([vs,ps]);
 assert.deepEqual(C.juntar(vs,ps).linhas.map(x=>x.origem),['PDV','NF']);assert.equal(JSON.stringify([vs,ps]),antes);
});
