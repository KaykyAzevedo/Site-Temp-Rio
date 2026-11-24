-- 057: arquivo do pedido + comprovantes, independente da janela volatil do ERP.
-- Requer039/052/055/056. Sem escrita no ERP. Desinstalacao nao apaga acervo.
begin;
set local lock_timeout='5s';set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(5100,57);
select pg_catalog.pg_advisory_xact_lock(5100,35);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
do $$begin
 if to_regprocedure('public.rota_055_pendente(bigint,date)') is null or to_regclass('public.rota_config') is null
 or not exists(select 1 from pg_attribute where attrelid='public.rota_config'::regclass and attname='canhoto_desde' and not attisdropped) then
  raise exception '057 requer039/052/055/056. Nada aplicado.';
 end if;
 if exists(select 1 from public.rota_052_expurgo where concluido_em is null) then
  raise exception '057: aguarde concluir os lotes de expurgo pendentes antes de instalar/reaplicar.';
 end if;
end$$;
lock table public.solidcon_pedidos_erp in share row exclusive mode nowait;
lock table public.pedido_canhoto in access exclusive mode nowait;
alter table public.pedido_canhoto add column if not exists rota_data date,add column if not exists rota_veiculo text,add column if not exists rota_versao integer;
alter table public.pedido_canhoto drop constraint if exists pedido_canhoto_057_contexto;
alter table public.pedido_canhoto add constraint pedido_canhoto_057_contexto check(
 (rota_data is null and rota_veiculo is null and rota_versao is null) or
 (rota_data is not null and rota_veiculo is not null and rota_versao is not null and rota_versao>0));
create table if not exists public.pedido_arquivo(
 cd_pedido bigint primary key check(cd_pedido between 1 and 999999999999),
 dt_pedido timestamptz,dt_faturado timestamptz,
 cliente_tipo text not null default 'indefinido' check(cliente_tipo in('cnpj','cpf','indefinido')),
 cliente_nome text check(cliente_nome is null or char_length(cliente_nome)<=150),documento text,
 logradouro text,numero text,complemento text,bairro text,cidade text,uf text,cep text,endereco_texto text,endereco_origem text,
 valor_centavos bigint check(valor_centavos is null or valor_centavos between 0 and 999999999999999),
 caixas_24 integer check(caixas_24 is null or caixas_24 between 0 and 100000),
 caixas_48 integer check(caixas_48 is null or caixas_48 between 0 and 100000),
 caixas_outras integer check(caixas_outras is null or caixas_outras between 0 and 100000),nr_carga bigint,
 rota_data date,rota_versao integer,veiculo_id text,veiculo_nome text,motorista_id uuid,motorista_nome text,contexto_origem text,
 ultimo_canhoto_em timestamptz not null check(isfinite(ultimo_canhoto_em)),
 dados_incompletos boolean not null default true,
 arquivado_em timestamptz not null default now(),atualizado_em timestamptz not null default now(),
 constraint pedido_arquivo_057_sem_cpf check(documento is null or(cliente_tipo='cnpj' and documento ~ '^[0-9]{14}$')),
 constraint pedido_arquivo_057_datas check((dt_pedido is null or isfinite(dt_pedido)) and(dt_faturado is null or isfinite(dt_faturado)))
);
create index if not exists pedido_arquivo_057_ultimo_idx on public.pedido_arquivo(ultimo_canhoto_em desc,cd_pedido desc);
create index if not exists pedido_arquivo_057_doc_idx on public.pedido_arquivo(documento) where documento is not null;
create index if not exists pedido_arquivo_057_faturado_idx on public.pedido_arquivo((coalesce(dt_faturado,dt_pedido,arquivado_em)));
create table if not exists public.pedido_arquivo_foto(
 cd_pedido bigint not null references public.pedido_arquivo(cd_pedido) on delete cascade,
 caminho text not null check(public.rota_052_caminho_valido(caminho)),
 enviado_em timestamptz not null,origem text not null check(origem in('motorista','painel')),
 substituido_em timestamptz,removido_em timestamptz,
 primary key(cd_pedido,caminho)
);
create index if not exists pedido_arquivo_foto_057_caminho_idx on public.pedido_arquivo_foto(caminho);
alter table public.pedido_arquivo enable row level security;
alter table public.pedido_arquivo_foto enable row level security;
revoke all on public.pedido_arquivo,public.pedido_arquivo_foto from public,anon,authenticated;
grant select on public.pedido_arquivo,public.pedido_arquivo_foto to authenticated;
drop policy if exists pedido_arquivo_057_equipe on public.pedido_arquivo;
create policy pedido_arquivo_057_equipe on public.pedido_arquivo for select to authenticated using((select public.eh_equipe()));
drop policy if exists pedido_arquivo_foto_057_equipe on public.pedido_arquivo_foto;
create policy pedido_arquivo_foto_057_equipe on public.pedido_arquivo_foto for select to authenticated using((select public.eh_equipe()));

