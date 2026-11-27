"""Somente PG18 local exclusivo. Foto070 real sanitizada, sem rede/producao."""
from pathlib import Path
import json,hashlib,subprocess,re
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT.parents[1]/'sentinela/070/foto-producao/foto_070_producao.json'
OUT=ROOT/'evidencias';DB='sentinela_separando_cpf_forja070_foto_r2'
BASE=['C:/Program Files/PostgreSQL/18/bin/psql.exe','-h','127.0.0.1','-p','55439','-U','qa','-v','ON_ERROR_STOP=1']
UID='22222222-2222-4222-8222-222222222222'
def run(db,*args):
 r=subprocess.run(BASE+['-d',db,*args],capture_output=True,text=True,encoding='utf-8',errors='replace')
 if r.returncode: raise RuntimeError(r.stderr[-5000:])
 return r.stdout
sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest();assert sha=='c8c88e541a472370f857def508fb317274fa0574d1851c773708f098d2ebe58f'
f=json.loads(SOURCE.read_text(encoding='utf-8-sig'))['rows'][0]['foto'];f=json.loads(f) if isinstance(f,str) else f
assert len(f['pedidos'])==196 and sum(x['etapa']=='atendido' for x in f['pedidos'])==183
assert re.fullmatch('sentinela_separando_cpf_forja070[a-z0-9_]*',DB)
run('postgres','-c',f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)','-c',f'CREATE DATABASE {DB} TEMPLATE sentinela_separando_cpf_forja068hr3_foto')
sql=["set qa.uid='"+UID+"';set qa.role='authenticated';set timezone='America/Sao_Paulo';"]
for t in ['rota_068h_movimento_log','rota_068h_reprogramacao','pedido_entrega_problema_requisicao','pedido_entrega_problema','pedido_entrega_rota','pedido_entrega_confirmacao','pedido_canhoto','rota_plano_semana','rota_pedido_veiculo','rota_cliente_veiculo','rota_pedido_ignorado','rota_dia_item','rota_dia_fechada','solidcon_pedidos_erp','rota_065_semana','rota_065_sem_saida']:sql.append(f'delete from public.{t};')
def ins(t,rows,defaults=None,key=None):
 if not rows:return
 cols=set(json.loads(run(DB,'-At','-c',"select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='"+t+"'")))
 data=[dict(defaults or {},**{k:v for k,v in r.items() if k in cols}) for r in rows]
 names=sorted(set().union(*(r.keys() for r in data)));cn=','.join('"'+n+'"' for n in names)
 s=f'insert into public.{t}({cn}) overriding system value select {cn} from jsonb_populate_recordset(null::public.{t},$FOTO$'+json.dumps(data,ensure_ascii=False)+'$FOTO$)'
 if key:s+=' on conflict('+key+') do update set '+','.join('"'+n+'"=excluded."'+n+'"' for n in names if n!=key)
 sql.append(s+';')
hashes=sorted({x['cliente_hash'] for x in f['pedidos'] if x.get('cliente_hash')}|{x['cliente_hash'] for x in f['cliente_veiculo'] if x.get('cliente_hash')})
docs={h:str(10000000000000+i) for i,h in enumerate(hashes)}
ins('rota_veiculos',f['veiculos'],key='id');ins('rota_config',f['config'],key='id')
ins('solidcon_pedidos_erp',[dict(x,documento=docs.get(x.get('cliente_hash')) if x['cliente_tipo']=='cnpj' else None,cliente_nome=None) for x in f['pedidos']])
ins('rota_cliente_veiculo',[dict(x,documento=docs[x['cliente_hash']]) for x in f['cliente_veiculo']])
ins('rota_pedido_veiculo',f['veiculo_pedido']);ins('rota_pedido_ignorado',f['ignorado045'],{'motivo':'QA sanitizado','atualizado_por':UID})
ins('pedido_entrega_confirmacao',f['entrega063'],{'confirmado_por':UID,'confirmado_nome':None,'motivo':None,'desfeito_nome':None,'desfeito_por':None})
ins('pedido_canhoto',f['canhoto'],{'caminho':'2026-11-25/1528/22222222-2222-4222-8222-222222222222.jpg','enviado_por':UID})
ins('rota_dia_fechada',f['fechada050'],{'fechada_por':UID,'fechada_nome':None})
ins('rota_dia_item',f['item050'],{'documento':None})
ins('rota_plano_semana',f['plano065']);ins('rota_065_semana',f['semana065']);ins('rota_065_sem_saida',f['sem_saida065'])

ins('pedido_entrega_rota',f['entrega_rota'],{'cliente_nome':None,'documento':None},key='cd_pedido')
for body in f['corpos'].values():sql.append(body.rstrip().rstrip(';')+';')
# Relogio de QA explicito, jamais distribuido na migracao.
sql.append("create or replace function public.rota_068_hoje() returns date language sql stable set search_path='' as $$select coalesce(nullif(current_setting('qa.agora',true),''),'2026-11-26T18:12:51.634445-03')::timestamptz at time zone 'America/Sao_Paulo'$$;")
sql.append("create or replace function public.rota_050_hoje() returns date language sql stable set search_path='' as $$select public.rota_068_hoje()$$;")
path=OUT/'carregar-foto-070.sql';path.write_text('\n'.join(sql),encoding='utf-8');run(DB,'-f',str(path))
ids=[p['cd_pedido'] for p in f['pedidos']];arr='array['+','.join(map(str,ids))+']::bigint[]';init="set qa.uid='"+UID+"';set qa.role='authenticated';"
def export(name,query):
 data=json.loads(run(DB,'-At','-c',init+"select jsonb_agg(to_jsonb(s) order by cd_pedido) from ("+query+") s").strip().splitlines()[-1]);(OUT/name).write_text(json.dumps({'foto_sha256':sha,'capturado_em_sp':f['capturado_em_sp'],'estados':data},ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return data
before=export('estados-base575-196.json','select * from public.rota_068_estados_pedidos('+arr+')')
assert sum(x['pendente'] for x in before)==17 and sum(x['entregue'] for x in before)==174
run(DB,'-f',str(ROOT/'admin/migracoes/070_previsao_definitiva.sql'))
run(DB,'-c',"create or replace function public.rota_070_agora() returns timestamptz language sql stable set search_path='' as $$select coalesce(nullif(current_setting('qa.agora',true),''),'2026-11-26T18:12:51.634445-03')::timestamptz$$;")
run(DB,'-c',"update public.rota_070_politica set inicio=date '2026-11-26',ultimo_dia=date '2026-11-26' where id=1")
after=export('estados-candidato070-196.json','select * from public.rota_070_estados_pedidos('+arr+')')
assert {x['cd_pedido'] for x in before if x['pendente']}=={x['cd_pedido'] for x in after if x['pendente']}
assert {x['cd_pedido'] for x in after if x['pronto_despacho']}=={1547,1554,1556,1563}
meta={'foto_sha256':sha,'capturado_em_sp':f['capturado_em_sp'],'pedidos':196,'erp_atendido':183,'entregue':sum(x['entregue'] for x in after),'pendente':sum(x['pendente'] for x in after),'pronto':[x['cd_pedido'] for x in after if x['pronto_despacho']],'documento_QA':'md5 convertido consistentemente em identificador numerico sintetico14digitos, apenas para preservar vinculo cliente_veiculo; nao documento real; nao prova entrega','db':DB}
(OUT/'foto-070-metadados.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(meta,ensure_ascii=False))
