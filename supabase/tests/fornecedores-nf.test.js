'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../../js/admin-compras.js'),R=require('../functions/_shared/rota-core.js');
const doc='18285535000111',nf={cd_nota:880001,numero:701,serie:'1',dia:'2026-06-25',dt:'2026-06-25T12:00-03:00',documento:doc,cd_pedido:null,valor_centavos:2120455,total_nota_centavos:2121454,st_centavos:1000,nf_cupom:false};
const flush=()=>new Promise(ok=>setImmediate(ok));
function painel(){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 const trecho=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
 const leituras=[],forn={docs:{},versao:0},cmp={seq:0,carregado:false,nfInstalada:false};let gravados={};
 const sb={from(t){const q={select(){return q;},order(){return q;},in(){return q;},eq(){return q;},
  insert(x){gravados[x.documento]=true;return q;},delete(){delete gravados[doc];return q;},then(ok,bad){return Promise.resolve({data:[]}).then(ok,bad);}};return q;},
  rpc(){return new Promise(resolve=>leituras.push({resolve,notas:gravados[doc]?[]:[{...nf}]}));}};
 const ctx={sb,cmp,forn,window:{TempRioCompras:C,TempRioRotaCore:R},Date,CMP_LIMITE:20000,CMP_PED_LIMITE:20000,CMP_NF_LIMITE:20000,
  fornPode:()=>true,confirmarAdmin:()=>Promise.resolve(true),mapaClientes:null,gmap:{},cmpRedesenhar(){},carregarMapaClientes(){},
  fornAplicar(){},cmpDias:()=>0,cmpCalcular(linhas){cmp.total=linhas.reduce((s,n)=>s+n.valor_centavos,0);},
  vendPaginar:f=>Promise.resolve(f()),solidTabelaAusente:()=>false};
 const f=vm.runInNewContext(trecho('    function fornMarcar(',"    // Botão do popup")+trecho('    function carregarCompras()', '    function cmpOrigem(')+';({fornMarcar,carregarCompras})',ctx);
 function responder(i){const r=leituras[i];r.resolve({data:{notas:r.notas,dias:[{dia:'2026-06-25'}],truncado:false}});}
 return {...f,cmp,forn,leituras,responder};
}
test('062 marcar exclui compra e detalhe; desmarcar relê NF filtrada no servidor e restaura compra',async()=>{
 const p=painel(),inicial=p.carregarCompras();p.responder(0);await inicial;assert.equal(p.cmp.total,2120455);
 p.fornMarcar(doc,'Vida em Graos',true);await flush();p.responder(1);await flush();
 assert.equal(p.cmp.total,0);assert.equal(p.cmp.nfNotas.length,0);
 p.fornMarcar(doc,'Vida em Graos',false);await flush();assert.equal(p.leituras.length,3,'desmarcar não depende do cache sem NF');
 p.responder(2);await flush();assert.equal(p.cmp.total,2120455);assert.equal(p.cmp.nfNotas.length,1);
});
test('062 resposta anterior em voo não restaura fornecedor depois da marcação',async()=>{
 const p=painel(),antiga=p.carregarCompras();
 p.fornMarcar(doc,'Vida em Graos',true);await flush();p.responder(1);await flush();
 assert.equal(p.cmp.total,0);p.responder(0);await antiga;
 assert.equal(p.cmp.total,0);assert.equal(p.cmp.nfNotas.length,0);assert.ok(Object.hasOwn(p.forn.docs,doc));
});
