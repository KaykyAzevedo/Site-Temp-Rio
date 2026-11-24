// PEDIDO_ARQUIVO_TEST_DB=sentinela_separando_arquivo*; preparar com pedido-arquivo.sql. Somente cluster local.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const db=process.env.PEDIDO_ARQUIVO_TEST_DB;
function client(sql,readyMarker=false){
 assert.match(db||'',/^sentinela_separando_arquivo[a-z0-9_]+$/);
 const p=spawn('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
 let out='',err='',resolveReady,rejectReady,seen=false;
 const ready=readyMarker?new Promise((a,b)=>{resolveReady=a;rejectReady=b;}):Promise.resolve();
 p.stdout.on('data',b=>{out+=b;if(readyMarker&&!seen&&out.includes('ARQUIVO_LOCKED')){seen=true;resolveReady();}});p.stderr.on('data',b=>{err+=b;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{if(readyMarker&&!seen)rejectReady(Error(err));resolve({code,out:out.trim(),err});});});
 p.stdin.end("set timezone='America/Sao_Paulo';set qa.role='authenticated';set qa.papel='marcador';\n"+sql);return {ready,done};
}
async function query(sql){const r=await client(sql).done;assert.equal(r.code,0,r.err);return r.out;}
async function lock(name){for(let i=0;i<35;i++){if(await query("select count(*) from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock'")==='1')return;await new Promise(r=>setTimeout(r,40));}assert.fail('nao esperou lock '+name);}


const cam=n=>'2026-11-24/'+n+'/ffffffff-ffff-4fff-8fff-ffffffffffff.jpg';
async function preparar(n){await query("insert into public.solidcon_pedidos_erp(cd_pedido,dt_pedido,etapa,cliente_tipo,documento,cliente_nome,valor_centavos) values("+n+",now(),'aberto','cnpj','11222333000181','Concorrente',12300) on conflict(cd_pedido) do nothing;insert into storage.objects(bucket_id,name) values('canhotos','"+cam(n)+"') on conflict do nothing");}
test('057 PG: foto primeiro e poda espera; pacote completo sobrevive', {skip:!db,timeout:10000},async()=>{
 await preparar(9001);
 const foto=client("begin;select public.rota_052_registrar('"+cam(9001)+"',array[9001]::bigint[],false);\n\\echo ARQUIVO_LOCKED\nselect pg_sleep(3);commit;",true);await foto.ready;
 const poda=client("set application_name='arquivo_sync_espera';begin;select pg_advisory_xact_lock(5100,35);delete from public.solidcon_pedidos_erp where cd_pedido=9001;commit;");await lock('arquivo_sync_espera');assert.equal((await foto.done).code,0);const r=await poda.done;assert.equal(r.code,0,r.err);
 assert.equal(await query("select cliente_nome||':'||valor_centavos from public.pedido_arquivo where cd_pedido=9001"),'Concorrente:12300');
 assert.equal(await query('select count(*) from public.solidcon_pedidos_erp where cd_pedido=9001'),'0');
});
test('057 PG: poda primeiro nao deixa comprovante sem snapshot; anexo recusa P0002', {skip:!db,timeout:10000},async()=>{
 await preparar(9002);
 const poda=client("begin;select pg_advisory_xact_lock(5100,35);delete from public.solidcon_pedidos_erp where cd_pedido=9002;\n\\echo ARQUIVO_LOCKED\nselect pg_sleep(3);commit;",true);await poda.ready;
 const foto=client("set application_name='arquivo_foto_espera';select public.rota_052_registrar('"+cam(9002)+"',array[9002]::bigint[],false)");await lock('arquivo_foto_espera');assert.equal((await poda.done).code,0);const r=await foto.done;assert.notEqual(r.code,0);assert.match(r.err,/P0002/);
 assert.equal(await query('select count(*) from public.pedido_canhoto where cd_pedido=9002'),'0');
 assert.equal(await query('select count(*) from public.pedido_arquivo where cd_pedido=9002'),'0');
});
