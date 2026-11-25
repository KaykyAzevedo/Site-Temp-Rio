-- SOMENTE PROPOSTA. NAO E MIGRACAO. Executar apenas pelo TL apos confirmacao do dono.
-- Conferir as consultas de antes/depois e trocar o ROLLBACK FINAL por COMMIT so para aplicar.
-- Antes: retirar a publicacao dos veiculos afetados de25/11 no painel (se houver).
-- Depois de aplicar: Atualizar Rotas, conferir ordem/veiculo e REPUBLICAR para o motorista.
-- Nenhum canhoto, progresso ou publicacao e apagado por este arquivo.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
-- Descomentar SOMENTE apos aprovacao explicita do dono/TL:
-- set local temprio.confirmar_reparo_pos_saida='2026-11-24>2026-11-25';
select pg_catalog.pg_advisory_xact_lock(5100,61);
select pg_catalog.pg_advisory_xact_lock(5100,5201);
select pg_catalog.pg_advisory_xact_lock(5100,5001);
select data,cd_pedido,veiculo_id,ordem,origem,incluido_em,removido_em from public.rota_dia_item
 where data in ('2026-11-24','2026-11-25') and cd_pedido=any(array[1531,1535,1536,1537,1539,1540,1541,1543,1544]::bigint[])
 order by data,veiculo_id,ordem,cd_pedido;
do $$
declare
 cds constant bigint[]:=array[1531,1535,1536,1537,1539,1540,1541,1543,1544];
 marca constant text:='Reparo pos-saida 25/11';
begin
 if pg_catalog.current_setting('temprio.confirmar_reparo_pos_saida',true) is distinct from '2026-11-24>2026-11-25' then
   raise exception 'PROPOSTA: falta confirmacao do dono/TL; nenhum item movido';
 end if;
 if to_regprocedure('public.rota_061_auto_aberta(date)') is null then raise exception 'Aplicar061 antes do reparo';end if;
 perform 1 from public.rota_dia_fechada where data in ('2026-11-24','2026-11-25') order by data for update;
 if (select count(*) from public.rota_dia_fechada where data in ('2026-11-24','2026-11-25') and estado='fechada')<>2 then
   raise exception 'Reparo requer ambas as fotos fechadas; revisar estado atual';
 end if;
 -- Replay completo e verificavel: nao duplica itens, revisao nem log.
 if (select count(*) from public.rota_dia_item a join public.rota_dia_item b on b.cd_pedido=a.cd_pedido and b.data='2026-11-25'
      where a.data='2026-11-24' and a.cd_pedido=any(cds) and a.removido_em is not null and a.removido_nome=marca
        and b.removido_em is null and b.veiculo_id=a.veiculo_id and b.origem='adicionado')=9 then
   raise notice 'Reparo ja aplicado aos9 pedidos; sem alteracao';return;
 end if;
 if (select count(*) from public.rota_dia_item where data='2026-11-24' and cd_pedido=any(cds) and removido_em is null
       and origem='separando' and incluido_em>'2026-11-24T08:00:00-03'::timestamptz)=9
    and not exists(select from public.rota_dia_item where data='2026-11-25' and cd_pedido=any(cds)) then null;
 else raise exception 'Foto divergiu: faltam itens ativos/origem separando ou ja ha itens no destino. Revisao manual necessaria';end if;
 if exists(select from public.pedido_canhoto where cd_pedido=any(cds) and substituido_em is null) then
   raise exception 'Ha canhoto ativo: confirmar entrega antes de mover';
 end if;
 if to_regclass('public.pedido_entrega_confirmacao') is not null then
   if exists(select from public.pedido_entrega_confirmacao where cd_pedido=any(cds) and desfeito_em is null) then
     raise exception 'Ha pedido marcado Recebido: revisar com o dono antes de mover';
   end if;
 end if;
 -- Serializa com edicao/publicacao047; nao deixa uma versao publicada antiga receber baixas novas.
 lock table public.rota_saida in share row exclusive mode;
 if exists(select from public.rota_saida s where s.data='2026-11-25' and s.veiculo_id in
      (select veiculo_id from public.rota_dia_item where data='2026-11-24' and cd_pedido=any(cds))) then
   raise exception 'Retire a publicacao dos veiculos afetados de25/11 no painel e revise antes de reaplicar';
 end if;
 insert into public.rota_dia_item(data,cd_pedido,documento,veiculo_id,ordem,origem,incluido_por)
 select date '2026-11-25',a.cd_pedido,a.documento,a.veiculo_id,
    (coalesce((select max(b.ordem) from public.rota_dia_item b where b.data='2026-11-25' and b.veiculo_id=a.veiculo_id and b.removido_em is null),0)
      +row_number() over(partition by a.veiculo_id order by a.ordem nulls last,a.cd_pedido))::integer,
    'adicionado',auth.uid()
 from public.rota_dia_item a where a.data='2026-11-24' and a.cd_pedido=any(cds);
 update public.rota_dia_item set removido_em=pg_catalog.now(),removido_por=auth.uid(),removido_nome=marca,ordem=null
  where data='2026-11-24' and cd_pedido=any(cds);
 update public.rota_dia_fechada set revisao=revisao+1,alterada_em=pg_catalog.now() where data in ('2026-11-24','2026-11-25');
 insert into public.rota_dia_log(data,acao,detalhe,por,por_nome) values
 ('2026-11-24','remover','Reparo pos-saida:1531,1535,1536,1537,1539,1540,1541,1543,1544 para25/11',auth.uid(),marca),
 ('2026-11-25','adicionar','Reparo pos-saida:1531,1535,1536,1537,1539,1540,1541,1543,1544 de24/11; conferir ordem e republicar',auth.uid(),marca);
end$$;
select data,cd_pedido,veiculo_id,ordem,origem,removido_em from public.rota_dia_item
 where data in ('2026-11-24','2026-11-25') and cd_pedido=any(array[1531,1535,1536,1537,1539,1540,1541,1543,1544]::bigint[])
 order by data,veiculo_id,ordem,cd_pedido;
rollback; -- DEFAULT SEGURO: trocar por COMMIT somente para aplicar o reparo aprovado.
