'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../../js/admin-compras.js');
const doc='37893563000166',dia='2026-06-25';
const nf=(extra={})=>({cd_nota:100550,numero:550,serie:'1',dia,dt:dia+'T18:30:00-03:00',documento:doc,tipo:'cnpj',cd_pedido:538,valor_centavos:2164320,total_nota_centavos:2421121,st_centavos:233458,nf_cupom:false,...extra});
const cup=(extra={})=>({dia,cd_pdv:1,nr_cupom:1,tipo:'cnpj',documento:doc,valor_centavos:2164320,...extra});
const pedido=(extra={})=>({cd_pedido:538,cliente_tipo:'cnpj',documento:doc,cliente_nome:'Mercado fictício',etapa:'atendido',dt_pedido:dia+'T10:00:00-03:00',dt_saida:dia+'T17:23:00-03:00',valor_centavos:2164320,...extra});
test('1B NF550 antiga sem cupom soma PRODUTOS e preserva total/ST no detalhe; varias filiais da rede nao se misturam',()=>{
 const outra='11222333000181',r=C.juntarFontes([],[],[nf(),nf({cd_nota:2,documento:outra})],[{dia}]);
 assert.equal(r.linhas.length,2);assert.equal(r.linhas.find(x=>x.documento===doc).valor_centavos,2164320);assert.equal(r.notas[0].total_nota_centavos,2421121);assert.equal(r.notas[0].st_centavos,233458);
});
test('1B NF oficial substitui fallback pelo pedido e cobertura, mesmo data faturamento distinta; variasNF porpedido conservadas',()=>{
 const r=C.juntarFontes([], [pedido({dt_saida:'2026-06-26T18:00-03:00'})], [nf(),nf({cd_nota:2,numero:551,valor_centavos:100})], [{dia}]);
 assert.equal(r.linhas.length,2);assert.equal(r.linhas.reduce((s,x)=>s+x.valor_centavos,0),2164420);
});
test('1B cobertura vazia autoritativa nao ressuscita nota cancelada por fallback; lacuna conserva1A',()=>{
 assert.equal(C.juntarFontes([], [pedido()], [], [{dia}]).linhas.length,0);
 assert.equal(C.juntarFontes([], [pedido()], [], []).linhas.length,1);
 assert.equal(C.juntarFontes([], [pedido()], null, null).linhas.length,1);
});
test('1B NFnormal e cupom distintos de mesmo valor contam ambos; NF ligadaPDV conta somente cupom e guarda detalhe',()=>{
 const x=C.juntarFontes([cup()],[],[nf()],[{dia}]);assert.equal(x.linhas.length,2);
 const r=C.juntarFontes([cup()], [pedido()], [nf({nf_cupom:true})], [{dia}]);assert.equal(r.linhas.length,1);assert.equal(r.linhas[0].origem,'PDV');assert.equal(r.notas.length,1);assert.equal(r.nfPDV.length,1);assert.equal(r.nfSemPdv,0);
 const sem=C.juntarFontes([],[],[nf({nf_cupom:true})],[{dia}]);assert.equal(sem.linhas.length,0);assert.equal(sem.nfSemPdv,1,'nao disfarca ausencia do cupom que deveria sustentar a soma');
});
test('1B cada cupom casa no maximo1fallback; linhasNF idempotentes e funcao pura',()=>{
 const vs=[cup()],ps=[pedido(),pedido({cd_pedido:539})],ns=[nf({cd_nota:2,cd_pedido:900})];const antes=JSON.stringify([vs,ps,ns]);
 const r=C.juntarFontes(vs,ps,ns.concat(ns),[]);assert.equal(r.linhas.length,3);assert.equal(r.casados,1);assert.equal(JSON.stringify([vs,ps,ns]),antes);
});
test('1B nota conflitante e soma acima da precisao inteira sao recusadas',()=>{
 assert.throws(()=>C.juntarFontes([],[],[nf(),nf({numero:551})],[]),/repetida/);
 assert.throws(()=>C.juntarFontes([cup({valor_centavos:Number.MAX_SAFE_INTEGER})],[],[nf()],[]),/precisão/);
});
test('1B ST desconhecida nao vira zero nem elimina produtos conhecidos',()=>{
 const r=C.juntarFontes([],[],[nf({st_centavos:null})],[]);assert.equal(r.linhas[0].valor_centavos,2164320);assert.equal(r.notas[0].st_centavos,null);
});
test('062 fornecedor Vida em Graos nao e maior cliente: 44 NF fora de TODAS as saidas comerciais',()=>{
 const fornecedor='18285535000111',mapa={[fornecedor]:''};
 const ns=Array.from({length:44},(_,i)=>nf({documento:fornecedor,cd_nota:800000+i,valor_centavos:2120454+(i<24?1:0)}));
 const bruto=ns.reduce((s,n)=>s+n.valor_centavos,0);assert.equal(bruto,93300000);
 const r=C.juntarFontes([cup()],[],ns.concat([nf()]),[{dia}],mapa);
 assert.equal(r.notas.length,1);assert.equal(r.linhas.length,2);assert.ok(r.linhas.every(x=>x.documento===doc));
 assert.ok(!Object.hasOwn(r.clientes,fornecedor));assert.ok(!r.nfPDV.some(x=>x.documento===fornecedor));
 const vinc=C.juntarFontes([],[],[nf({documento:fornecedor,nf_cupom:true})],[{dia}],mapa);assert.equal(vinc.nfSemPdv,0);assert.equal(vinc.notas.length,0);
 const fallback=C.juntarFontes([], [pedido({documento:fornecedor})],null,null,mapa);assert.equal(fallback.linhas.length,0);
});
