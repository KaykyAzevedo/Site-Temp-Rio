# Migrações do banco

Cada arquivo roda **uma vez**, **na ordem**, no **SQL Editor** do Supabase. Todos
são idempotentes (`if not exists`, `create or replace`, `on conflict do nothing`):
rodar de novo por engano não quebra nada e não duplica dado.

| Ordem | Arquivo | O que cria |
|---|---|---|
| 001 | `admin/supabase.sql` | `admins`, `pedidos`, `visitas`, `lista_espera`, RLS e as funções do dashboard |
| 002 | `admin/supabase-regioes.sql` | `regioes`, `regioes_faixas_cep` — as áreas de entrega e o frete |
| 003 | `admin/supabase-vitrine.sql` | `vitrines` e a seção "Onde comprar" |
| 004 | `migracoes/004_usuarios_clientes.sql` | `usuarios`, `clientes`, view `clientes_historico` |
| 005 | `migracoes/005_catalogo_produtos.sql` | `catalogo_produtos` + os 73 temperos |
| 006 | `migracoes/006_pedido_items.sql` | `pedido_items` e a ligação pedido → cliente/região |
| 007 | `migracoes/007_visitas_regiao.sql` | visitas por região, dispositivo e tempo de sessão |
| 008 | `migracoes/008_crud.sql` | as operações como funções do banco |
| 009 | `migracoes/009_opcional_ip_geo.sql` | **opcional — leia o cabeçalho antes** |
| 010 | `migracoes/010_realtime_pedidos.sql` | liga `pedidos` ao Supabase Realtime — sino de notificação e "últimos pedidos" do painel |
| 011 | `migracoes/011_total_servidor_solidcon.sql` | total/frete no servidor, auditoria do navegador, código ERP e controle do lançamento manual no SOLIDCON |

As três primeiras estão em `admin/` e não aqui porque já existiam antes desta
pasta; renomeá-las quebraria as referências espalhadas pelo código.

## Por que a ordem importa

004 a 008 usam a função `eh_admin()`, que nasce em 001. 006 aponta para
`clientes` (004) e `catalogo_produtos` (005). Rodar fora de ordem dá erro de
objeto inexistente — o Postgres recusa e nada é gravado pela metade. A 011
depende do catálogo (005), dos itens e do gatilho de região (006), além das
regiões (002); aplique após 010. Ela usa transação explícita.

## O que muda no site depois de rodar

Até a 010, o fluxo do site permanece igual. A 011 mantém o INSERT e passa a
recalcular os valores no servidor, sem exigir alteração em JavaScript.

O site continua fazendo o mesmo `INSERT` em `pedidos` que faz hoje. Gatilhos na
migração 006 resolvem o cliente, resolvem a região pelo CEP e transformam o
jsonb de itens em linhas de `pedido_items`. As tabelas novas se preenchem
sozinhas a partir do primeiro pedido.

Duas coisas ficam prontas mas paradas até alguém ligar:

- **`visitas.segundos`** (tempo de sessão) fica nulo até `js/analytics.js` medir
  e enviar a duração. O cabeçalho de 007 diz exatamente como.
- **`catalogo_produtos`** é semeada com os 73 temperos, mas o catálogo do site
  continua lendo `data/produtos.js`. A tabela serve ao painel e aos relatórios;
  trocar a fonte do site é uma decisão à parte, com o custo explicado em 005.

## Como conferir que deu certo

Depois de rodar tudo, no SQL Editor:

```sql
-- 73 temperos semeados
select count(*) from public.catalogo_produtos;

-- as tabelas novas existem
select table_name from information_schema.tables
 where table_schema = 'public' order by 1;

-- pedidos que já existiam ganharam itens (zero linhas = tudo certo,
-- ou nenhum pedido ainda)
select * from public.pedidos_conferencia;
```

Depois de o primeiro pedido entrar pelo site:

```sql
select p.razao_social, p.cliente_id, p.regiao_id, count(i.id) as itens
  from public.pedidos p
  left join public.pedido_items i on i.pedido_id = p.id
 group by 1,2,3;
```

`cliente_id` e `regiao_id` preenchidos e `itens` maior que zero significam que
os gatilhos estão funcionando.

## Como desfazer

Cada arquivo cria objetos com nome próprio; nenhum altera dado existente
destrutivamente. Para reverter as migrações 004–008 sem tocar no que já
funcionava:

```sql
drop view if exists public.clientes_historico, public.pedidos_conferencia,
                    public.produtos_publicos cascade;
drop table if exists public.pedido_items, public.clientes,
                     public.catalogo_produtos, public.usuarios cascade;
alter table public.pedidos
  drop column if exists cliente_id,
  drop column if exists regiao_id,
  drop column if exists enviado_whatsapp,
  drop column if exists enviado_whatsapp_em;
```