-- A052 legada validava formato, mas nao o calendario do nome do arquivo.
create or replace function public.rota_057_dia_caminho(p_caminho text)
returns date language plpgsql immutable set search_path=''
as $$begin return split_part(p_caminho,'/',1)::date;
exception when datetime_field_overflow or invalid_datetime_format then return null;end$$;
revoke all on function public.rota_057_dia_caminho(text) from public,anon,authenticated,service_role;

create or replace function public.rota_057_guardar(p_cds bigint[])
returns integer language plpgsql security definer set search_path=''
as $$declare v_n integer;begin
 if p_cds is null or cardinality(p_cds)=0 then return 0;end if;
 with ids as(select distinct unnest(p_cds) cd_pedido),
 recentes as materialized(select distinct on(c.cd_pedido) c.* from public.pedido_canhoto c join ids using(cd_pedido) order by c.cd_pedido,c.enviado_em desc,c.id desc),
 limites as(select c.cd_pedido,max(c.enviado_em) ultimo from public.pedido_canhoto c join ids using(cd_pedido) group by c.cd_pedido),
 rotas as materialized(
  select s.data,s.veiculo_id,s.versao,s.publicado_em,(ped#>>'{}')::bigint cd_pedido,
   sp->>'endereco' endereco,it->>'nome' cliente_nome
  from public.rota_saida s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.paradas)='array' then s.paradas else '[]'::jsonb end) sp
  cross join lateral jsonb_array_elements(case when jsonb_typeof(sp->'itens')='array' then sp->'itens' else jsonb_build_array(sp) end) it
  cross join lateral jsonb_array_elements(case when jsonb_typeof(it->'pedidos')='array' then it->'pedidos' else '[]'::jsonb end) ped
  where jsonb_typeof(ped)='number' and s.data in(select distinct public.rota_057_dia_caminho(caminho) from recentes)
 )
 insert into public.pedido_arquivo as arq(cd_pedido,dt_pedido,dt_faturado,cliente_tipo,cliente_nome,documento,logradouro,numero,complemento,bairro,cidade,uf,cep,endereco_texto,endereco_origem,valor_centavos,caixas_24,caixas_48,caixas_outras,nr_carga,rota_data,rota_versao,veiculo_id,veiculo_nome,motorista_id,motorista_nome,contexto_origem,ultimo_canhoto_em,dados_incompletos)
 select ids.cd_pedido,
  coalesce(p.dt_pedido,a.dt_pedido),
  coalesce(p.dt_saida,p.dt_nota,p.dt_atendido,a.dt_faturado),
  coalesce(nullif(p.cliente_tipo,'indefinido'),a.cliente_tipo,p.cliente_tipo,'indefinido'),
  coalesce(nullif(p.cliente_nome,''),nullif(cli.nome,''),a.cliente_nome,nullif(r.cliente_nome,'Consumidor final')),
  case when coalesce(nullif(p.cliente_tipo,'indefinido'),a.cliente_tipo,p.cliente_tipo)='cnpj' then coalesce(p.documento,a.documento) end,
  coalesce(nullif(to_jsonb(p)->>'entrega_logradouro',''),nullif(cli.logradouro,''),a.logradouro),
  coalesce(nullif(to_jsonb(p)->>'entrega_numero',''),nullif(cli.numero,''),a.numero),
  coalesce(nullif(to_jsonb(p)->>'entrega_complemento',''),nullif(cli.complemento,''),a.complemento),
  coalesce(nullif(to_jsonb(p)->>'entrega_bairro',''),nullif(cli.bairro,''),a.bairro),
  coalesce(nullif(to_jsonb(p)->>'entrega_cidade',''),nullif(cli.cidade,''),a.cidade),
  coalesce(nullif(to_jsonb(p)->>'entrega_uf',''),nullif(cli.estado,''),a.uf),
  nullif(regexp_replace(coalesce(nullif(to_jsonb(p)->>'entrega_cep',''),nullif(cli.cep,''),a.cep),'[^0-9]','','g'),''),
  coalesce(a.endereco_texto,r.endereco),
  case when nullif(to_jsonb(p)->>'entrega_logradouro','') is not null then 'pedido' when cli.logradouro is not null then 'cadastro' else coalesce(a.endereco_origem,case when r.endereco is not null then 'rota' end) end,
  coalesce(p.valor_centavos,a.valor_centavos),
  coalesce(p.caixas_24,a.caixas_24),
  coalesce(p.caixas_48,a.caixas_48),
  coalesce(p.caixas_outras,a.caixas_outras),
  coalesce(p.nr_carga,a.nr_carga),
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(r.data,a.rota_data) else a.rota_data end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(r.versao,a.rota_versao) else a.rota_versao end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(r.veiculo_id,a.veiculo_id) else a.veiculo_id end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(v.nome,a.veiculo_nome) else a.veiculo_nome end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(m.user_id,a.motorista_id) else a.motorista_id end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(m.nome,a.motorista_nome) else a.motorista_nome end,
  case when a.ultimo_canhoto_em is null or cf.enviado_em>a.ultimo_canhoto_em then coalesce(case when r.veiculo_id is null then null when cf.rota_veiculo is not null then 'anexo_motorista' else 'publicacao_unica' end,a.contexto_origem) else a.contexto_origem end,
  greatest(l.ultimo,a.ultimo_canhoto_em),
  (coalesce(p.dt_pedido,a.dt_pedido) is null or coalesce(nullif(p.cliente_nome,''),nullif(cli.nome,''),a.cliente_nome,nullif(r.cliente_nome,'Consumidor final')) is null or coalesce(p.valor_centavos,a.valor_centavos) is null)
 from ids join recentes cf using(cd_pedido) join limites l using(cd_pedido)
 left join public.solidcon_pedidos_erp p using(cd_pedido)
 left join public.pedido_arquivo a using(cd_pedido)
 left join public.solidcon_clientes cli on p.cliente_tipo='cnpj' and cli.tipo='cnpj' and cli.documento=p.documento
 left join lateral(
  select z.* from(select rr.*,count(*) over() n from rotas rr where rr.cd_pedido=ids.cd_pedido
   and rr.data=coalesce(cf.rota_data,public.rota_057_dia_caminho(cf.caminho))
   and(cf.rota_veiculo is null or rr.veiculo_id=cf.rota_veiculo)
   and(cf.rota_versao is null or rr.versao=cf.rota_versao) and rr.publicado_em<=cf.enviado_em) z where z.n=1
 ) r on true
 left join public.rota_veiculos v on v.id=r.veiculo_id
 left join lateral(
  select z.* from(select mm.*,count(*) over() n from public.rota_motoristas mm
   where(cf.origem='motorista' and mm.user_id=cf.enviado_por) or(cf.origem='painel' and mm.veiculo_id=r.veiculo_id and mm.ativo)) z where z.n=1
 ) m on true
 on conflict(cd_pedido) do update set
 dt_pedido=excluded.dt_pedido,
 dt_faturado=excluded.dt_faturado,
 cliente_tipo=excluded.cliente_tipo,
 cliente_nome=excluded.cliente_nome,
 documento=excluded.documento,
 logradouro=excluded.logradouro,
 numero=excluded.numero,
 complemento=excluded.complemento,
 bairro=excluded.bairro,
 cidade=excluded.cidade,
 uf=excluded.uf,
 cep=excluded.cep,
 endereco_texto=excluded.endereco_texto,
 endereco_origem=excluded.endereco_origem,
 valor_centavos=excluded.valor_centavos,
 caixas_24=excluded.caixas_24,
 caixas_48=excluded.caixas_48,
 caixas_outras=excluded.caixas_outras,
 nr_carga=excluded.nr_carga,
 rota_data=excluded.rota_data,
 rota_versao=excluded.rota_versao,
 veiculo_id=excluded.veiculo_id,
 veiculo_nome=excluded.veiculo_nome,
 motorista_id=excluded.motorista_id,
 motorista_nome=excluded.motorista_nome,
 contexto_origem=excluded.contexto_origem,
 ultimo_canhoto_em=excluded.ultimo_canhoto_em,
 dados_incompletos=excluded.dados_incompletos,atualizado_em=pg_catalog.now()
 where row(arq.dt_pedido,arq.dt_faturado,arq.cliente_tipo,arq.cliente_nome,arq.documento,arq.logradouro,arq.numero,arq.complemento,arq.bairro,arq.cidade,arq.uf,arq.cep,arq.endereco_texto,arq.endereco_origem,arq.valor_centavos,arq.caixas_24,arq.caixas_48,arq.caixas_outras,arq.nr_carga,arq.rota_data,arq.rota_versao,arq.veiculo_id,arq.veiculo_nome,arq.motorista_id,arq.motorista_nome,arq.contexto_origem,arq.ultimo_canhoto_em,arq.dados_incompletos) is distinct from row(excluded.dt_pedido,excluded.dt_faturado,excluded.cliente_tipo,excluded.cliente_nome,excluded.documento,excluded.logradouro,excluded.numero,excluded.complemento,excluded.bairro,excluded.cidade,excluded.uf,excluded.cep,excluded.endereco_texto,excluded.endereco_origem,excluded.valor_centavos,excluded.caixas_24,excluded.caixas_48,excluded.caixas_outras,excluded.nr_carga,excluded.rota_data,excluded.rota_versao,excluded.veiculo_id,excluded.veiculo_nome,excluded.motorista_id,excluded.motorista_nome,excluded.contexto_origem,excluded.ultimo_canhoto_em,excluded.dados_incompletos);
 get diagnostics v_n=row_count;
 insert into public.pedido_arquivo_foto as foto(cd_pedido,caminho,enviado_em,origem,substituido_em,removido_em)
 select c.cd_pedido,c.caminho,c.enviado_em,c.origem,c.substituido_em,null from public.pedido_canhoto c where c.cd_pedido=any(p_cds)
 on conflict(cd_pedido,caminho) do update set enviado_em=excluded.enviado_em,origem=excluded.origem,substituido_em=excluded.substituido_em,removido_em=null
 where row(foto.enviado_em,foto.origem,foto.substituido_em,foto.removido_em) is distinct from row(excluded.enviado_em,excluded.origem,excluded.substituido_em,null);
 return v_n;
