"""Gera os corpos do delta a partir de fontes aprovadas, sem alterar worktrees."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FORJA=ROOT.parent
REPO=Path('C:/Users/emporio/Downloads/TempRio-trabalho/worktrees/temp-rio-068')
def extract(text,name):
 start=text.index('create or replace function public.'+name+'(')
 end=text.index('$$;',start)+3 if 'end$$;' not in text[start:text.index('revoke ',start)] else text.index('end$$;',start)+7
 return text[start:end]+'\n'
def swaps(s,changes):
 for a,b in changes:
  assert a in s,a[:90]
  s=s.replace(a,b)
 return s
base=(REPO/'admin/migracoes/065_semana_plano.sql').read_text(encoding='utf-8')
salvar=extract(base,'rota_065_salvar_semana')
salvar=swaps(salvar,[
 ('  v_n integer;','  v_n integer; v_068_antes jsonb; v_068_cd bigint;'),
 ('  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);',"  perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);\n  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);"),
 ('where public.rota_065_travada(p.dia, p.veiculo_id)','where public.rota_068_pedido_entregue(p.cd_pedido)'),
 ("'motivo', 'dia_bloqueado', 'cd_pedido', v_cd, 'origem', true","'motivo', 'pedido_historico', 'cd_pedido', v_cd, 'origem', true"),
 ('  select (e ->> \'cd_pedido\')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e\n   where not public.rota_065_dia_editavel',"  select (e->>'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e where public.rota_068_pedido_entregue((e->>'cd_pedido')::bigint) limit 1;\n  if found then return pg_catalog.jsonb_build_object('status','erro','motivo','pedido_historico','cd_pedido',v_cd);end if;\n  select (e ->> 'cd_pedido')::bigint into v_cd from pg_catalog.jsonb_array_elements(p_itens) e\n   where not public.rota_065_dia_editavel"),
 ('  delete from public.rota_plano_semana p\n',"  select coalesce(jsonb_object_agg(p.cd_pedido,jsonb_build_object('dia',p.dia,'veiculo_id',p.veiculo_id,'removido',p.removido)),'{}'::jsonb) into v_068_antes from public.rota_plano_semana p where (p.dia between p_inicio and p_inicio+5 and (p_veiculo is null or p.veiculo_id=p_veiculo)) or p.cd_pedido in(select (e->>'cd_pedido')::bigint from jsonb_array_elements(p_itens) e);\n  delete from public.rota_plano_semana p\n"),
 ('and public.rota_065_linha_editavel(p.dia, p.veiculo_id)\n', 'and public.rota_065_linha_editavel(p.dia, p.veiculo_id) and not public.rota_068_pedido_entregue(p.cd_pedido)\n'),
 ('  perform public.rota_065_subir(p_inicio);',"  for v_068_cd in select distinct cd from (select key::bigint cd from jsonb_each(v_068_antes) union all select (e->>'cd_pedido')::bigint from jsonb_array_elements(p_itens) e) z loop\n   if coalesce(v_068_antes->v_068_cd::text,'null'::jsonb) is distinct from coalesce((select jsonb_build_object('dia',p.dia,'veiculo_id',p.veiculo_id,'removido',p.removido) from public.rota_plano_semana p where p.cd_pedido=v_068_cd),'null'::jsonb) and not public.rota_068_pedido_entregue(v_068_cd) then\n    perform public.rota_068_reprogramar_explicito(v_068_cd,(select case when not p.removido then p.dia end from public.rota_plano_semana p where p.cd_pedido=v_068_cd),(select p.veiculo_id from public.rota_plano_semana p where p.cd_pedido=v_068_cd));\n   end if;\n  end loop;\n  perform public.rota_065_subir(p_inicio);")])
legacy=extract(base,'rota_047_salvar_semana')
legacy=legacy.replace('  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);','  perform pg_catalog.pg_advisory_xact_lock(5100,5201);perform pg_catalog.pg_advisory_xact_lock(5100,5001);\n  perform pg_catalog.pg_advisory_xact_lock(5100, 4601);').replace('public.rota_065_travada(o.dia, o.veiculo_id)','public.rota_068_pedido_entregue(o.cd_pedido)').replace('and public.rota_065_linha_editavel(p.dia, p.veiculo_id);','and public.rota_065_linha_editavel(p.dia, p.veiculo_id) and not public.rota_068_pedido_entregue(p.cd_pedido);')
ler=extract(base,'rota_065_ler_semana')
ler=ler.replace("    'status', 'ok', 'inicio', p_inicio, 'hoje', public.rota_050_hoje(),", "    'status', 'ok', 'inicio', p_inicio, 'hoje', public.rota_050_hoje(),\n    'pedidos_estado',coalesce((select jsonb_object_agg(e.cd_pedido,jsonb_build_object('entregue',public.rota_068_pedido_entregue(e.cd_pedido),'reprogramado',exists(select 1 from public.rota_068h_reprogramacao r where r.cd_pedido=e.cd_pedido and r.ativa),'data_recebimento',public.rota_068_recebido_dia(e.cd_pedido))) from (select cd_pedido from public.solidcon_pedidos_erp union select cd_pedido from public.rota_plano_semana union select cd_pedido from public.pedido_entrega_rota union select cd_pedido from public.pedido_entrega_confirmacao) e),'{}'::jsonb),")
a=extract((FORJA/'pacote_068A_trocar_veiculo_20261126/admin/migracoes/068_a_trocar_veiculo.sql').read_text(encoding='utf-8'),'rota_068_trocar_veiculo')
start=a.index('  if not public.rota_065_linha_editavel(v_plano.dia,v_plano.veiculo_id) then')
end=a.index('  select v.modo',start)
a=a[:start]+"  if not public.rota_065_sai(v_destino,v_plano.dia) then return jsonb_build_object('status','erro','motivo','dia_sem_saida');end if;\n"+a[end:]
a=a.replace("'motivo','ja_saiu'","'motivo','pedido_historico'")
a=a.replace(" return pg_catalog.jsonb_build_object('status','ok','resultado',v_resultado,", " perform public.rota_068_reprogramar_explicito(p_cd_pedido,case when v_tem_plano then v_plano.dia end,v_destino);\n return pg_catalog.jsonb_build_object('status','ok','resultado',v_resultado,'entregue',false,'reprogramado',true,")
out=ROOT/'supabase/tests/068_h_corpos.sql.fixture'
out.write_text('-- Corpos065/A aprovados com deltasH; gerados offline, nunca publicados automaticamente.\n'+salvar+legacy+ler+a,encoding='utf-8')
