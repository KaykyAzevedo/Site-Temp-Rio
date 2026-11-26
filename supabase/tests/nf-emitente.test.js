'use strict';
// 064: painel separa venda nossa, bonificacao (a parte) e compra de fornecedor (secao propria).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../../js/admin-compras.js');
const doc='37893563000166',dia='2026-06-25';
const nf=(extra={})=>({cd_nota:550,numero:550,serie:'1',dia,dt:dia+'T18:30:00-03:00',documento:doc,tipo:'cnpj',cd_pedido:null,valor_centavos:2164320,total_nota_centavos:2421121,st_centavos:null,nf_cupom:false,...extra});
test('064 total do cliente soma so venda/legado; bonificacao e compra nunca somam mesmo se chegarem',()=>{
 const r=C.juntarFontes([],[],[nf({classe:'venda'}),nf({cd_nota:551,classe:'legado',valor_centavos:100}),nf({cd_nota:552,classe:'bonificacao',valor_centavos:50000}),nf({cd_nota:553,classe:'compra',valor_centavos:66300000})],[{dia}]);
 assert.equal(r.linhas.reduce((s,x)=>s+x.valor_centavos,0),2164420);assert.equal(r.notas.length,2);
});
test('064 contrato antigo sem classe continua somando (painel antes do backfill)',()=>{
 assert.equal(C.juntarFontes([],[],[nf()],[{dia}]).linhas[0].valor_centavos,2164320);
});
test('064 bonificacoes agregadas por cliente, sem fornecedor marcado, sem duplicar nota',()=>{
 const b=[nf({cd_nota:560,valor_centavos:50000,natureza:'5.910 - Bonificação'}),nf({cd_nota:561,dia:'2026-07-01',valor_centavos:1000}),nf({cd_nota:561,dia:'2026-07-01',valor_centavos:1000}),nf({cd_nota:562,documento:'18285535000111',valor_centavos:9})];
 const r=C.resumoBonificacoes(b,{'18285535000111':''});
 assert.deepEqual(Object.keys(r),[doc]);assert.equal(r[doc].qtd,2);assert.equal(r[doc].centavos,51000);assert.equal(r[doc].notas[0].cd_nota,561,'mais recente primeiro');
 assert.equal(Object.keys(C.resumoBonificacoes(undefined)).length,0);
 assert.throws(()=>C.resumoBonificacoes([nf({valor_centavos:-1})]),/Bonificação inválida/);
});
test('064 painel: detalhe mostra bonificacao a parte e visao Fornecedores carrega compras pela RPC 064',()=>{
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 assert.match(src,/cmpNotasHtml\(r\.doc\) \+ cmpBonifHtml\(r\.doc\)/);
 assert.match(src,/sb\.rpc\('solidcon_ler_compras_nf'\)/);
 assert.match(src,/if \(!site\) nfcDesenhar\(\);/);
 assert.match(src,/resumoBonificacoes\(Array\.isArray\(snapshotNF\.bonificacoes\)/);
 assert.match(src,/não soma no total/);
});
// NF064-R1: "Atualizar" (carregarErpDaAba('clientes', true)) relê as compras de fornecedores.
// Executa as funções REAIS (carregarErpDaAba + carregarComprasNF + nfcDesenhar) num contexto isolado.
function nfcContexto(){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 const trecho=(a,b)=>{const i=src.indexOf(a);assert.ok(i>=0,a);return src.slice(i,src.indexOf(b,i));};
 const codigo=trecho('    function carregarErpDaAba(','    function recarregarErp(')+trecho('    function carregarComprasNF()','    function cmpNotasRedesenhar(');
 const alvo={innerHTML:'',id:'clientes-compras-fornecedores',querySelector:()=>null,querySelectorAll:()=>[],remove(){ctx.presente=false;}};
 const fonte={notas:[]},pend=[];
 const ctx={presente:false,papel:'admin',window:{},NUM:{format:String},SELO_ERP:'',esc:String,brl:String,cmpData:String,
  ucli:{escopo:'erp',verForn:'fornecedores'},nfc:{carregando:false,carregado:false,ausente:false,erro:null,dados:null,seq:0,aberto:{}},
  $:()=>({parentNode:{insertBefore(){ctx.presente=true;}}}),
  document:{getElementById:()=>ctx.presente?alvo:null,createElement:()=>alvo},
  sb:{rpc(nome){assert.equal(nome,'solidcon_ler_compras_nf');const snap=JSON.parse(JSON.stringify(fonte.notas));
   return new Promise(res=>pend.push(()=>res({data:{fornecedores:snap.length?[{emitente:'1',nome:'F',qtd:snap.length,valor_centavos:0,total_nota_centavos:0,primeira:'2026-11-01',ultima:'2026-11-01'}]:[],notas:snap},error:null})));}}};
 for(const n of ['solid','vend','scli','kv','pe','cmp','rec','geo','gmap','forn','giro','ent','ins','mg','pag'])ctx[n]={carregando:true};
 for(const m of codigo.match(/\b(?:carregar\w+|dashCarregarProgressivo)\(/g)||[]){const nome=m.slice(0,-1);if(!/^(carregarErpDaAba|carregarComprasNF)$/.test(nome))ctx[nome]=()=>{};}
 const f=vm.runInNewContext(codigo+';({carregarErpDaAba,nfcDesenhar})',ctx);
 const esvaziar=async()=>{while(pend.length){pend.shift()();await new Promise(r=>setImmediate(r));}};
 return {ctx,f,fonte,pend,esvaziar,alvo};
}
const vm=require('node:vm');
test('NF064-R1 Atualizar relê compras: chegada, alteração e exclusão de nota entre duas cargas',async()=>{
 const {ctx,f,fonte,esvaziar,alvo}=nfcContexto();
 fonte.notas=[{cd_nota:1,emitente:'1',valor_centavos:100}];
 f.nfcDesenhar();await esvaziar();
 assert.deepEqual(ctx.nfc.dados.notas.map(n=>n.cd_nota),[1]);
 fonte.notas.push({cd_nota:2,emitente:'1',valor_centavos:200});            // chegada
 f.carregarErpDaAba('clientes',true);
 assert.equal(ctx.nfc.carregado,true,'mantém a lista antiga enquanto recarrega');
 await esvaziar();assert.deepEqual(ctx.nfc.dados.notas.map(n=>n.cd_nota),[1,2]);
 fonte.notas[0].valor_centavos=999;                                         // alteração
 f.carregarErpDaAba('clientes',true);await esvaziar();
 assert.equal(ctx.nfc.dados.notas[0].valor_centavos,999);
 fonte.notas=fonte.notas.filter(n=>n.cd_nota!==1);                          // exclusão (cancelada)
 f.carregarErpDaAba('clientes',true);await esvaziar();
 assert.deepEqual(ctx.nfc.dados.notas.map(n=>n.cd_nota),[2]);
 assert.match(alvo.innerHTML,/Notas de fornecedores/);
 f.carregarErpDaAba('clientes',false);assert.equal(ctx.nfc.carregando,false,'sem forçar não relê');
});
test('NF064-R1 resposta velha é descartada (2 Atualizar seguidos e logout no meio)',async()=>{
 const {ctx,f,fonte,pend,esvaziar}=nfcContexto();
 fonte.notas=[{cd_nota:1,emitente:'1'}];f.nfcDesenhar();await esvaziar();
 fonte.notas=[{cd_nota:7,emitente:'1'}];f.carregarErpDaAba('clientes',true);  // resposta A (velha)
 fonte.notas=[{cd_nota:8,emitente:'1'}];f.carregarErpDaAba('clientes',true);  // resposta B
 pend[1]();await new Promise(r=>setImmediate(r));pend[0]();await new Promise(r=>setImmediate(r));pend.length=0;
 assert.deepEqual(ctx.nfc.dados.notas.map(n=>n.cd_nota),[8],'A chegou depois e foi ignorada');
 f.carregarErpDaAba('clientes',true);
 // logout (mesmo reset de js/admin.js sair): seq++ e limpa
 ctx.nfc.seq++;ctx.nfc.carregando=false;ctx.nfc.carregado=false;ctx.nfc.dados=null;
 await esvaziar();assert.equal(ctx.nfc.dados,null,'resposta pós-logout não repovoa');
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 assert.match(src,/nfc\.seq\+\+; nfc\.carregando = false; nfc\.carregado = false; nfc\.dados = null;/,'logout ainda invalida nfc');
});
test('NF064-R1 visão oculta: Atualizar só invalida; reabrir Fornecedores busca dado novo',async()=>{
 const {ctx,f,fonte,pend,esvaziar}=nfcContexto();
 fonte.notas=[{cd_nota:1,emitente:'1'}];f.nfcDesenhar();await esvaziar();
 ctx.ucli.verForn='clientes';f.nfcDesenhar();assert.equal(ctx.presente,false);
 fonte.notas=[{cd_nota:1,emitente:'1'},{cd_nota:3,emitente:'1'}];
 f.carregarErpDaAba('clientes',true);assert.equal(pend.length,0,'oculta: sem RPC');assert.equal(ctx.nfc.carregado,false);
 ctx.ucli.verForn='fornecedores';f.nfcDesenhar();await esvaziar();
 assert.deepEqual(ctx.nfc.dados.notas.map(n=>n.cd_nota),[1,3]);
});
