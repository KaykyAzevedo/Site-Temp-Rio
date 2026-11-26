'use strict';
// 067: mapa / "Crescimento da marca" so com CLIENTE (quem comprou de nos). O PG real esta em mapa-so-clientes-067.sql.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const lf=s=>s.replace(/\r\n/g,'\n');   // checkout Windows pode trazer CRLF
const mig=n=>lf(fs.readFileSync(path.join(__dirname,'../../admin/migracoes',n),'utf8'));
const corpo=s=>s.slice(s.indexOf('create or replace function public.solidcon_mapa_clientes()'),s.indexOf('grant execute on function public.solidcon_mapa_clientes()'));
test('067 migracao = corpo 064 com join obrigatorio na compra; rollback = 064 exato',()=>{
 const m064=corpo(mig('064_nf_emitente.sql')),m067=corpo(mig('067_mapa_so_clientes.sql')),rb=corpo(mig('067_rollback.sql'));
 assert.equal(rb,m064,'rollback devolve o corpo 064 byte a byte');
 assert.match(m067,/\n    join a on a\.documento = c\.documento/);
 assert.doesNotMatch(m067,/left join a on a\.documento/);
 // Unica diferenca e a juncao (e o comentario do cabecalho da funcao).
 const sem=s=>s.replace(/^-- .*$/mg,'').replace(/\s+--.*$/mg,'').replace(/left join a on/,'join a on');
 assert.equal(sem(m067),sem(m064));
 for(const t of [/classe in \('venda','legado'\)/,/not exists \(select 1 from public\.solidcon_fornecedores f where f\.documento = c\.documento\)/,/c\.tipo = 'cnpj'/,/security invoker/,/stable/])
  assert.match(m067,t);
 assert.match(mig('067_mapa_so_clientes.sql'),/raise exception '067 requer 062\/064/);
});
test('067 card Crescimento e mapa contam so quem tem 1a compra (guarda no painel continua)',()=>{
 const src=lf(fs.readFileSync(path.join(__dirname,'../../js/admin.js'),'utf8'));
 assert.match(src,/var cron = linhas\.filter\(function \(l\) \{ return l\._pm; \}\)/,'ordem cronologica so com 1a compra');
 assert.match(src,/function gmapVisivel\(l\) \{ return l\._rank !== undefined && l\._rank < gmap\.cur; \}/,'pino so de quem tem rank');
 const nums=src.slice(src.indexOf('function hmNumeros()'),src.indexOf('function hmEstado()'));
 assert.match(nums,/if \(l\._rank === undefined\) return;/,'ativos/novos/cidades ignoram quem nunca comprou');
 assert.match(src.slice(src.indexOf('function hmPinos()'),src.indexOf('function hmNumeros()')),/gmap\.ordem\.filter/);
});