end$$;
revoke all on function public.rota_057_guardar(bigint[]) from public,anon,authenticated,service_role;

create or replace function public.rota_057_fonte_travar()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 if tg_op in('DELETE','TRUNCATE') then
  perform public.rota_057_guardar(array(select distinct p.cd_pedido from public.solidcon_pedidos_erp p join public.pedido_canhoto c using(cd_pedido)));
 end if;
 return null;
end$$;
create or replace function public.rota_057_fonte_depois()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 perform public.rota_057_guardar(array(select distinct cd_pedido from fonte057));return null;
end$$;
create or replace function public.rota_057_canhoto_depois()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 perform pg_catalog.pg_advisory_xact_lock(5100,5201);
 perform pg_catalog.pg_advisory_xact_lock(5100,5001);
 if tg_op='DELETE' then
  update public.pedido_arquivo_foto f set removido_em=pg_catalog.now()
   from antigos057 c where f.cd_pedido=c.cd_pedido and f.caminho=c.caminho and f.removido_em is null;
 else
  perform public.rota_057_guardar(array(select distinct cd_pedido from novos057));
 end if;
 return null;
end$$;
revoke all on function public.rota_057_fonte_travar(),public.rota_057_fonte_depois(),public.rota_057_canhoto_depois() from public,anon,authenticated,service_role;
drop trigger if exists rota_057_fonte_travar on public.solidcon_pedidos_erp;
create trigger rota_057_fonte_travar before insert or update or delete or truncate on public.solidcon_pedidos_erp for each statement execute function public.rota_057_fonte_travar();
drop trigger if exists rota_057_fonte_ins on public.solidcon_pedidos_erp;
create trigger rota_057_fonte_ins after insert on public.solidcon_pedidos_erp referencing new table as fonte057 for each statement execute function public.rota_057_fonte_depois();
drop trigger if exists rota_057_fonte_upd on public.solidcon_pedidos_erp;
create trigger rota_057_fonte_upd after update on public.solidcon_pedidos_erp referencing new table as fonte057 for each statement execute function public.rota_057_fonte_depois();
drop trigger if exists rota_057_canhoto_ins on public.pedido_canhoto;
create trigger rota_057_canhoto_ins after insert on public.pedido_canhoto referencing new table as novos057 for each statement execute function public.rota_057_canhoto_depois();
drop trigger if exists rota_057_canhoto_upd on public.pedido_canhoto;
create trigger rota_057_canhoto_upd after update on public.pedido_canhoto referencing new table as novos057 for each statement execute function public.rota_057_canhoto_depois();
drop trigger if exists rota_057_canhoto_del on public.pedido_canhoto;
create trigger rota_057_canhoto_del after delete on public.pedido_canhoto referencing old table as antigos057 for each statement execute function public.rota_057_canhoto_depois();
create or replace function public.rota_057_purgar()
returns integer language plpgsql security definer set search_path=''
as $$declare v_n integer;v_corte timestamptz:=((now() at time zone 'America/Sao_Paulo')-interval '1 year') at time zone 'America/Sao_Paulo';begin
 delete from public.pedido_arquivo a where a.ultimo_canhoto_em<v_corte
  and not exists(select 1 from public.pedido_canhoto c where c.cd_pedido=a.cd_pedido)
  and not exists(select 1 from public.pedido_arquivo_foto f join storage.objects o on o.bucket_id='canhotos' and o.name=f.caminho where f.cd_pedido=a.cd_pedido);
 get diagnostics v_n=row_count;return v_n;
