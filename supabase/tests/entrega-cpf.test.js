'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../functions/_shared/rota-core.js');
const fs=require('node:fs'),vm=require('node:vm');
const cpf=n=>({cd_pedido:n,cliente_tipo:'cpf',documento:null,cliente_nome:'Pessoa <QA>',dt_pedido:'2026-11-23T12:00:00-03:00',etapa:'conferido',caixas_24:1,caixas_48:0,caixas_outras:0,
 entrega_logradouro:'Rua CPF',entrega_numero:'20',entrega_complemento:'Casa',entrega_bairro:'Barra',entrega_cidade:'Rio',entrega_uf:'RJ',entrega_cep:'22770000'});
test('058 core: CPF usa dados por pedido sem cadastro por documento ou pino estimado',()=>{
 const c=R.clienteDoPedido(cpf(1),{});assert.equal(c.nome,'Pessoa <QA>');assert.equal(c.logradouro,'Rua CPF');assert.equal(c.bairro,'Barra');assert.equal(c.pos,null);assert.equal(c.uf,'RJ');
});
test('058 core: dois consumidores de mesmo nome/endereco continuam duas paradas',()=>{
 const p=R.planejar([cpf(1),cpf(2)],{},'2026-11-24',{marcacao:true,porPedido:{1:'s10',2:'s10'}});
 const ss=R.sequenciaDe(p.s10);assert.equal(ss.length,2);assert.equal(ss[0].nome,'Pessoa <QA>');assert.equal(ss[0].bairro,'Barra');assert.equal(ss[0].endereco,'Rua CPF, 20 — Casa');
 assert.deepEqual(ss.map(x=>x.chave).sort(),['p:1','p:2']);assert.ok(ss.every(x=>x.documento===null&&x.pos===null));
});
test('058 core: CNPJ conserva cadastro e sem058 CPF continua generico',()=>{
 const c={nome:'Empresa',pos:[-22,-43]};assert.equal(R.clienteDoPedido({cliente_tipo:'cnpj',documento:'11222333000181'},{'11222333000181':c}),c);
 const p=R.clienteDoPedido({cliente_tipo:'cpf',cd_pedido:4},{});assert.equal(p.nome,null);assert.equal(p.pos,null);assert.equal(p.logradouro,null);
});
function kanban(sb){
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8'),start=src.indexOf('    var PE_COLUNAS ='),end=src.indexOf('    // "Atualizado há X"',start);
 return vm.runInNewContext(src.slice(start,end)+';({peLerPedidos,peCartaoCompacto,peCartaoDetalhado,peLocalInfo})',{
  window:{TempRioRotaCore:R},Intl,Date,localStorage:{getItem:()=>null},celular:()=>false,sb,
  vendPaginar:f=>f().then(r=>r),cmpCadastros:()=>({}),docDigitos:s=>String(s||''),docNorm:s=>s,geoNorm:s=>String(s).toLowerCase(),
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),brl:String,NUM:new Intl.NumberFormat('pt-BR')});
}
test('058 Kanban: nome/endereco CPF escapados em compacto e detalhe, documento ausente',()=>{
 const q=kanban(),p={...cpf(1),entrega_logradouro:'Rua <QA>',documento:null};
 for(const html of [q.peCartaoCompacto(p),q.peCartaoDetalhado(p,true)]){
  assert.match(html,/Pessoa &lt;QA&gt;/);assert.match(html,/Rua &lt;QA&gt;/);assert.match(html,/Barra/);assert.ok(!html.includes('pessoa_chave'));
 }
});
test('058 Kanban: coluna ausente antes058 recua para contrato antigo; erro42501 nao recua',async()=>{
 let calls=0,code='42703';const sb={from(){let cols;const q={select(c){cols=c;return q;},order(){return q;},then(a,b){calls++;return Promise.resolve(cols.includes('entrega_logradouro')?{error:{code}}:{data:[]}).then(a,b);}};return q;}};
 const q=kanban(sb);assert.equal((await q.peLerPedidos()).error,undefined);assert.equal(calls,2);
 calls=0;code='42501';assert.equal((await q.peLerPedidos()).error.code,'42501');assert.equal(calls,1);
});
test('058 publicacao motorista: nome e endereco do pedido, sem CPF/HMAC/valor/pino inventado',()=>{
 const window={TempRioRotaCore:R};let src=fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8');
 src=src.replace('raiz.TempRioRota = {','raiz.__cpf={st,paradasPublicar,enderecoEntregaHtml};raiz.TempRioRota = {');
 vm.runInNewContext(src,{window,Intl,Date,setTimeout,clearTimeout,console});
 window.__cpf.st.clientes={};const bloco=R.planejar([cpf(1)],{},'2026-11-24',{marcacao:true,porPedido:{1:'s10'}}).s10;
 const p=window.__cpf.paradasPublicar(bloco)[0];assert.equal(p.nome,'Pessoa QA');assert.equal(p.endereco,'Rua CPF, 20 — Casa');assert.equal(p.bairro,'Barra');assert.equal(p.cidade,'Rio');
 assert.ok(!('lat'in p)&&!('lng'in p));assert.ok(!JSON.stringify(p).includes('documento')&&!JSON.stringify(p).includes('pessoa_chave')&&!JSON.stringify(p).includes('valor_centavos'));
 assert.match(window.__cpf.enderecoEntregaHtml(cpf(1),R.clienteDoPedido(cpf(1),{})),/Rua CPF/);
});
test('058 motorista existente abre Maps pelo endereco quando CPF nao tem pino',()=>{
 const src=fs.readFileSync(require.resolve('../../js/motorista.js'),'utf8');const inicio=src.indexOf('    function linkMaps(p)'),fim=src.indexOf('    function linkWaze(p)',inicio);
 const link=vm.runInNewContext(src.slice(inicio,fim)+';linkMaps',{temPos:()=>false});
 const u=new URL(link({nome:'Pessoa Ficticia',endereco:'Rua CPF, 20',bairro:'Barra',cidade:'Rio'}));assert.equal(u.searchParams.get('query'),'Rua CPF, 20, Barra, Rio');assert.ok(!u.href.includes('Pessoa'));
});
