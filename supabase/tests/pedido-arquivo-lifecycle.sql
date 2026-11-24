\set ON_ERROR_STOP on
-- Executar apos pedido-arquivo.sql no mesmo banco local.
do $$begin if current_database() !~ '^sentinela_separando_arquivo' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local';end if;end$$;
set qa.papel='marcador';set qa.uid='11111111-1111-4111-8111-111111111111';
create temporary table antes_arq as select
 (select jsonb_agg(to_jsonb(a) order by cd_pedido) from public.pedido_arquivo a) arq,
 (select jsonb_agg(to_jsonb(f) order by cd_pedido,caminho) from public.pedido_arquivo_foto f) fotos;
\ir ../../admin/migracoes/057_pedido_arquivo.sql
\ir ../../admin/migracoes/057_pedido_arquivo.sql
select qa.check((select arq is not distinct from(select jsonb_agg(to_jsonb(a) order by cd_pedido) from public.pedido_arquivo a)
 and fotos is not distinct from(select jsonb_agg(to_jsonb(f) order by cd_pedido,caminho) from public.pedido_arquivo_foto f) from antes_arq),'arquivo reaplicar preserva snapshot e timestamps');
-- Escrit?rio pode anexar depois da poda, usando o snapshot existente, sem mudar valor/documento.
insert into storage.objects(bucket_id,name) values('canhotos','2026-11-24/5001/12121212-1212-4212-8212-121212121212.jpg');
select public.rota_052_registrar('2026-11-24/5001/12121212-1212-4212-8212-121212121212.jpg',array[5001]::bigint[],false);
select qa.check((select count(*)=3 from public.pedido_arquivo_foto where cd_pedido=5001) and(select valor_centavos=400000 from public.pedido_arquivo where cd_pedido=5001),'arquivo novo anexo em pedido fora da fonte');
select public.rota_052_registrar('2026-11-24/5001/12121212-1212-4212-8212-121212121212.jpg',array[5001]::bigint[],false);
select qa.check((select count(*)=3 from public.pedido_arquivo_foto where cd_pedido=5001),'arquivo retry nao duplica vinculo');
set qa.papel='admin';
select public.rota_052_remover(5001,'2026-11-24/5001/12121212-1212-4212-8212-121212121212.jpg');
select qa.check((select removido_em is not null from public.pedido_arquivo_foto where cd_pedido=5001 and caminho like '%12121212%'),'arquivo remocao manual anotada sem perder referencia do arquivo');
-- Instante de fronteira numa transacao: um ano EXATO ainda preservado.
begin;
insert into storage.objects(bucket_id,name,created_at) values('canhotos','2025-11-24/7001/13131313-1313-4313-8313-131313131313.jpg',((now() at time zone 'America/Sao_Paulo')-interval '1 year') at time zone 'America/Sao_Paulo');
insert into public.pedido_canhoto(cd_pedido,caminho,origem,enviado_em) values(7001,'2025-11-24/7001/13131313-1313-4313-8313-131313131313.jpg','painel',((now() at time zone 'America/Sao_Paulo')-interval '1 year') at time zone 'America/Sao_Paulo');
select jsonb_array_length(public.rota_052_limpeza_lote(100)->'caminhos')=0 as fronteira_arq \gset
rollback;
select qa.check(:'fronteira_arq'::boolean,'arquivo fronteira exatamente1ano preservada');
select count(*) as checks_arquivo from qa.checks where nome like 'arquivo%';
