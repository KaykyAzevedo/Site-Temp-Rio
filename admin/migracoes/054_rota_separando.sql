-- 054: SEPARANDO entra automaticamente na rota fechada de HOJE. Nao publica rota_saida.
-- Requer 040/044/045/047/050. Idempotente; rollback preserva inclusoes como 'adicionado'.
-- Proposta/ordem vem do MESMO rota-core do painel/WhatsApp; candidatos sao recalculados aqui.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_catalog.pg_advisory_xact_lock(5100,54);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regprocedure('public.rota_050_ler(date)') is null or to_regprocedure('public.pode_marcar_rota()') is null
    or to_regprocedure('auth.role()') is null or to_regclass('public.rota_pedido_veiculo') is null
    or to_regclass('public.rota_cliente_veiculo') is null or to_regclass('public.rota_pedido_ignorado') is null then
   raise exception '054 requer 040/044/045/047/050 e Auth. Nada aplicado.';
 end if;
end$$;
alter table public.rota_dia_item drop constraint if exists rota_dia_item_origem_check;
alter table public.rota_dia_item drop constraint if exists rota_dia_item_054_origem_check;
alter table public.rota_dia_item add constraint rota_dia_item_054_origem_check check(origem in ('previsao','adicionado','separando'));
create index if not exists rota_dia_item_054_removido_doc_idx on public.rota_dia_item(data,documento) where removido_em is not null;

-- Padrao fixo do dono. Manter igual a ROTA.VEICULO_SEPARANDO no rota-core; teste confere os dois.
create or replace function public.rota_054_padrao_separando()
returns text language sql immutable set search_path='' as $$select 's10'::text$$;
revoke all on function public.rota_054_padrao_separando() from public,anon,authenticated,service_role;

-- Mesmo calendario do rota-core: domingo, dias do veiculo, feriados fixos/moveis e extras da040.
create or replace function public.rota_054_tem_saida(p_data date,p_veiculo text)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare
 v_dias smallint[]; v_feriados boolean; v_extras date[]; v_ano integer; v_pascoa date;
 a integer;b integer;c integer;d integer;e integer;f integer;g integer;h integer;i integer;k integer;l integer;m integer;
begin
 if p_data is null or extract(dow from p_data)=0 then return false;end if;
 select v.dias_sem_saida into v_dias from public.rota_veiculos v where v.id=p_veiculo and v.ativo;
 if not found or extract(dow from p_data)::smallint=any(v_dias) then return false;end if;
 select r.feriados_sem_saida,r.feriados_extras into v_feriados,v_extras from public.rota_config r where r.id=1;
 if coalesce(v_feriados,true) then
   if pg_catalog.to_char(p_data,'MM-DD')=any(array['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'])
      or p_data=any(coalesce(v_extras,'{}'::date[])) then return false;end if;
   v_ano:=extract(year from p_data)::integer;
   a:=v_ano%19;b:=v_ano/100;c:=v_ano%100;d:=b/4;e:=b%4;f:=(b+8)/25;g:=(b-f+1)/3;
   h:=(19*a+b-d-g+15)%30;i:=c/4;k:=c%4;l:=(32+2*e+2*i-h-k)%7;m:=(a+11*h+22*l)/451;
   v_pascoa:=pg_catalog.make_date(v_ano,(h+l-7*m+114)/31,(h+l-7*m+114)%31+1);
   if p_data=any(array[v_pascoa-48,v_pascoa-47,v_pascoa-2,v_pascoa+60]) then return false;end if;
 end if;
 return true;
end$$;
revoke all on function public.rota_054_tem_saida(date,text) from public,anon,authenticated,service_role;

create or replace function public.rota_054_candidatos(p_data date)
returns table(cd_pedido bigint,documento text,veiculo_id text)
language sql stable security definer set search_path=''
as $$
 select p.cd_pedido,p.documento,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando())
 from public.solidcon_pedidos_erp p
 left join public.rota_pedido_veiculo m on m.cd_pedido=p.cd_pedido
 left join public.rota_cliente_veiculo c on c.documento=p.documento
 where p.etapa='separando'
   and public.rota_054_tem_saida(p_data,coalesce(m.veiculo,c.veiculo,public.rota_054_padrao_separando()))
   and not exists(select 1 from public.rota_pedido_ignorado g where g.cd_pedido=p.cd_pedido)
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.cd_pedido=p.cd_pedido)
   -- RF-3: remover de hoje tira o cliente inteiro, inclusive pedidos que chegam depois.
   and not exists(select 1 from public.rota_dia_item x where x.data=p_data and x.removido_em is not null and x.documento=p.documento)
 order by p.cd_pedido
$$;
revoke all on function public.rota_054_candidatos(date) from public,anon,authenticated,service_role;

-- Fechamento inicial (050) tambem conserva a origem dos pedidos admitidos enquanto separando.
create or replace function public.rota_054_origem()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 if new.origem='previsao' and exists(select 1 from public.solidcon_pedidos_erp p where p.cd_pedido=new.cd_pedido and p.etapa='separando') then
   new.origem:='separando';
 end if;
 return new;
