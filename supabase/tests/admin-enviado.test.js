'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js');
const agoraFixo=Date.parse('2026-11-24T15:00:00Z');
class Relogio extends Date { constructor(...args){super(...(args.length?args:[agoraFixo]));}static now(){return agoraFixo;} }
function app(sb){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 const start=src.indexOf('    var PE_COLUNAS ='),end=src.indexOf('    function peFecharLegenda',start);
 assert.ok(start>0&&end>start);
 const sandbox={window:{TempRioRotaCore:R},Intl,Date:Relogio,celular:()=>false,localStorage:{getItem:()=>null},sb,
  $:()=>null,document:{getElementById:()=>null},peAtualizarTopo:()=>{},secaoVisivel:()=>false,abasParaRedesenhar:{},
  vendPaginar:f=>f().then(r=>r),solidTabelaAusente:e=>e.code==='42P01',
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),brl:n=>String(n),NUM:new Intl.NumberFormat('pt-BR'),
  cmpCadastros:()=>({}),docDigitos:s=>String(s||''),docNorm:s=>s,geoNorm:s=>String(s).toLowerCase()};
 return vm.runInNewContext(src.slice(start,end)+';({pe,peIndice,peItensDa,PE_COLUNAS,peCartaoCompacto,peCartaoDetalhado,carregarPedidosErp,peHistoricoLista,peHistoricoHtml,peHtml,peTotalDa})',sandbox);
}
const p={cd_pedido:1528,etapa:'atendido',cliente_tipo:'cnpj',cliente_nome:'Cliente Teste',documento:'12000000001528',dt_pedido:'2026-11-20T12:00:00-03:00',dt_saida:'2026-11-23T17:23:00-03:00',dt_nota:'2026-11-23T17:24:00-03:00',dt_atendido:'2026-11-23T17:24:00-03:00'};
test('Kanban atendido/saiu sem canhoto=Enviado; canhoto ativo=Recebido; contagens/filtros iguais',()=>{
 const q=app();q.pe.itens=[p,{...p,cd_pedido:2,etapa:'saiu'},{...p,cd_pedido:3,etapa:'conferido'}];
 assert.equal(q.peIndice(p),5);assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,2);assert.equal(q.peItensDa(q.PE_COLUNAS[6]).length,0);
 q.pe.canhotos[1528]=[{enviado_em:'2026-11-24T10:00:00-03:00'}];assert.equal(q.peIndice(p),6);assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,1);assert.equal(q.peItensDa(q.PE_COLUNAS[6]).length,1);
 q.pe.canhotos[1528]=[{substituido_em:'agora'}];assert.equal(q.peIndice(p),5);
 q.pe.canhotos[1528]=[];assert.equal(q.peIndice(p),5);
});
test('compacto e detalhado/modal mostram faturado em com data SP, nunca Recebido por atendido',()=>{
 const q=app();assert.match(q.peCartaoCompacto(p),/faturado em 23\/11 17:23/);assert.match(q.peCartaoCompacto(p),/data-cor="enviado"/);
 assert.match(q.peCartaoDetalhado(p,true),/faturado em 23\/11 17:23/);assert.ok(!q.peCartaoDetalhado(p,true).includes('<span>Recebido</span>'));
 q.pe.canhotos[1528]=[{}];assert.match(q.peCartaoDetalhado(p,true),/<span>Recebido<\/span>/);
});

test('056 Kanban: legado identifica Recebido; cinco pedidos17h permanecem Enviado; sem coluna volta055',()=>{
 const q=app();q.pe.cfg=R.cfgDe({canhoto_desde:'2026-11-23T12:00:00-03:00'});
 const velhos=[1525,1526,1527].map(cd=>({...p,cd_pedido:cd,dt_saida:'2026-11-23T11:00:00-03:00'}));
 const novos=[1528,1529,1530,1532,1534].map(cd=>({...p,cd_pedido:cd}));q.pe.itens=velhos.concat(novos);
 assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,5);assert.equal(q.peItensDa(q.PE_COLUNAS[6]).length,3);
 assert.match(q.peCartaoCompacto(velhos[0]),/Legado anterior ao controle/);
 assert.match(q.peCartaoDetalhado(velhos[0],true),/<span>Recebido<\/span>/);
 assert.ok(!q.peCartaoDetalhado(velhos[0],true).includes('fa-file-image'));
 q.pe.cfg=R.cfgDe({});assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,8);
});

