// ENVIADO_TEST_DB=sentinela_separando_enviado*; preparar com enviado.sql. Somente cluster local.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const db=process.env.ENVIADO_TEST_DB;
function client(sql,readyMarker=false){
 assert.match(db||'',/^sentinela_separando_enviado[a-z0-9_]+$/);
 const p=spawn('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
 let out='',err='',resolveReady,rejectReady,seen=false;
 const ready=readyMarker?new Promise((a,b)=>{resolveReady=a;rejectReady=b;}):Promise.resolve();
 p.stdout.on('data',b=>{out+=b;if(readyMarker&&!seen&&out.includes('SEP_LOCKED')){seen=true;resolveReady();}});p.stderr.on('data',b=>{err+=b;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{if(readyMarker&&!seen)rejectReady(Error(err));resolve({code,out:out.trim(),err});});});
 p.stdin.end("set timezone='America/Sao_Paulo';set qa.role='authenticated';set qa.papel='marcador';\n"+sql);return {ready,done};
}
async function query(sql){const r=await client(sql).done;assert.equal(r.code,0,r.err);return r.out;}
async function lock(name){for(let i=0;i<35;i++){if(await query("select count(*) from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock'")==='1')return;await new Promise(r=>setTimeout(r,40));}assert.fail('nao esperou lock '+name);}

const payload='[{"ordem":1,"pedidos":[1]},{"ordem":2,"pedidos":[3]},{"ordem":3,"pedidos":[1528]}]';
const cam='2026-11-23/1528/ffffffff-ffff-4fff-8fff-ffffffffffff.jpg';
const foto="set qa.papel='motorista';set qa.uid='11111111-1111-4111-8111-111111111111';select rota_052_registrar('"+cam+"',array[1528]::bigint[],false,'s10',1);";
test('055 PG: canhoto confirmado primeiro bloqueia publicacao RPC e INSERT antigos', {skip:!db,timeout:10000},async()=>{
 await query("insert into storage.objects(bucket_id,name,owner) values('canhotos','"+cam+"','11111111-1111-4111-8111-111111111111') on conflict do nothing");
 let rev=Number(await query('select revisao from rota_dia_fechada'));
 await query("select rota_050_publicar('2026-11-23','s10','"+payload+"','{}',"+rev+")");
 const upload=client("begin;"+foto+"\n\\echo SEP_LOCKED\nselect pg_sleep(3);commit;",true);await upload.ready;
 const pub=client("set application_name='enviado_pub_antiga';select rota_050_publicar('2026-11-23','s10','"+payload+"','{}',"+rev+")");
 const direct=client("set application_name='enviado_insert_antigo';insert into rota_saida(data,veiculo_id,paradas,resumo) values('2026-11-23','s10','"+payload+"','{}')");
 await lock('enviado_pub_antiga');await lock('enviado_insert_antigo');assert.equal((await upload.done).code,0);
 for(const c of [pub,direct]){const r=await c.done;assert.notEqual(r.code,0);assert.match(r.err,/40001/);}
 assert.equal(await query("select rota_055_pendente(1528,'2026-11-23')"),'f');
 await query("delete from pedido_canhoto where cd_pedido=1528");
});
test('055 PG: publicacao primeiro deixa foto esperar antes de travar contexto; sem deadlock', {skip:!db,timeout:10000},async()=>{
 const rev=Number(await query('select revisao from rota_dia_fechada'));
 const pub=client("begin;select rota_050_publicar('2026-11-23','s10','"+payload+"','{}',"+rev+");\n\\echo SEP_LOCKED\nselect pg_sleep(3);commit;",true);await pub.ready;
 const upload=client("set application_name='enviado_foto_espera';"+foto);await lock('enviado_foto_espera');
 assert.equal((await pub.done).code,0);const r=await upload.done;assert.equal(r.code,0,r.err);
 assert.equal(await query("select rota_055_pendente(1528,'2026-11-23')"),'f');
});