Isso apaga o cadastro consolidado e os itens normalizados. **Os pedidos em si
não se perdem** — `pedidos.itens` continua guardando a cópia congelada de tudo
que foi enviado, e é dela que a migração 006 reconstrói os itens se você rodar
de novo.

Para desligar o Realtime da migração 010 (o sino do painel só para de tocar,
nada mais muda):

```sql
alter publication supabase_realtime drop table public.pedidos;
```

## 011 — Total no servidor e SOLIDCON manual

Sem backfill: pedidos e preços de itens antigos não são recalculados, e as
colunas de auditoria antigas permanecem nulas. Novos INSERTs guardam o valor e
frete recebidos em `*_site_centavos`, depois calculam o valor por produto
(catálogo ou fallback 400), potes e frete da região ativa resolvida pela 006.
`pedidos_total_servidor` roda depois de `pedidos_resolver_cliente` por nome.
Os mesmos itens precificados alimentam o AFTER INSERT, sem usar preço médio.

Casos revisados por leitura: item sem id usa FK nula/preço 400; potes inválido
vira 1 (regex e mínimo iguais à 006); array ausente/malformado fica vazio;
região inativa não cobra frete nem cai na genérica; sem CEP válido cobra zero.
Overflow de quantidade vira 1; linha que excederia a soma integer/bigint fica
só no JSON para revisão e é ignorada tanto no total quanto nos itens.

O painel usa `marcar_lancado_solidcon(p_pedido uuid, p_numero text)`:
trim e número não vazio gravam número/data; NULL/vazio desfaz ambos. Retorna a
linha atualizada ou NULL se inexistente/invisível. É security invoker, EXECUTE
apenas para authenticated, e depende do RLS de admin. INSERT inicia os campos
de lançamento nulos. `codigo_erp` é text com índice único parcial não nulo.

Aplique primeiro em ambiente de teste; esta entrega não executa SQL em produção.
Confira novos pedidos com `pedidos_conferencia`, valores `*_site_centavos` e
preços unitários de `pedido_items`. Diferenças antigas podem continuar na view.
O navegador ainda usa preço fixo: reajuste no catálogo pode gerar divergência
com o valor mostrado no site, registrada na auditoria.

Para desfazer a 011, restaure o corpo antigo de `pedido_explodir_itens` da 006
sem reexecutar seu backfill; remova o gatilho `pedidos_total_servidor`, suas
funções/helper e a RPC, e só então as quatro colunas novas de pedidos e
`catalogo_produtos.codigo_erp` (o índice é removido com a coluna). Remover essas
colunas perde a auditoria e o controle de lançamento; os totais e preços já
gravados permanecem como estavam.

O seletor de região da 011 e `js/entrega.js` usam a mesma ordem total:
prioridade decrescente, ativo primeiro e id crescente em ordem Unicode/binária
(`COLLATE "C"` no SQL). Especificidade continua definida pela prioridade;
largura da faixa de CEP não participa. Inverter a ordem dos dados não muda
a região selecionada quando prioridade e estado empatam.


## 012 — Espelho SOLIDCON somente leitura do ERP

`012_solidcon_espelho.sql` é transacional e idempotente; requer os dois helpers
de papéis de produção descritos abaixo e `auth.users`. Prepara `solidcon_produtos`, `solidcon_sync` e
`integracoes_autorizadas`. Não depende da 011 nem altera seus objetos ou o site.
SQL **não aplicado nesta entrega**. Revisar antes da aplicação manual futura.

Pré-requisito de produção: `public.eh_equipe()` identifica qualquer email em
`admins`; `public.eh_admin()` exige também `papel='admin'`. O Tech Lead confirmou
essas definições no banco implantado. A 012 verifica a existência de ambas com
`to_regprocedure` e aborta com mensagem clara se faltar alguma. Há drift:
`eh_equipe()` não está no repo e o `eh_admin()` de `admin/supabase.sql` ainda usa
a regra antiga, só por email. **Não reaplicar `admin/supabase.sql`**: sobrescreveria
a separação de papéis de produção. A 012 não cria nem redefine esses helpers.

RLS: `solidcon_produtos` e `solidcon_sync` usam SELECT por `eh_equipe()`;
`integracoes_autorizadas` mantém SELECT somente por `eh_admin()`. Sem escrita direta para anon/authenticated,
inclusive admin; as duas RPCs SECURITY DEFINER têm search_path `pg_catalog`,
referências qualificadas, EXECUTE somente authenticated e exigem `auth.uid()`
cadastrado em `integracoes_autorizadas`. A conta dedicada nunca deve estar em
`admins`. O cadastro da integração só pode ser feito pelo owner via SQL:

