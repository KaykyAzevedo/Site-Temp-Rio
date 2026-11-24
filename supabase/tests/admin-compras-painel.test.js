'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js'),C=require('../../js/admin-compras.js');
const doc='11222333000181',outro='12345678000199';
const cup=(id,dia='2026-11-23')=>({dia,cd_pdv:1,nr_cupom:id,tipo:'cnpj',documento:doc,valor_centavos:49500});
const ped=(id,extra={})=>({cd_pedido:id,documento:doc,cliente_tipo:'cnpj',cliente_nome:'Cliente NF',etapa:'atendido',valor_centavos:300960,dt_pedido:'2026-11-20T12:00:00-03:00',dt_saida:'2026-11-23T17:23:00-03:00',...extra});
function app(sb){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 const a=src.indexOf('    var CMP_LIMITE ='),b=src.indexOf('    function desenharClientesCompras()',a);
 const u=src.indexOf('    var ucli ='),v=src.indexOf('    function formEditarCliente(',u);
 const d=src.indexOf('    function docDigitos('),e=src.indexOf('    function carregarSolidClientes()',d);
 class Clock extends Date{constructor(...xs){super(...(xs.length?xs:['2026-11-24T03:30:00Z']));}static now(){return Date.parse('2026-11-24T03:30:00Z');}}
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const env={window:{TempRioRotaCore:R,TempRioCompras:C},Intl,Date:Clock,console,document:{addEventListener(){}},sb,
  vendNum:v=>Number(v)||0,vendPaginar:(f,max)=>f().then(r=>r),solidTabelaAusente:e=>e.code==='42P01',
  dashAtualizarResumo(){},desenharAbaSeSuja(){},abaAtual:'clientes',abasParaRedesenhar:{},
  dados:{pedidos:[]},scli:{carregado:true,lista:[]},papel:'vendedor',clientesPagina:1,clientesFiltroAtivo:'todos',
  NUM:new Intl.NumberFormat('pt-BR'),brl:n=>(n/100).toFixed(2),esc,recCnpj:s=>s,
  SELO_ERP:'ERP',SELO_SITE:'SITE',ficha:(a,b,c)=>a+'|'+b+'|'+c};
 return vm.runInNewContext(src.slice(d,e)+src.slice(a,b)+src.slice(u,v)+';({cmp,forn,scli,carregarCompras,cmpCalcular,cmpPronto,cmpFonteNota,cmpNotasHtml,ucliLinhas,detalheClienteUnico,linhaClienteUnico,erp(){ucliEscopo("erp");}})',env);
}
function banco(){
 const T={solidcon_vendas_clientes:[cup(1)],solidcon_pedidos_erp:[ped(1530,{valor_centavos:49500}),ped(1508,{documento:outro,cliente_nome:'Meireles <script>'})]};
 let erro=false;
 const sb={from(t){let rows=(T[t]||[]).slice();const q={select(){return q;},order(){return q;},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},then(ok,bad){return Promise.resolve(erro&&t==='solidcon_pedidos_erp'?{error:{code:'57014',message:'timeout'}}:!T[t]?{error:{code:'42P01',message:'missing '+t}}:{data:rows}).then(ok,bad);}};return q;},rpc(nome){assert.equal(nome,'solidcon_ler_vendas_nf');
  return Promise.resolve(!Object.hasOwn(T,'solidcon_vendas_nf')&&!Object.hasOwn(T,'solidcon_vendas_nf_dias')?{error:{code:'PGRST202',message:'Could not find the function public.solidcon_ler_vendas_nf without parameters'}}:{data:{notas:T.solidcon_vendas_nf,dias:T.solidcon_vendas_nf_dias,truncado:false}});
 }};
 return {T,sb,falhar(){erro=true;}};
}
test('1A painel carrega ambas fontes; NF sem cadastro entra com nome, total/ultima/n/6meses e fontes corretos',async()=>{
 const {sb}=banco(),q=app(sb);await q.carregarCompras();assert.equal(q.cmpPronto(),true);q.erp();
 assert.equal(q.cmp.por[doc].total,49500);assert.equal(q.cmp.por[doc].n,1);assert.equal(q.cmp.por[doc].origens.PDV,1);
 const rows=q.ucliLinhas(),nf=rows.find(r=>r.doc===outro);assert.equal(rows.length,2);assert.equal(nf.nome,'Meireles <script>');
 assert.equal(nf.total,300960);assert.equal(nf.n,1);assert.equal(nf.total6,300960);assert.equal(nf.ticket6,300960);assert.equal(nf.ultima,'2026-11-23');assert.equal(nf.totalDe,'NF');
 const html=q.linhaClienteUnico(nf,6);assert.ok(!html.includes('Meireles <script>'));assert.match(html,/Meireles &lt;script&gt;/);assert.match(html,/26\/10\/2026/);assert.match(q.detalheClienteUnico(nf),/Origem NF/);
});
test('1A meses SP e frequencia usam uniao; fornecedor segue fora e cache permite recalculo',async()=>{
 const {T,sb}=banco();T.solidcon_vendas_clientes.push(cup(2,'2026-05-23'),cup(3,'2026-05-24'));
 T.solidcon_pedidos_erp.push(ped(1510,{valor_centavos:10000,dt_saida:'2026-11-21T12:00:00-03:00'}));
 const q=app(sb);await q.carregarCompras();let o=q.cmp.por[doc];assert.equal(q.cmp.hoje,'2026-11-24');assert.equal(q.cmp.corte,'2026-05-24');
 assert.equal(o.n,4);assert.equal(o.n6,3);assert.equal(o.total6,109000);assert.equal(o.ultima,'2026-11-23');assert.ok(o.freq>0);assert.equal(o.origens.NF,1);
 q.forn.docs[doc]=true;q.cmpCalcular(q.cmp.brutas);assert.ok(!q.cmp.por[doc]);assert.ok(q.cmp.por[outro]);
});
test('1A erro ou teto em qualquer fonte impede total parcial',async()=>{
 const b=banco(),q=app(b.sb);await q.carregarCompras();b.falhar();await q.carregarCompras();assert.equal(q.cmpPronto(),false);assert.equal(q.cmp.por,null);assert.equal(q.cmp.brutas,null);assert.match(q.cmp.erro,/timeout/);
 const z=banco();z.T.solidcon_pedidos_erp=Array(5000).fill(ped(1));const w=app(z.sb);await w.carregarCompras();assert.equal(w.cmp.truncado,true);assert.equal(w.cmpPronto(),false);
});