end$$;
revoke all on function public.rota_054_origem() from public,anon,authenticated,service_role;
drop trigger if exists rota_054_origem on public.rota_dia_item;
create trigger rota_054_origem before insert on public.rota_dia_item for each row execute function public.rota_054_origem();

-- RPC do tique (service_role) e da carga do painel (somente quem pode marcar rota).
-- p_ordem=[{cd_pedido,veiculo_id,ordem}] cobre EXATAMENTE os ativos salvos + novos dos veiculos afetados.
create or replace function public.rota_054_incluir(p_data date,p_revisao integer,p_ordem jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_hoje date:=public.rota_050_hoje(); v_rev integer; v_estado text; v_novos jsonb; v_veics text[];
 v_esperados jsonb; v_recebidos jsonb; v_n integer; v_uid uuid:=auth.uid();
begin
 if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.pode_marcar_rota(),false) then
   raise exception 'sem permissao para incluir separando' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 if p_data is distinct from v_hoje then raise exception 'o dia mudou: atualize a rota' using errcode='40001';end if;
 select f.revisao,f.estado into v_rev,v_estado from public.rota_dia_fechada f where f.data=v_hoje for update;
 if not found or v_estado<>'fechada' then return pg_catalog.jsonb_build_object('incluidos',0,'motivo','aberta');end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.cd_pedido),'[]'::jsonb)
   into v_novos from public.rota_054_candidatos(v_hoje) c;
 v_n:=pg_catalog.jsonb_array_length(v_novos);
 -- Retry sem nada novo nao altera revisao/log, mesmo que a resposta anterior se tenha perdido.
 if v_n=0 then return pg_catalog.jsonb_build_object('incluidos',0,'revisao',v_rev,'foto',public.rota_050_ler(v_hoje));end if;
 if p_revisao is distinct from v_rev then raise exception 'a rota mudou: recalcule a proposta' using errcode='40001';end if;
 if p_ordem is null or pg_catalog.jsonb_typeof(p_ordem)<>'array' then raise exception 'ordem invalida' using errcode='22023';end if;
 if pg_catalog.jsonb_array_length(p_ordem)>10000 or exists(select 1 from pg_catalog.jsonb_array_elements(p_ordem) x
    where pg_catalog.jsonb_typeof(x) is distinct from 'object'
       or pg_catalog.jsonb_typeof(x->'cd_pedido') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x->'veiculo_id') is distinct from 'string'
       or pg_catalog.jsonb_typeof(x->'ordem') is distinct from 'number') then
   raise exception 'ordem invalida' using errcode='22023';
 end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_ordem) x
     where (x->>'cd_pedido')::numeric not between 1 and 999999999999 or (x->>'cd_pedido')::numeric<>pg_catalog.trunc((x->>'cd_pedido')::numeric)
        or (x->>'ordem')::numeric not between 1 and 100000 or (x->>'ordem')::numeric<>pg_catalog.trunc((x->>'ordem')::numeric))
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_ordem) x group by x->>'cd_pedido' having count(*)>1) then
   raise exception 'ordem invalida ou pedido duplicado' using errcode='22023';
 end if;
 select pg_catalog.array_agg(distinct x->>'veiculo_id') into v_veics from pg_catalog.jsonb_array_elements(v_novos) x;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(e.cd,e.veic) order by e.cd) into v_esperados from (
   select i.cd_pedido cd,i.veiculo_id veic from public.rota_dia_item i where i.data=v_hoje and i.veiculo_id=any(v_veics) and i.removido_em is null
   union all select (x->>'cd_pedido')::bigint,x->>'veiculo_id' from pg_catalog.jsonb_array_elements(v_novos) x
 ) e;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array((x->>'cd_pedido')::bigint,x->>'veiculo_id') order by (x->>'cd_pedido')::bigint)
   into v_recebidos from pg_catalog.jsonb_array_elements(p_ordem) x;
 if v_esperados is distinct from v_recebidos then
   raise exception 'pedidos/veiculos mudaram: recalcule a proposta' using errcode='40001';
 end if;
 insert into public.rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem,origem,incluido_por)
 select v_hoje,(x->>'cd_pedido')::bigint,x->>'documento',x->>'veiculo_id',null,'separando',v_uid
 from pg_catalog.jsonb_array_elements(v_novos) x;
 update public.rota_dia_item i set ordem=(x->>'ordem')::integer from pg_catalog.jsonb_array_elements(p_ordem) x
 where i.data=v_hoje and i.cd_pedido=(x->>'cd_pedido')::bigint;
 update public.rota_dia_fechada set alterada_em=pg_catalog.now(),revisao=revisao+1 where data=v_hoje;
 insert into public.rota_dia_log(data,acao,detalhe,por,por_nome)
 values(v_hoje,'adicionar',pg_catalog.left('Separando automatico: '||v_n||' pedido(s); veiculos '||pg_catalog.array_to_string(v_veics,','),200),v_uid,public.rota_050_nome(v_uid));
 return pg_catalog.jsonb_build_object('incluidos',v_n,'revisao',v_rev+1,'foto',public.rota_050_ler(v_hoje));
end$$;
revoke all on function public.rota_054_incluir(date,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rota_054_incluir(date,integer,jsonb) to authenticated,service_role;
commit;
