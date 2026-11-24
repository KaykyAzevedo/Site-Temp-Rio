'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const db=process.env.ENTREGA_CPF_TEST_DB;
function client(sql,marker=false){
 assert.match(db||'',/^sentinela_separando_cpf[a-z0-9_]+$/);
 const p=spawn('C:/Program Files/PostgreSQL/18/bin/psql.exe',['-X','-A','-t','-q','-h','127.0.0.1','-p','55439','-U','qa','-d',db,'-v','ON_ERROR_STOP=1'],{windowsHide:true});
 let out='',err='',readyOk,readyErr,seen=false;const ready=marker?new Promise((a,b)=>{readyOk=a;readyErr=b;}):Promise.resolve();
 p.stdout.on('data',b=>{out+=b;if(marker&&!seen&&out.includes('CPF_LOCKED')){seen=true;readyOk();}});p.stderr.on('data',b=>{err+=b;});
 const done=new Promise((a,b)=>{p.on('error',b);p.on('close',code=>{if(marker&&!seen)readyErr(Error(err));a({code,out:out.trim(),err});});});
 p.stdin.end("set qa.uid='11111111-1111-4111-8111-111111111111';set qa.papel='marcador';\n"+sql);return{ready,done};
}
async function query(s){const r=await client(s).done;assert.equal(r.code,0,r.err);return r.out;}
async function bloqueou(app){for(let i=0;i<40;i++){if(await query("select count(*) from pg_stat_activity where application_name='"+app+"' and wait_event_type='Lock'")==='1')return;await new Promise(r=>setTimeout(r,40));}assert.fail('nao aguardou lock '+app);}
const cad=name=>"select qa.clientes058(jsonb_build_array(qa.cliente058('34567890123',repeat('d',64),'"+name+"')));";
const ped="select qa.receber058(jsonb_build_array(qa.pedido058(10004,repeat('d',64))));";
test('058 PG: cadastro primeiro serializa pedido e ambos usam endereco novo',{skip:!db,timeout:12000},async()=>{
 const c=client("begin;"+cad('Pessoa Atualizada')+"\n\\echo CPF_LOCKED\nselect pg_sleep(3);commit;",true);await c.ready;
 const p=client("set application_name='cpf_pedido_espera';"+ped);await bloqueou('cpf_pedido_espera');assert.equal((await c.done).code,0);const r=await p.done;assert.equal(r.code,0,r.err);
 assert.equal(await query("select cliente_nome||':'||entrega_logradouro from public.solidcon_pedidos_erp where cd_pedido=10004"),'Pessoa Atualizada:Rua CPF QA');
});
test('058 PG: pedido primeiro serializa cadastro; callback completa mesma pessoa',{skip:!db,timeout:12000},async()=>{
 const p=client("begin;"+ped+"\n\\echo CPF_LOCKED\nselect pg_sleep(3);commit;",true);await p.ready;
 const c=client("set application_name='cpf_cadastro_espera';"+cad('Pessoa Sincronizada'));await bloqueou('cpf_cadastro_espera');assert.equal((await p.done).code,0);const r=await c.done;assert.equal(r.code,0,r.err);
 assert.equal(await query("select cliente_nome||':'||entrega_logradouro from public.solidcon_pedidos_erp where cd_pedido=10004"),'Pessoa Sincronizada:Rua CPF QA');
 assert.equal(await query("select count(*) from public.solidcon_pedidos_erp where documento is not null and cliente_tipo='cpf'"),'0');
});