test('1A cliente apenas com pedido sem valor permanece na lista sem fabricar compra zero',async()=>{
 const {T,sb}=banco();T.solidcon_vendas_clientes=[];T.solidcon_pedidos_erp=[ped(1,{valor_centavos:null})];
 const q=app(sb);await q.carregarCompras();q.erp();const rows=q.ucliLinhas();assert.equal(rows.length,1);assert.equal(rows[0].nome,'Cliente NF');assert.equal(rows[0].total,null);assert.equal(rows[0].n,null);
 assert.match(q.detalheClienteUnico(rows[0]),/valor ou data indisponíveis/);assert.match(q.cmpFonteNota(),/1 pedido/);
});
test('1A carga tardia nao sobrescreve historico recarregado depois de novo cupom',async()=>{
 let rodada=0,soltar;const sb={from(t){const n=rodada,rows=t==='solidcon_pedidos_erp'?[ped(1,{valor_centavos:49500})]:n?[cup(1)]:[];
  const q={select(){return q;},order(){return q;},in(){return q;},eq(){return q;},then(ok,bad){return (n===0&&t==='solidcon_pedidos_erp'?new Promise(r=>{soltar=r;}):Promise.resolve(/^solidcon_vendas_nf/.test(t)?{error:{code:'42P01',message:'missing '+t}}:{data:rows})).then(ok,bad);}};return q;},rpc(){return Promise.resolve({error:{code:'PGRST202',message:'Could not find the function public.solidcon_ler_vendas_nf without parameters'}});}};
 const q=app(sb),primeiro=q.carregarCompras();rodada=1;await q.carregarCompras();soltar({data:[ped(1,{valor_centavos:49500})]});await primeiro;
 assert.equal(q.cmp.por[doc].n,1);assert.equal(q.cmp.por[doc].origens.PDV,1);assert.equal(q.cmp.por[doc].origens.NF,0);
});