end$$;
revoke all on function public.rota_057_purgar() from public,anon,authenticated,service_role;
create or replace function public.rota_057_buscar(p_busca text default '',p_de date default null,p_ate date default null,
 p_antes timestamptz default null,p_antes_cd bigint default null,p_limite integer default 50)
returns setof public.pedido_arquivo language plpgsql stable security invoker set search_path=''
as $$begin
 if not coalesce(public.eh_equipe(),false) then raise exception 'somente equipe consulta o arquivo' using errcode='42501';end if;
 if p_limite is null or p_limite not between 1 and 101 or char_length(coalesce(p_busca,''))>150
 or(p_de is not null and p_ate is not null and p_de>p_ate) or((p_antes is null)<>(p_antes_cd is null)) then
  raise exception 'filtro de arquivo invalido' using errcode='22023';
 end if;
 return query select a.* from public.pedido_arquivo a
 where(coalesce(btrim(p_busca),'')='' or(case when btrim(p_busca) ~ '^[0-9]{1,12}$' then a.cd_pedido=btrim(p_busca)::bigint else false end)
  or strpos(lower(coalesce(a.cliente_nome,'')),lower(btrim(p_busca)))>0
  or(length(regexp_replace(p_busca,'[^0-9]','','g'))=14 and a.documento=regexp_replace(p_busca,'[^0-9]','','g')))
 and(p_de is null or coalesce(a.dt_faturado,a.dt_pedido,a.arquivado_em)>=p_de::timestamp at time zone 'America/Sao_Paulo')
 and(p_ate is null or coalesce(a.dt_faturado,a.dt_pedido,a.arquivado_em)<(p_ate+1)::timestamp at time zone 'America/Sao_Paulo')
 and(p_antes is null or(a.ultimo_canhoto_em,a.cd_pedido)<(p_antes,p_antes_cd))
 order by a.ultimo_canhoto_em desc,a.cd_pedido desc limit p_limite;
