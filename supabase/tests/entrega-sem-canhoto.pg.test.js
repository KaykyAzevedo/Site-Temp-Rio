'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const db=process.env.ENTREGA063_TEST_DB,bin='C:/Program Files/PostgreSQL/18/bin/psql.exe';
const args=()=>['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1'];
const guard="do $$begin if current_database() !~ '^sentinela_separando_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture isolada';end if;end$$;";
function sql(s){assert.match(db,/^sentinela_separando_\w+$/);const r=spawnSync(bin,args(),{input:guard+s,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
test('063 PG: dois marcadores simultaneos geram uma prova, primeiro autor preservado',{skip:!db,timeout:10000},async()=>{
 sql("insert into solidcon_pedidos_erp(cd_pedido,etapa,dt_saida) values(99320,'atendido','2026-11-23T17:00-03');");
 const a=spawn(bin,args(),{windowsHide:true});let saida='',erro='';a.stderr.on('data',x=>erro+=x);
 const locked=new Promise(ok=>a.stdout.on('data',x=>{saida+=x;if(saida.includes('LOCKED063'))ok();}));
 const done=new Promise((ok,no)=>{a.on('error',no);a.on('close',c=>c===0?ok():no(Error(erro)));});
 a.stdin.end(guard+"set qa.uid='22222222-2222-4222-8222-222222222222';begin;select rota_063_confirmar_entrega(99320,'Marcio confirmou','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');select 'LOCKED063';select pg_sleep(1.3);commit;");
 await locked;
 const b=spawn(bin,args(),{windowsHide:true});let result='',err='';b.stdout.on('data',x=>result+=x);b.stderr.on('data',x=>err+=x);
 const answer=new Promise((ok,no)=>{b.on('error',no);b.on('close',c=>c===0?ok():no(Error(err)));});
 b.stdin.end(guard+"set qa.uid='11111111-1111-4111-8111-111111111111';select rota_063_confirmar_entrega(99320,null,'ffffffff-ffff-4fff-8fff-ffffffffffff')->>'repetido';");
 await Promise.all([done,answer]);assert.match(result,/true/);
 assert.equal(sql("select count(*)=1 and bool_and(confirmado_por='22222222-2222-4222-8222-222222222222'::uuid) from pedido_entrega_confirmacao where cd_pedido=99320"),'t');
});