test('1B painel NF550 antiga sem cupom/pedido soma produtos; total/ST no detalhe, fornecedor excluido',async()=>{
 const {T,sb}=banco();T.solidcon_vendas_clientes=[];T.solidcon_pedidos_erp=[];
 T.solidcon_vendas_nf=[{cd_nota:550,numero:550,serie:'<b>1</b>',dia:'2026-06-25',dt:'2026-06-25T18:30:00-03:00',documento:doc,cd_pedido:538,valor_centavos:2164320,total_nota_centavos:2421121,st_centavos:233458,nf_cupom:false}];
 T.solidcon_vendas_nf_dias=[{dia:'2026-06-25'}];
 const q=app(sb);await q.carregarCompras();q.erp();assert.equal(q.cmpPronto(),true);assert.equal(q.cmp.por[doc].total,2164320);assert.equal(q.cmp.por[doc].n,1);assert.equal(q.cmp.por[doc].ultima,'2026-06-25');
 const r=q.ucliLinhas().find(x=>x.doc===doc),html=q.detalheClienteUnico(r);assert.match(html,/24211\.21/);assert.match(html,/2334\.58/);assert.match(html,/21643\.20/);assert.match(html,/550 \/ &lt;b&gt;1&lt;\/b&gt;/);assert.ok(!html.includes('550 / <b>'));
 assert.match(q.cmpFonteNota(),/29\/05\/2026/);assert.ok(!q.cmpFonteNota().includes('26/10/2026'));
 q.forn.docs[doc]='teste';q.cmpCalcular(q.cmp.brutas);assert.ok(!q.cmp.por[doc]);
});
test('1B painel sem cobertura conserva1A; cobertura vazia remove fallback; esquema parcial/erro/teto nao vira zero',async()=>{
 const {T,sb}=banco();T.solidcon_vendas_nf=[];T.solidcon_vendas_nf_dias=[];
 const q=app(sb);await q.carregarCompras();assert.equal(q.cmp.por[outro].total,300960);
 T.solidcon_vendas_nf_dias=[{dia:'2026-11-23'}];await q.carregarCompras();assert.ok(!q.cmp.por[outro]);assert.equal(q.cmp.por[doc].total,49500);
 delete T.solidcon_vendas_nf_dias;await q.carregarCompras();assert.equal(q.cmpPronto(),false);assert.match(q.cmp.erro,/incompleta/);
 T.solidcon_vendas_nf_dias=[];T.solidcon_vendas_nf=Array(20000).fill({});await q.carregarCompras();assert.equal(q.cmpPronto(),false);assert.equal(q.cmp.truncado,true);
});
test('1B erro de leitura NF propaga sem apresentar total parcial ou notas da carga anterior',async()=>{
 const {T,sb}=banco();T.solidcon_vendas_nf=[];T.solidcon_vendas_nf_dias=[];
 const q=app(sb);await q.carregarCompras();assert.equal(q.cmpPronto(),true);
 sb.rpc=()=>Promise.resolve({error:{code:'42501',message:'permissao NF'}});
 await q.carregarCompras();assert.equal(q.cmpPronto(),false);assert.match(q.cmp.erro,/permissao NF/);assert.equal(q.cmp.nfNotas.length,0);
});