```sql
-- Exemplo futuro: substituir UUID pelo da conta dedicada criada em Auth.
insert into public.integracoes_autorizadas(user_id, nome)
values ('00000000-0000-0000-0000-000000000000', 'SOLIDCON produtos')
on conflict (user_id) do update set nome = excluded.nome;
```

O parâmetro `estoque` é um **filtro**, não uma opção de incluir o saldo.
O coletor faz duas consultas sequenciais no mesmo endpoint/filial:
`GET /api/Produto/GetProdutos?ativo=true&estoque=true` (saldo >0), depois
`GET /api/Produto/GetProdutos?ativo=true&estoque=false` (saldo <=0).
Só envia a união completa das duas respostas. Falha de qualquer consulta
preserva o último sucesso; não existe envio parcial nem retry dentro do ciclo.

`estoque_disponivel = max(qtd_produto, 0)`: estoque negativo na origem é aceito
e contado no resumo/log local; preço negativo continua sendo erro.
`presente=true` inclui esgotados (`estoque_disponivel=0`). `presente=false`
significa ausência nas **duas** listas de ativos (não observado na coleta: desativado/removido ou transição de saldo entre as duas consultas), não
apenas falta de saldo. Na ausência, o espelho também mantém estoque zero.

Após validar a filial de **todas** as linhas, a trava de sobreposição considera
somente as categorias vendáveis CX24/CX48. Se uma caixa vendável aparecer com
saldo em uma resposta e sem saldo na outra, aborta **todo este ciclo** e tenta
novamente no próximo agendamento. Insumos sobrepostos não entram no espelho
e não bloqueiam o ciclo; `sobrepostos_todos` é apenas diagnóstico.
Não escolhe a primeira nem a segunda linha da caixa sobreposta. Gera
`resumo-rejeitado.json` com contagens diagnósticas; não gera novo payload,
não avança estado local e não chama a RPC de produtos. Em real, tenta apenas
registrar a falha. Divergências entre EANs da mesma lista também continuam
abortando; EAN nunca multiplica estoque.

Payload normalizado da união, com 1..2000 produtos, até 4 MiB; valida tipos, tamanhos,
filial 4, categorias autorizadas, EANs textuais e datas com fuso. Upsert, ausência
e log de sucesso são atômicos; chamadas concorrentes são serializadas por lock
transacional. Log conta produtos distintos normalizados, não linhas brutas de
EAN. `solidcon_sync` ganha `coletado_em` e `execucao_id` para cada snapshot.

A RPC recebe `p_itens jsonb`, `p_coletado_em timestamptz` e `p_execucao_id uuid`,
sem defaults; remove a assinatura legada que aceitava só JSON. `coletado_em`
é o instante UTC após receber os dois corpos da API; UUID identifica a execução.
Dentro do advisory lock, compara o total distinto recebido da união com os
produtos persistidos `presente=true` e rejeita quantidade inferior à metade
(exatamente 50% passa). A trava local também usa o total da união, incluindo
produtos com saldo zero/negativo normalizado, não apenas os com saldo. Também rejeita coleta
anterior ou igual ao último `status='ok'`, UUID já aceito, data ausente/infinita,
mais antiga que 24h ou mais de 5min à frente do relógio do banco.

Essas rejeições retornam JSON `status='erro'`/`motivo`, gravam apenas o log e
preservam o espelho e o último snapshot aceito. Não usam RAISE, que desfaria
também o log. O script trata o retorno como falha/exit 1, não atualiza estado
local nem duplica o log remoto. Erros de payload/permissão continuam gerando
exceção e rollback; quando possível, o script registra falha separadamente.
O último horário aceito é `max(coletado_em)` nos logs `ok`: preservar esse
histórico ao fazer manutenção. Logs legados ficam com metadados nulos, sem
inventar coleta anterior; o primeiro snapshot novo estabelece a referência.
`teste` é status reservado no schema: teste local não grava nada no Supabase.

O usuário de sync não ganha acesso administrativo. Há permissões públicas
preexistentes que incluem authenticated; não se pode afirmar isolamento total
do restante do site. A auditoria e suas referências estão na seção 012 de
`admin/ESTRUTURA-BANCO.md`. Esta migração não muda essas permissões.

Para desligar, pare a tarefa agendada e remova a linha autorizada pelo owner.
Para **desfazer** completamente (perde espelho, autorização e logs), após parar
a tarefa, executar manualmente:

```sql
begin;
drop function if exists public.solidcon_receber_produtos(jsonb, timestamptz, uuid);
drop function if exists public.solidcon_receber_produtos(jsonb);
drop function if exists public.solidcon_registrar_falha(text);
drop table if exists public.solidcon_produtos;
drop table if exists public.solidcon_sync;
drop table if exists public.integracoes_autorizadas;
commit;
```

Não usar CASCADE. A sequência identity cai com a tabela. A conta Auth e os
arquivos externos permanecem; sua remoção é uma ação administrativa separada.
