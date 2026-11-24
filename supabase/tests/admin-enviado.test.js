'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js');
function app(){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8');
 const start=src.indexOf('    var PE_COLUNAS ='),end=src.indexOf('    // "Atualizado há X"',start);
 assert.ok(start>0&&end>start);
 const sandbox={window:{TempRioRotaCore:R},Intl,Date,celular:()=>false,localStorage:{getItem:()=>null},
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),brl:n=>String(n),NUM:new Intl.NumberFormat('pt-BR'),
  cmpCadastros:()=>({}),docDigitos:s=>String(s||''),docNorm:s=>s,geoNorm:s=>String(s).toLowerCase()};
 return vm.runInNewContext(src.slice(start,end)+';({pe,peIndice,peItensDa,PE_COLUNAS,peCartaoCompacto,peCartaoDetalhado})',sandbox);
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