end$$;
revoke all on function public.rota_057_buscar(text,date,date,timestamptz,bigint,integer) from public,anon;
grant execute on function public.rota_057_buscar(text,date,date,timestamptz,bigint,integer) to authenticated;
create or replace function public.rota_052_registrar(p_caminho text, p_cds bigint[], p_substituir boolean,
                                                   p_veiculo text default null, p_versao integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_veic text := public.rota_051_meu_veiculo();
  v_hoje date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
  v_origem text;
  v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  if not public.rota_052_arquivo_livre(p_caminho) then
    raise exception 'ARQUIVO_EXPIRADO: canhoto reservado para retencao; preserve a pendencia original' using errcode='P5105';
  end if;
  if p_cds is null or pg_catalog.cardinality(p_cds) not between 1 and 15050
     or exists (select 1 from pg_catalog.unnest(p_cds) x where x is null or x not between 1 and 999999999999)
     or public.rota_052_caminho_valido(p_caminho) is distinct from true then
    raise exception 'canhoto invalido' using errcode = '22023';
  end if;
  if pg_catalog.split_part(p_caminho, '/', 2)::bigint <> all (p_cds) then
    raise exception 'o caminho precisa ser de um dos pedidos' using errcode = '22023';
  end if;
  if coalesce(public.pode_marcar_rota(), false) then
    v_origem := 'painel';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p_caminho) then
      raise exception 'arquivo do canhoto nao encontrado' using errcode = 'P0002';
    end if;
    if exists(select 1 from pg_catalog.unnest(p_cds) x where not exists(select 1 from public.solidcon_pedidos_erp p where p.cd_pedido=x) and not exists(select 1 from public.pedido_arquivo a where a.cd_pedido=x)) then
      raise exception 'pedido nao existe no ERP' using errcode = 'P0002';
    end if;
  elsif v_veic is not null then
    v_origem := 'motorista';
    -- Mesma recusa P5101 para replay antigo; o cliente preserva a foto. A trava da rota vale ate COMMIT.
    perform public.rota_051_validar_contexto(pg_catalog.split_part(p_caminho, '/', 1)::date, p_veiculo, p_versao);
    v_veic := p_veiculo;   -- usa o vinculo travado/validado, nao a leitura anterior a essa trava
    if coalesce(p_substituir, false) then
      raise exception 'o motorista nao troca canhoto (so o escritorio)' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'canhotos' and o.name = p_caminho and o.owner = v_uid) then
      raise exception 'arquivo do canhoto nao encontrado' using errcode = 'P0002';
    end if;
    if exists (select 1 from pg_catalog.unnest(p_cds) x where x not in (select public.rota_051_cds_da_rota(v_hoje, v_veic))) then
      raise exception 'pedido nao esta na sua rota de hoje' using errcode = '42501';
    end if;
  else
    raise exception 'sem permissao para anexar canhoto' using errcode = '42501';
  end if;
  if exists(select 1 from public.pedido_arquivo_foto f join public.rota_052_expurgo q on q.caminho=f.caminho where f.cd_pedido=any(p_cds) and q.concluido_em is null) then
    raise exception 'ARQUIVO_EXPIRADO: pacote reservado para expurgo; preserve a pendencia' using errcode='P5105';
  end if;
  if coalesce(p_substituir, false) then
    update public.pedido_canhoto set substituido_em = pg_catalog.now(), substituido_por = v_uid
     where cd_pedido = any (p_cds) and substituido_em is null and caminho <> p_caminho;
  end if;
  insert into public.pedido_canhoto (cd_pedido, caminho, origem, enviado_por,rota_data,rota_veiculo,rota_versao)
  select distinct x,p_caminho,v_origem,v_uid,case when v_origem='motorista' then v_hoje end,case when v_origem='motorista' then p_veiculo end,case when v_origem='motorista' then p_versao end from pg_catalog.unnest(p_cds) x
  on conflict (cd_pedido, caminho) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.rota_052_limpeza_lote(p_limite integer default 100)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_corte timestamptz := ((pg_catalog.now() at time zone 'America/Sao_Paulo') - interval '1 year') at time zone 'America/Sao_Paulo';
  v_token uuid := pg_catalog.gen_random_uuid();
  v_caminhos text[];
  v_n integer;
