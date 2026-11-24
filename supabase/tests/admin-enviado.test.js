'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js');
function app(sb){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 const start=src.indexOf('    var PE_COLUNAS ='),end=src.indexOf('    // "Atualizado há X"',start);
 assert.ok(start>0&&end>start);
 const sandbox={window:{TempRioRotaCore:R},Intl,Date,celular:()=>false,localStorage:{getItem:()=>null},sb,
  $:()=>null,document:{getElementById:()=>null},peAtualizarTopo:()=>{},secaoVisivel:()=>false,abasParaRedesenhar:{},
  vendPaginar:f=>f().then(r=>r),solidTabelaAusente:e=>e.code==='42P01',
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),brl:n=>String(n),NUM:new Intl.NumberFormat('pt-BR'),
  cmpCadastros:()=>({}),docDigitos:s=>String(s||''),docNorm:s=>s,geoNorm:s=>String(s).toLowerCase()};
 return vm.runInNewContext(src.slice(start,end)+';({pe,peIndice,peItensDa,PE_COLUNAS,peCartaoCompacto,peCartaoDetalhado,carregarPedidosErp})',sandbox);
}
const p={cd_pedido:1528,etapa:'atendido',cliente_tipo:'cnpj',cliente_nome:'Cliente Teste',documento:'12000000001528',dt_pedido:'2026-11-20T12:00:00-03:00',dt_saida:'2026-11-23T17:23:00-03:00',dt_nota:'2026-11-23T17:24:00-03:00',dt_atendido:'2026-11-23T17:24:00-03:00'};
test('Kanban atendido/saiu sem canhoto=Enviado; canhoto ativo=Recebido; contagens/filtros iguais',()=>{
 const q=app();q.pe.itens=[p,{...p,cd_pedido:2,etapa:'saiu'},{...p,cd_pedido:3,etapa:'conferido'}];
 assert.equal(q.peIndice(p),4);assert.equal(q.peItensDa(q.PE_COLUNAS[4]).length,2);assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,0);
 q.pe.canhotos[1528]=[{enviado_em:'agora'}];assert.equal(q.peIndice(p),5);assert.equal(q.peItensDa(q.PE_COLUNAS[4]).length,1);assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,1);
 q.pe.canhotos[1528]=[{substituido_em:'agora'}];assert.equal(q.peIndice(p),4);
 q.pe.canhotos[1528]=[];assert.equal(q.peIndice(p),4);
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
 assert.equal(q.peItensDa(q.PE_COLUNAS[4]).length,5);assert.equal(q.peItensDa(q.PE_COLUNAS[5]).length,3);
 assert.match(q.peCartaoCompacto(velhos[0]),/Legado anterior ao controle/);
 assert.match(q.peCartaoDetalhado(velhos[0],true),/<span>Recebido<\/span>/);
 assert.ok(!q.peCartaoDetalhado(velhos[0],true).includes('fa-file-image'));
 q.pe.cfg=R.cfgDe({});assert.equal(q.peItensDa(q.PE_COLUNAS[4]).length,8);
});

test('056 carga do Kanban le corte com select*; ausencia da coluna conserva055 e erro nao presume legado',async()=>{
 let cfg={id:1,canhoto_desde:'2026-11-23T12:00:00-03:00'},falha=false,sel;
 const velho={...p,dt_saida:'2026-11-23T11:00:00-03:00'};
 const sb={rpc:()=>Promise.resolve({data:true}),from(t){const q={select(s){if(t==='rota_config')sel=s;return q;},order(){return q;},is(){return q;},eq(){return q;},limit(){return q;},then(ok,bad){return Promise.resolve(t==='rota_config'&&falha?{error:{code:'57014',message:'timeout'}}:{data:t==='rota_config'?[cfg]:t==='solidcon_pedidos_erp'?[velho]:[]}).then(ok,bad);}};return q;}};
 const q=app(sb);await q.carregarPedidosErp();assert.equal(sel,'*');assert.equal(q.peIndice(velho),5);
 cfg={id:1};await q.carregarPedidosErp();assert.equal(q.peIndice(velho),4);
 falha=true;await q.carregarPedidosErp();assert.equal(q.pe.carregado,false);assert.match(q.pe.erro,/timeout/);
});
