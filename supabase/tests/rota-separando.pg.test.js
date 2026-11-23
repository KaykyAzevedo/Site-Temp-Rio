// Opt-in SEPARANDO_TEST_DB=sentinela_separando_*; preparar com rota-separando.sql. NUNCA projeto.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const R=require('../functions/_shared/rota-core.js');
const db=process.env.SEPARANDO_TEST_DB;
function client(sql,readyMarker=false){
 assert.match(db||'',/^sentinela_separando_[a-z0-9_]+$/);
 const p=spawn('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
 let out='',err='',resolveReady,rejectReady,seen=false;
 const ready=readyMarker?new Promise((a,b)=>{resolveReady=a;rejectReady=b;}):Promise.resolve();
 p.stdout.on('data',b=>{out+=b;if(readyMarker&&!seen&&out.includes('SEP_LOCKED')){seen=true;resolveReady();}});p.stderr.on('data',b=>{err+=b;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{if(readyMarker&&!seen)rejectReady(Error(err));resolve({code,out:out.trim(),err});});});
 p.stdin.end("set timezone='America/Sao_Paulo';set qa.role='authenticated';set qa.papel='marcador';\n"+sql);return {ready,done};
}
async function query(sql){const r=await client(sql).done;assert.equal(r.code,0,r.err);return r.out;}
async function lock(name){for(let i=0;i<35;i++){if(await query("select count(*) from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock'")==='1')return;await new Promise(r=>setTimeout(r,40));}assert.fail('nao esperou lock '+name);}
function ordem(cds){return JSON.stringify(cds.map((cd,i)=>({cd_pedido:cd,veiculo_id:'s10',ordem:i+1})));}
test('PG18: remover do Marcio vence proposta antiga; cliente nao volta por novo pedido', {skip:!db,timeout:10000},async()=>{
 await query("insert into solidcon_pedidos_erp values(10,'12000000000001','separando'),(11,'12000000000011','separando')");
 const rev=Number(await query('select revisao from rota_dia_fechada'));
 const manual=client("begin;select rota_050_ajustar('remover',array[1]::bigint[],null,'[{\"cd_pedido\":3,\"ordem\":1}]');\n\\echo SEP_LOCKED\nselect pg_sleep(3);commit;",true);await manual.ready;
 const auto=client("set application_name='sep_espera_manual';select rota_054_incluir('2026-11-23',"+rev+",'"+ordem([1,3,10,11])+"')");await lock('sep_espera_manual');assert.equal((await manual.done).code,0);
 const refused=await auto.done;assert.notEqual(refused.code,0);assert.match(refused.err,/40001/);
 assert.equal(await query("select count(*) from rota_054_candidatos('2026-11-23') where cd_pedido=10"),'0');
 assert.equal(await query('select count(*) from rota_dia_item where cd_pedido in (10,11)'),'0');
 await query("update solidcon_pedidos_erp set etapa='conferido' where cd_pedido in (10,11)");
});
test('PG18: inclusao bloqueia ajuste/publicacao antigos; rollback integral do ajuste e revisao preservada', {skip:!db,timeout:10000},async()=>{
 await query("insert into solidcon_pedidos_erp values(12,'12000000000012','separando')");
 const rev=Number(await query('select revisao from rota_dia_fechada'));
 const auto=client("begin;select rota_054_incluir('2026-11-23',"+rev+",'"+ordem([3,12])+"');\n\\echo SEP_LOCKED\nselect pg_sleep(3);commit;",true);await auto.ready;
 const manual=client("set application_name='sep_ajuste_antigo';select rota_050_ajustar('remover',array[3]::bigint[],null,'[]')");
 const publish=client("set application_name='sep_publica_antiga';select rota_050_publicar('2026-11-23','s10','[{\"ordem\":1,\"pedidos\":[3]}]','{}',"+rev+")");
 const direct=client("set application_name='sep_insert_antigo';insert into rota_saida(data,veiculo_id,paradas,resumo) values('2026-11-23','s10','[{\"ordem\":1,\"pedidos\":[3]}]','{}')");
 await lock('sep_ajuste_antigo');await lock('sep_publica_antiga');await lock('sep_insert_antigo');assert.equal((await auto.done).code,0);
 const m=await manual.done,p=await publish.done;assert.notEqual(m.code,0);assert.match(m.err,/22023/);assert.notEqual(p.code,0);assert.match(p.err,/40001/);
 const d=await direct.done;assert.notEqual(d.code,0);assert.match(d.err,/40001/);
 assert.equal(await query('select count(*) from rota_dia_item where cd_pedido=3 and removido_em is null'),'1');
 assert.equal(await query('select count(*) from rota_dia_item where cd_pedido=12 and origem=\'separando\''),'1');
 assert.equal(await query('select count(*) from rota_saida'),'0');
});
test('PG18: calendario da054 e constante padrao coincidem com rota-core em 2020..2030', {skip:!db},async()=>{
 assert.equal(await query('select rota_054_padrao_separando()'),R.ROTA.VEICULO_SEPARANDO);
 const datas=JSON.parse(await query("select json_agg(json_build_array(d::date,rota_054_tem_saida(d::date,'s10'))) from generate_series('2020-01-01'::date,'2030-12-31'::date,'1 day') d"));
 const cfg=R.comFrota(R.cfgDe({feriados_sem_saida:true}),[{id:'s10',nome:'S10',modo:'porta',dias_sem_saida:[0,6],ativo:true}]);
 for(const [dia,saida] of datas)assert.equal(saida,R.temSaida(dia,cfg,'s10'),dia);
});