begin
  if p_limite is null or p_limite not between 1 and 100 then
    raise exception 'limite de limpeza invalido' using errcode='22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(5100,5201) then
    return pg_catalog.jsonb_build_object('caminhos','[]'::jsonb,'ocupado',true);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  -- Vinculos expirados sem arquivo, com arquivo recente ou compartilhado com vinculo recente.
  -- O arquivo recente tem seu proprio prazo; a idade do vinculo nao e renovada por sobrescrita.
  delete from public.pedido_canhoto c where c.enviado_em < v_corte
    and not exists(select 1 from public.pedido_arquivo a where a.cd_pedido=c.cd_pedido and a.ultimo_canhoto_em>=v_corte) and (
    not exists(select 1 from storage.objects o where o.bucket_id='canhotos' and o.name=c.caminho)
    or exists(select 1 from storage.objects o where o.bucket_id='canhotos' and o.name=c.caminho and o.created_at>=v_corte)
    or exists(select 1 from public.pedido_canhoto n where n.caminho=c.caminho and n.enviado_em>=v_corte));
  get diagnostics v_n = row_count;
  insert into public.rota_052_expurgo(caminho,corte)
  select o.name,v_corte from storage.objects o
   where o.bucket_id='canhotos' and o.created_at<v_corte
     and not exists(select 1 from public.pedido_canhoto c where c.caminho=o.name and c.enviado_em>=v_corte)
     and not exists(select 1 from public.pedido_arquivo_foto f join public.pedido_arquivo a using(cd_pedido) where f.caminho=o.name and a.ultimo_canhoto_em>=v_corte)
  on conflict(caminho) do nothing;
  with candidatos as (
    select q.caminho from public.rota_052_expurgo q where q.concluido_em is null
      and (q.reservado_em is null or q.reservado_em<pg_catalog.now()-interval '10 minutes')
    order by q.criado_em,q.caminho limit p_limite for update
  ), reservados as (
    update public.rota_052_expurgo q set token=v_token,reservado_em=pg_catalog.now(),tentativas=q.tentativas+1
      from candidatos c where q.caminho=c.caminho returning q.caminho
  ) select pg_catalog.array_agg(caminho order by caminho) into v_caminhos from reservados;
  perform public.rota_057_purgar();
  return pg_catalog.jsonb_build_object('token',v_token,'caminhos',coalesce(v_caminhos,'{}'::text[]),'linhas',v_n);
end$$;

create or replace function public.rota_052_limpeza_confirmar(p_token uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(5100,5201);
  perform pg_catalog.pg_advisory_xact_lock(5100,5001);
  -- API removeu fisicamente? Nunca aceitar apenas a afirmacao do cliente/worker.
  if exists(select 1 from public.rota_052_expurgo q join storage.objects o on o.bucket_id='canhotos' and o.name=q.caminho
             where q.token=p_token and q.concluido_em is null) then
    raise exception 'arquivo ainda existe no Storage; lote preservado' using errcode='40001';
  end if;
  delete from public.pedido_canhoto c using public.rota_052_expurgo q
    where q.token=p_token and q.concluido_em is null and c.caminho=q.caminho and c.enviado_em<q.corte;
  get diagnostics v_n = row_count;
  update public.rota_052_expurgo set concluido_em=pg_catalog.now() where token=p_token and concluido_em is null;
  perform public.rota_057_purgar();
  return v_n;
end$$;
select public.rota_057_guardar(array(select distinct cd_pedido from public.pedido_canhoto));
notify pgrst,'reload schema';
commit;
