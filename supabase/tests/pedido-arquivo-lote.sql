\set ON_ERROR_STOP on
do $$begin if current_database() !~ '^sentinela_separando_arquivo' or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'somente fixture local';end if;end$$;
set qa.papel='marcador';set qa.uid='11111111-1111-4111-8111-111111111111';
insert into public.solidcon_pedidos_erp(cd_pedido,dt_pedido,etapa,cliente_tipo,documento,cliente_nome,valor_centavos,caixas_24)
 select n,now(),'aberto','cnpj','11222333000181','Lote51',10000,1 from generate_series(8101,8151)n;
insert into storage.objects(bucket_id,name) values('canhotos','2026-11-24/8101/15151515-1515-4515-8515-151515151515.jpg');
select qa.check(public.rota_052_registrar('2026-11-24/8101/15151515-1515-4515-8515-151515151515.jpg',array(select generate_series(8101,8151))::bigint[],false)=51,'arquivo foto51 pedidos nao trunca');
select qa.check((select count(*)=51 from public.pedido_arquivo where cd_pedido between 8101 and 8151) and(select count(*)=51 from public.pedido_arquivo_foto where caminho='2026-11-24/8101/15151515-1515-4515-8515-151515151515.jpg'),'arquivo lote51 atomico com snapshot e vinculo');
select count(*) as checks_arquivo from qa.checks where nome like 'arquivo%';
