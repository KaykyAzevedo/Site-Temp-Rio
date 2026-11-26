'use strict';
// B065-R2: troca CONCORRENTE do plano x inclusao automatica 054. Opt-in: ROTA_SEMANA_065_TEST_DB = banco local
// sentinela_separando_* JA preparado com supabase/tests/rota-semana-065.sql (usa qa.base_b065). So 127.0.0.1:55439.
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const db=process.env.ROTA_SEMANA_065_TEST_DB,bin='C:/Program Files/PostgreSQL/18/bin/psql.exe';
function args(){return ['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1'];}
const guard="do $$begin if current_database() !~ '^sentinela_separando_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture isolada';end if;end$$;";
function sql(s){assert.match(db,/^sentinela_separando_\w+$/);const r=spawnSync(bin,args(),{input:guard+s,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function sessao(s){const p=spawn(bin,args(),{windowsHide:true});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);
 const fim=new Promise((ok,no)=>{p.on('error',no);p.on('close',c=>c===0?ok(out):no(Error(err)));});p.stdin.end(guard+s);return {p,fim,saida:()=>out};}
const SESSAO="set qa.agora='2026-11-25T07:59:00-03';set qa.uid='22222222-2222-4222-8222-222222222222';";
test('B065-R2 PG: inclusao 054 espera a gravacao do plano (4601) e respeita o plano novo',{skip:!db,timeout:20000},async()=>{
 sql(`select qa.base_b065();delete from rota_pedido_ignorado where cd_pedido=99731;delete from solidcon_pedidos_erp where cd_pedido=99731;
 insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_pedido,dt_sep_inicio) values(99731,'separando','2026-11-24T10:00-03','2026-11-25T07:00-03');
 ${SESSAO}set qa.role='authenticated';select rota_050_fechar('[]');`);
 assert.equal(sql(`${SESSAO}set qa.role='service_role';select string_agg(cd_pedido::text,',') from rota_054_candidatos('2026-11-25');`),'99731','antes: candidato');
 // A: Marcio programa 99731 para amanha (trava 4601 pelo gatilho da 046) e segura a transacao.
 const a=sessao(`begin;insert into rota_plano_semana(cd_pedido,dia,veiculo_id,ordem) values(99731,'2026-11-26','s10',1);select 'LOCKED065';select pg_sleep(1.5);commit;`);
 await new Promise(ok=>{const t=setInterval(()=>{if(a.saida().includes('LOCKED065')){clearInterval(t);ok();}},20);});
 // B: tique do servidor com a proposta calculada ANTES (inclui 99731). Tem de esperar A e reler o plano.
 const t0=Date.now();
 const b=sessao(`${SESSAO}set qa.role='service_role';select rota_054_incluir('2026-11-25',(select revisao from rota_dia_fechada where data='2026-11-25'),'[{"cd_pedido":99731,"veiculo_id":"s10","ordem":1}]')->>'incluidos';`);
 const [,rb]=await Promise.all([a.fim,b.fim]);
 assert.ok(Date.now()-t0>=900,'B esperou a trava do plano');
 assert.equal(rb.trim(),'0','plano novo (amanha) tira o pedido da inclusao de hoje');
 assert.equal(sql(`select count(*) from rota_dia_item where data='2026-11-25' and cd_pedido=99731;`),'0');
 assert.equal(sql(`select dia from rota_plano_semana where cd_pedido=99731;`),'2026-11-26');
});