test('056 carga do Kanban le corte com select*; ausencia da coluna conserva055 e erro nao presume legado',async()=>{
 let cfg={id:1,canhoto_desde:'2026-11-23T12:00:00-03:00'},falha=false,sel;
 const velho={...p,dt_saida:'2026-11-23T11:00:00-03:00'};
 const sb={rpc:n=>Promise.resolve({data:n==='rota_063_ler_entregas'?[]:true}),from(t){const q={select(s){if(t==='rota_config')sel=s;return q;},order(){return q;},in(){return q;},is(){return q;},eq(){return q;},limit(){return q;},then(ok,bad){return Promise.resolve(t==='rota_config'&&falha?{error:{code:'57014',message:'timeout'}}:{data:t==='rota_config'?[cfg]:t==='solidcon_pedidos_erp'?[velho]:[]}).then(ok,bad);}};return q;}};
 const q=app(sb);await q.carregarPedidosErp();assert.equal(sel,'*');assert.equal(q.peIndice(velho),6);
 cfg={id:1};await q.carregarPedidosErp();assert.equal(q.peIndice(velho),5);
 falha=true;await q.carregarPedidosErp();assert.equal(q.pe.carregado,false);assert.match(q.pe.erro,/timeout/);
});
test('063 Kanban e Historico usam data e autor da marca; foto tem precedencia e desfazer sem foto reabre',()=>{
 const q=app();q.pe.itens=[p];q.pe.confirmacoes={1528:{id:10,confirmado_em:'2026-11-24T10:00:00-03:00',confirmado_nome:'Marcio <QA>'}};
 assert.equal(q.peIndice(p),6);assert.match(q.peCartaoCompacto(p),/Recebido \(marcado por Marcio &lt;QA&gt;\)/);
 q.pe.confirmacoes[1528].confirmado_em='2026-11-21T10:00:00-03:00';assert.equal(q.peItensDa(q.PE_COLUNAS[6]).length,0);
 assert.equal(q.peHistoricoLista().length,1);assert.match(q.peHistoricoHtml(),/Recebido \(marcado por Marcio &lt;QA&gt;\)/);
 q.pe.canhotos[1528]=[{enviado_em:'2026-11-24T11:00:00-03:00'}];assert.match(q.peCartaoDetalhado(p,true),/Recebido \(canhoto\)/);
 q.pe.confirmacoes={};assert.equal(q.peIndice(p),6);q.pe.canhotos={};assert.equal(q.peIndice(p),5);
});

test('059 histórico: só hoje/ontem no Recebido, total exclusivo, busca local, ordem, 25 por página, foto e escape',()=>{
 const q=app({from(){throw Error('historico nao deve consultar banco');}});q.pe.carregado=true;
 q.pe.itens=Array.from({length:30},(_,i)=>({...p,cd_pedido:i+1,valor_centavos:100,cliente_nome:i===0?'<Cliente>':'Cliente '+(i+1)}));
 q.pe.itens.forEach(x=>q.pe.canhotos[x.cd_pedido]=[{enviado_em:'2026-11-21T12:00:00-03:00'}]);
 q.pe.itens.push({...p,cd_pedido:31,valor_centavos:700},{...p,cd_pedido:32,valor_centavos:900});
 q.pe.canhotos[31]=[{enviado_em:'2026-11-23T00:00:00-03:00'}];
 q.pe.canhotos[32]=[{enviado_em:'2026-11-24T00:00:00-03:00'}];
 const recentes=q.peItensDa(q.PE_COLUNAS[6]);assert.equal(recentes.length,2);assert.equal(q.peTotalDa(recentes).t,1600);
 assert.equal(q.peHistoricoLista().length,30);assert.equal(q.peHistoricoLista()[0].cd_pedido,30);
 let html=q.peHtml();assert.equal((html.match(/id="pe-historico"/g)||[]).length,1);assert.match(html,/<details id="pe-historico" class="adm-pe-historico">/);
 assert.equal((q.peHistoricoHtml().match(/<tr><td>/g)||[]).length,25);
 q.pe.historico.pagina=1;assert.equal((q.peHistoricoHtml().match(/<tr><td>/g)||[]).length,5);
 q.pe.historico.busca='<cliente>';html=q.peHistoricoHtml();assert.equal(q.pe.historico.pagina,0);assert.match(html,/&lt;Cliente&gt;/);assert.ok(!html.includes('<Cliente>'));assert.match(html,/data-pe-pedido="1"/);assert.match(html,/fa-file-image/);
 q.pe.historico.busca='inexistente';assert.match(q.peHistoricoHtml(),/Nenhum pedido/);
 q.pe.historico.busca='<cliente>';q.pe.canhotos[1]=[{}];assert.match(q.peHistoricoHtml(),/Não informado/);
});
