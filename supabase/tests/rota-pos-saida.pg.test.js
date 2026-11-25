'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const db=process.env.ROTA_POS_SAIDA_TEST_DB,bin='C:/Program Files/PostgreSQL/18/bin/psql.exe';
function args(){return ['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1'];}
const guard="do $$begin if current_database() !~ '^sentinela_separando_' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture isolada';end if;end$$;";
function sql(s){assert.match(db,/^sentinela_separando_\w+$/);const r=spawnSync(bin,args(),{input:guard+s,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
test('061 PG: horario e revalidado depois de esperar a trava5001',{skip:!db,timeout:10000},async()=>{
 sql(`create table qa.relogio(em timestamptz);insert into qa.relogio values('2026-11-23T07:59-03');
 do $$begin execute replace(pg_get_functiondef('public.rota_061_auto_aberta(date)'::regprocedure),
 '(pg_catalog.current_setting(''qa.agora''))::timestamptz','(select em from qa.relogio)');end$$;`);
 const p=spawn(bin,args(),{windowsHide:true}),out=[];let err='';p.stderr.on('data',x=>err+=x);
 const done=new Promise((ok,no)=>{p.on('error',no);p.on('close',c=>c===0?ok():no(Error(err)));});
 const locked=new Promise(ok=>p.stdout.on('data',x=>{out.push(String(x));if(out.join('').includes('LOCKED061'))ok();}));
 p.stdin.end(guard+"begin;select pg_advisory_xact_lock(5100,5001);update qa.relogio set em='2026-11-23T08:01-03';select 'LOCKED061';select pg_sleep(1.5);commit;");
 await locked;
 // Async: permitir que a sessao que segura a trava termine enquanto esta aguarda.
 const q=spawn(bin,args(),{windowsHide:true});let result='',error='';q.stdout.on('data',x=>result+=x);q.stderr.on('data',x=>error+=x);
 const answer=new Promise((ok,no)=>{q.on('error',no);q.on('close',c=>c===0?ok():no(Error(error)));});
 q.stdin.end(guard+"set qa.role='service_role';select rota_054_incluir('2026-11-23',-1,'[]')->>'motivo';");
 await Promise.all([done,answer]);assert.match(result,/saida_encerrada/);
});
test('061 PG: proposta de reparo valida publicacao, preserva origem e replay nao duplica',{skip:!db},()=>{
 const s=fs.readFileSync(require.resolve('../../docs/sql-proposto-rota-2026-11-25.sql'),'utf8');
 assert.match(s,/rollback; -- DEFAULT SEGURO/);assert.match(s,/-- set local temprio.confirmar/);
 const reparo=s.slice(s.indexOf('do $$'),s.indexOf('end$$;')+7);
 const cds='1531,1535,1536,1537,1539,1540,1541,1543,1544';
 sql(`begin;set local temprio.confirmar_reparo_pos_saida='2026-11-24>2026-11-25';
 select pg_advisory_xact_lock(5100,61);select pg_advisory_xact_lock(5100,5201);select pg_advisory_xact_lock(5100,5001);
 delete from pedido_canhoto where cd_pedido in(${cds});delete from rota_dia_item where data in('2026-11-24','2026-11-25');delete from rota_saida where data='2026-11-25';
 insert into rota_dia_fechada(data) values('2026-11-24'),('2026-11-25') on conflict(data) do update set estado='fechada';
 insert into rota_dia_item(data,cd_pedido,veiculo_id,ordem,origem,incluido_em)
 select date '2026-11-24',cd,'s10',row_number() over(order by cd),'separando','2026-11-24T10:30-03' from unnest(array[${cds}]) cd;
 insert into rota_dia_item(data,cd_pedido,veiculo_id,ordem) values('2026-11-25',1475,'s10',1);
 insert into rota_saida(data,veiculo_id,paradas) values('2026-11-25','s10','[]');
 select qa.erro($test$${reparo}$test$,'P0001','061 proposta recusa publicacao ativa');
 delete from rota_saida where data='2026-11-25';
 create temporary table reparo_antes as select (select count(*) from rota_dia_log) n;
 ${reparo}
 select qa.check((select count(*)=9 from rota_dia_item where data='2026-11-24' and cd_pedido in(${cds}) and removido_em is not null),'061 reparo marca origem sem apagar');
 select qa.check((select count(*)=9 and min(ordem)=2 and max(ordem)=10 from rota_dia_item where data='2026-11-25' and cd_pedido in(${cds}) and removido_em is null),'061 reparo nove no destino ao fim');
 create temporary table reparo_rev as select data,revisao from rota_dia_fechada;
 ${reparo}
 select qa.check((select count(*)=n+2 from rota_dia_log cross join reparo_antes group by n),'061 reparo replay sem log duplicado');
 select qa.check(not exists(select from rota_dia_fechada f join reparo_rev r using(data) where f.revisao<>r.revisao),'061 reparo replay sem revisao extra');
 rollback;`);
});
