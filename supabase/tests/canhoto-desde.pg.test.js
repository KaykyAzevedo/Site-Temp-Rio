// CANHOTO_DESDE_TEST_DB=sentinela_separando_enviado*; preparar com enviado.sql. Somente cluster local.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const db=process.env.CANHOTO_DESDE_TEST_DB;
function client(sql,readyMarker=false){
 assert.match(db||'',/^sentinela_separando_desde[a-z0-9_]+$/);
 const p=spawn('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
 let out='',err='',resolveReady,rejectReady,seen=false;
 const ready=readyMarker?new Promise((a,b)=>{resolveReady=a;rejectReady=b;}):Promise.resolve();
 p.stdout.on('data',b=>{out+=b;if(readyMarker&&!seen&&out.includes('DESDE_LOCKED')){seen=true;resolveReady();}});p.stderr.on('data',b=>{err+=b;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{if(readyMarker&&!seen)rejectReady(Error(err));resolve({code,out:out.trim(),err});});});
 p.stdin.end("set timezone='America/Sao_Paulo';set qa.role='authenticated';set qa.papel='marcador';\n"+sql);return {ready,done};
}
async function query(sql){const r=await client(sql).done;assert.equal(r.code,0,r.err);return r.out;}
async function lock(name){for(let i=0;i<35;i++){if(await query("select count(*) from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock'")==='1')return;await new Promise(r=>setTimeout(r,40));}assert.fail('nao esperou lock '+name);}

const payload='[{"ordem":1,"pedidos":[1]},{"ordem":2,"pedidos":[3]},{"ordem":3,"pedidos":[1528]}]';
test('056 PG: corte novo primeiro invalida publicacao antiga; sem deadlock', {skip:!db,timeout:10000},async()=>{
 await query("set qa.papel='admin';update rota_config set canhoto_desde='2026-11-23 12:00-03' where id=1");
 const rev=Number(await query('select revisao from rota_dia_fechada'));
 const update=client("begin;set qa.papel='admin';set role authenticated;update public.rota_config set canhoto_desde='2026-11-23 18:00-03' where id=1;\n\\echo DESDE_LOCKED\nselect pg_sleep(3);commit;",true);await update.ready;
 const pub=client("set application_name='desde_pub_antiga';select rota_050_publicar('2026-11-23','s10','"+payload+"','{}',"+rev+")");await lock('desde_pub_antiga');assert.equal((await update.done).code,0);
 const r=await pub.done;assert.notEqual(r.code,0);assert.match(r.err,/40001/);
 assert.equal(await query("select rota_055_pendente(1528,'2026-11-23')"),'f');
 await query("set qa.papel='admin';update rota_config set canhoto_desde='2026-11-23 12:00-03' where id=1");
});
test('056 PG: publicacao primeiro conclui e alteracao de corte espera; sem deadlock', {skip:!db,timeout:10000},async()=>{
 const rev=Number(await query('select revisao from rota_dia_fechada'));
 const pub=client("begin;select rota_050_publicar('2026-11-23','s10','"+payload+"','{}',"+rev+");\n\\echo DESDE_LOCKED\nselect pg_sleep(3);commit;",true);await pub.ready;
 const update=client("set application_name='desde_config_espera';set qa.papel='admin';set role authenticated;update public.rota_config set canhoto_desde='2026-11-23 18:00-03' where id=1");await lock('desde_config_espera');assert.equal((await pub.done).code,0);
 const r=await update.done;assert.equal(r.code,0,r.err);assert.equal(await query("select rota_055_pendente(1528,'2026-11-23')"),'f');
 await query("set qa.papel='admin';update rota_config set canhoto_desde='2026-11-23 12:00-03' where id=1");
});
