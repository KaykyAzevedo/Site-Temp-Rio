'use strict';
// B066-R3: duas chamadas simultaneas de rota_066_registrar com a MESMA decisao gravam 1 registro. Opt-in:
// ROTA_SUGESTOES_066_TEST_DB = banco local sentinela_separando_* JA preparado com supabase/tests/rota-sugestoes-066.sql.
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const db=process.env.ROTA_SUGESTOES_066_TEST_DB,bin='C:/Program Files/PostgreSQL/18/bin/psql.exe';
function args(){return ['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1'];}
const guard="do $$begin if current_database() !~ '^sentinela_separando_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture isolada';end if;end$$;";
const limpa=s=>s.replace(/\r/g,'').trim();
function sql(s){assert.match(db,/^sentinela_separando_\w+$/);const r=spawnSync(bin,args(),{input:guard+s,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return limpa(r.stdout);}
function sessao(s){const p=spawn(bin,args(),{windowsHide:true});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);
 const fim=new Promise((ok,no)=>{p.on('error',no);p.on('close',c=>c===0?ok(out):no(Error(err)));});p.stdin.end(guard+s);return {fim,saida:()=>out};}
const MARCIO="set qa.uid='22222222-2222-4222-8222-222222222222';set role authenticated;";
async function corrida(cd,acao,dia){
 // Barreira SHARE: sem a trava da RPC, as duas chamadas passam da conferencia e so gravam depois que a barreira sai.
 const barreira=sessao(`begin;lock table rota_066_feedback in share mode;select 'BARREIRA066';select pg_sleep(1.2);commit;`);
 await new Promise(ok=>{const t=setInterval(()=>{if(barreira.saida().includes('BARREIRA066')){clearInterval(t);ok();}},20);});
 const chamada=`${MARCIO}select rota_066_registrar(${cd},'${acao}','${dia}')->>'status';`;
 const a=sessao(chamada),b=sessao(chamada);
 const [,ra,rb]=await Promise.all([barreira.fim,a.fim,b.fim]);
 return [limpa(ra),limpa(rb)];
}
test('B066-R3 PG: mesma decisao em 2 sessoes simultaneas grava 1 vez; decisoes diferentes gravam',{skip:!db,timeout:30000},async()=>{
 sql(`delete from rota_066_feedback where cd_pedido=98110;`);
 assert.deepEqual(await corrida(98110,'aceita','2026-11-30'),['ok','ok']);
 assert.equal(sql(`select count(*) from rota_066_feedback where cd_pedido=98110 and acao='aceita' and dia='2026-11-30';`),'1');
 // Outra acao / outro dia nao sao a mesma decisao: nao bloqueiam nem deduplicam.
 assert.equal(sql(`${MARCIO}select rota_066_registrar(98110,'ignorada','2026-11-30')->>'status';select rota_066_registrar(98110,'aceita','2026-12-01')->>'status';`),'ok\nok');
 assert.equal(sql(`select count(*) from rota_066_feedback where cd_pedido=98110;`),'3');
 sql(`delete from rota_066_feedback where cd_pedido=98110;`);
});
