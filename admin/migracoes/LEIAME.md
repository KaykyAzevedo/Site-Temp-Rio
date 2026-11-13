# Migrações no worktree unificado — registro, não plano de reaplicação

**NÃO executar esta pasta em lote. Nenhum SQL foi executado neste merge.**
O banco já possui B 011–016, o espelho aplicado como A 012 e o histórico aplicado
como A 017. Renomear arquivos não cria migração nova no banco nem autoriza
reaplicar objetos. Não reaplicar admin/supabase.sql: B 014 já implantou a
separação eh_equipe/eh_admin por papel. Consulte MERGE_DECISOES.md.

| Arquivo ativo | Origem | Situação informada pelo Tech Lead |
|---|---|---|
| 011_leads_pre_registro.sql | B | JÁ APLICADA |
| 012_completar_visita_rpc.sql | B | JÁ APLICADA |
| 013_validacao_seguranca.sql | B | JÁ APLICADA |
| 014_papel_vendedor.sql | B | JÁ APLICADA |
| 015_lgpd.sql | B | JÁ APLICADA — LGPD permanece |
| 016_corrige_validacao_retroativa.sql | B | JÁ APLICADA — trg_pedidos_valida |
| 019_solidcon_espelho.sql | A, antes 012 | JÁ APLICADA COMO 012 DE A; NÃO REAPLICAR |
| 020_solidcon_historico.sql | A, antes 017 | JÁ APLICADA COMO 017 DE A; NÃO REAPLICAR |
| 021_total_servidor_solidcon.sql | A, antes 011 | ABANDONADA (2026-11-12, decisão do dono): não aplicar. O "lançado no SOLIDCON" manual foi substituído pelo casamento com as vendas do ERP (034 / js/admin-erp-casamento.js). Arquivo mantido só como registro. |
| 022_solidcon_vendas.sql | A, antes 018 | APLICADA (2026-11-11) |
| 023_solidcon_clientes.sql | Espelho minimizado de clientes | APLICADA (2026-11-11) |
| 024_solidcon_publico.sql | Disponibilidade e ranking públicos, vínculo codigo_erp | APLICADA (2026-11-11) |
| 025_solidcon_ficha.sql | Ficha técnica pública dos sabores | APLICADA (2026-11-11) |
| 026_solidcon_vendas_clientes.sql | Histórico de compras por cliente | APLICADA (2026-11-11) |
| 027_solidcon_fabrica_financeiro.sql | Estoque da fábrica, endereço CNPJ, formas de pagamento | APLICADA (2026-11-11) |
| 028_reforco_seguranca.sql | Reforço de segurança (auditoria 004–027) | APLICADA (2026-11-12) |
| 029_solidcon_banco_saude.sql | Batidas do coletor pelo banco SQL SOLIDCON (módulo saúde) | APLICADA (2026-11-12) |
| 030_solidcon_contas_receber.sql | Contas a receber abertas da filial 4 (módulo receber) | APLICADA (2026-11-12) |
| 031_solidcon_margem.sql | Margem por produto da filial 4: vendas por dia e custos (módulo margem) | APLICADA (2026-11-12) |
| 032_antispam.sql | Anti-spam: limite por origem (IP hasheado) + disjuntor global + honeypot nos INSERTs anônimos | APLICADA (2026-11-12) |
| 033_solidcon_clientes_geo.sql | Coordenadas por cliente CNPJ + leitura do mapa de expansão (linha do tempo) | APLICADA (2026-11-12) |
| 034_pedidos_erp_vinculo.sql | Kanban pelo ERP, fase 2: vínculo pedido↔venda SOLIDCON e confirmação automática | NÃO APLICADA (aguarda o dono) |
| 035_solidcon_pedidos_erp.sql | Pedidos de venda do ERP com a etapa do WMS (módulo pedidos do sync-banco) | JÁ APLICADA (2026-11-13) |

019/020 são nomes de organização do repositório. Os objetos SQL, RPCs e a
assinatura chamada pelo script continuam iguais. 017/018 não são reutilizados
como arquivos ativos: esses números já têm significado histórico nas entregas.
Reaplicar a 019 substitui a RPC `solidcon_receber_produtos` pela versão
anterior à 020 e interrompe a atualização do histórico e dos eventos.

O checkout ativo é o de B, incluindo js/validadores.js e o payload de B.
021 não foi aplicada: não presumir auditoria/total recalculado no servidor,
codigo_erp ou marca de lançamento manual disponíveis. Ao planejar 021, revisar
a interação com B 013/016 e o desempate de frete (B ativo; alternativa A preservada).
Nada aqui instala, publica ou altera a tarefa do sincronizador.

## Referência de B para ambiente novo

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
| 011 | `migracoes/011_leads_pre_registro.sql` | `leads` — contatos do pop-up de pré-registro do catálogo — e `visitas.pre_registro` |
| 012 | `migracoes/012_completar_visita_rpc.sql` | corrige o "completar visita" (tempo de sessão, CEP, pré-registro), que nunca funcionou — leia o cabeçalho |
| 013 | `migracoes/013_validacao_seguranca.sql` | valida CPF/CNPJ/telefone/e-mail/CEP e trava tamanho de texto livre, direto no banco — defesa contra escrita fora do site |
| 014 | `migracoes/014_papel_vendedor.sql` | papel `vendedor` em `admins` — acesso a pedidos e clientes, sem o resto do painel |
| 015 | `migracoes/015_lgpd.sql` | consentimento, pedidos do titular (acesso/correção/exclusão), retenção e auditoria — ver a seção LGPD em admin/LEIAME-PAINEL.md |

As três primeiras estão em `admin/` e não aqui porque já existiam antes desta
pasta; renomeá-las quebraria as referências espalhadas pelo código.

## Por que a ordem importa

004 a 008 usam a função `eh_admin()`, que nasce em 001. 006 aponta para
`clientes` (004) e `catalogo_produtos` (005). Rodar fora de ordem dá erro de
objeto inexistente — o Postgres recusa e nada é gravado pela metade.

## O que muda no site depois de rodar

**Nada.** É de propósito.

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

## Extensões de A

## 021 — Total no servidor e SOLIDCON manual

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

Para desfazer a 021, restaure o corpo antigo de `pedido_explodir_itens` da 006
sem reexecutar seu backfill; remova o gatilho `pedidos_total_servidor`, suas
funções/helper e a RPC, e só então as quatro colunas novas de pedidos e
`catalogo_produtos.codigo_erp` (o índice é removido com a coluna). Remover essas
colunas perde a auditoria e o controle de lançamento; os totais e preços já
gravados permanecem como estavam.

A 021 ordena por prioridade decrescente, região ativa primeiro e id em ordem
crescente (`COLLATE "C"`). O checkout ainda usa o desempate de B. Antes de
implantar a 021, confira as faixas ativas cadastradas e alinhe os dois lados.


## 019 — Espelho SOLIDCON somente leitura do ERP

`019_solidcon_espelho.sql` é transacional e idempotente; requer os dois helpers
de papéis de produção descritos abaixo e `auth.users`. Prepara `solidcon_produtos`, `solidcon_sync` e
`integracoes_autorizadas`. Não depende da 021 nem altera seus objetos ou o site.
**Já aplicada historicamente como 012 de A. Não reaplicar.** Reaplicar a 019
restaura a RPC anterior à 020 e interrompe a atualização do histórico e dos eventos.

Pré-requisito de produção: `public.eh_equipe()` identifica qualquer email em
`admins`; `public.eh_admin()` exige também `papel='admin'`. O Tech Lead confirmou
essas definições no banco implantado. A 019 verifica a existência de ambas com
`to_regprocedure` e aborta com mensagem clara se faltar alguma. Há drift:
`eh_equipe()` não está no repo e o `eh_admin()` de `admin/supabase.sql` ainda usa
a regra antiga, só por email. **Não reaplicar `admin/supabase.sql`**: sobrescreveria
a separação de papéis de produção. A 019 não cria nem redefine esses helpers.

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
do restante do site. A auditoria e suas referências estão na seção 019 de
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


## 020 — Histórico diário e eventos SOLIDCON

`020_solidcon_historico.sql` requer a **019 já aplicada**, sua RPC de três
argumentos, metadados de coleta/UUID e `eh_equipe()`/`eh_admin()` de produção.
Aborta em transação com mensagem clara se faltar esse pré-requisito. Não
reaplicar `admin/supabase.sql`: permanece o drift de papéis documentado na 019.
Os números 013–016 pertencem ao outro repo e já foram aplicados no mesmo banco;
manter a numeração de B e não reaplicar as migrações já instaladas. Os novos objetos usam
prefixo `solidcon_`; não houve colisão com os nomes das cópias locais 013–016.

A 020 **já está aplicada em produção como 017 de A**. Não altera ERP, script
do servidor, payload, assinatura ou JSON de retorno de
`solidcon_receber_produtos(jsonb,timestamptz,uuid)`. A função mantém as validações,
autorização, lock, limite de queda, ordem, UUID e janela da 019. A rejeição só
mantém o log `erro` já existente: não cria evento/foto nem roda retenção.
Os acréscimos fazem parte da mesma transação do snapshot aceito.

- `solidcon_estoque_diario`: PK `(dia,id_produto)`, foto final do espelho inteiro,
  inclusive ausentes. Dia = data de `coletado_em` em `America/Sao_Paulo`;
  atualizado_em = processamento no banco. Cada aceitação substitui a foto
  daquele produto/dia, sem acumular uma linha por sincronização. Retenção usa
  a data atual em São Paulo: apaga `dia < hoje - 400`, mantendo hoje e os 400
  dias anteriores. A PK iniciada por dia atende a limpeza dentro da RPC.
- `solidcon_eventos`: nome congelado, tipo, valores antes/depois `numeric`,
  instante de processamento e `coletado_em`. Gerado antes de alterar o espelho.
  O baseline é `solidcon_produtos`, não o histórico vazio: produtos já existentes
  não viram `produto_novo` no primeiro snapshot após a 020. Sem backfill.
  Eventos não têm expurgo automático nesta fase.
- `solidcon_config`: uma linha `id=1`, limite padrão 5, `CHECK >=0`; reaplicação
  conserva o limite configurado. Zero desliga o evento de estoque baixo.

As três tabelas permitem SELECT somente à equipe (`eh_equipe()`), sem escrita
direta para anon/authenticated, inclusive admin. O limite muda somente por
`solidcon_definir_limite(p_limite integer)`; retorna o inteiro salvo, exige
`auth.uid()` e `eh_admin()`, valida o valor e usa o mesmo advisory lock. Essa
RPC é **SECURITY DEFINER**, com `search_path=pg_catalog`, nomes qualificados e
EXECUTE apenas authenticated. Essa escolha preserva a proibição de escrita
direta; uma RPC INVOKER exigiria conceder UPDATE da tabela ao chamador.
Não concede nada à conta de sync além do que ela já tinha.

```sql
-- Exemplo futuro pelo admin autenticado; nao executado nesta entrega.
select public.solidcon_definir_limite(5);
```

As regras exatas dos eventos e as unidades dos valores estão na seção 020 de
`admin/ESTRUTURA-BANCO.md`. Aplicar a troca da função com a tarefa agendada
pausada e retomá-la após commit, para não deixar uma chamada com o corpo antigo
da RPC atravessar a instalação. Isso não exige modificar o script.

### Validação local

Parser PostgreSQL/PLpgSQL e testes dinâmicos no **PostgreSQL 18 local isolado**:
pré-requisito ausente, reaplicação idempotente, primeiro snapshot com itens existentes,
todos os tipos de evento, limite cruzando/sem repetição/zero, foto do dia,
fuso, rejeições sem efeitos, retenção 400/401 dias, RLS e grants mínimos.
Também verificados rollback total ao falhar o diário após eventos/upsert e o
rollback gerado pelo comando abaixo, com a RPC da 019 funcionando ao final.
Helpers de identidade/equipe/admin foram simulados somente nesse banco local.
Nenhuma conexão com ERP/Supabase. O script do servidor permanece intacto.

### Como desfazer a 020

Pare a tarefa durante a troca. Primeiro restaure **somente o corpo da RPC de
recebimento da 019**, depois remova os objetos da 020. Não reexecute a 019
inteira nem o SQL base. Para gerar um rollback completo a partir do arquivo
019 versionado, no PowerShell na raiz do repo:

```powershell
$base017 = Get-Content -Raw -Encoding UTF8 admin/migracoes/019_solidcon_espelho.sql
$inicio017 = $base017.IndexOf('create or replace function public.solidcon_receber_produtos(')
if ($inicio017 -lt 0) { throw 'Corpo da 019 nao encontrado; nao gerar rollback' }
$fim017 = $base017.IndexOf('create or replace function public.solidcon_registrar_falha(', $inicio017)
if ($fim017 -le $inicio017) { throw 'Final da RPC012 nao encontrado; nao gerar rollback' }
$texto017 = @(
  'begin;'
  'select pg_catalog.pg_advisory_xact_lock(5100, 4);'
  $base017.Substring($inicio017, $fim017 - $inicio017)
  'drop function if exists public.solidcon_definir_limite(integer);'
  'drop table if exists public.solidcon_estoque_diario;'
  'drop table if exists public.solidcon_eventos;'
  'drop table if exists public.solidcon_config;'
  'commit;'
) -join [Environment]::NewLine
$destino017 = Join-Path $env:TEMP 'desfazer-solidcon-020.sql'
[IO.File]::WriteAllText($destino017, $texto017, (New-Object Text.UTF8Encoding($false)))
Write-Output $destino017
```

Revise o SQL gerado antes de executar como owner. Não usa CASCADE. Isso perde
histórico, eventos e limite configurado; o espelho, log de sync e autorizações
da 019 permanecem. Reaplicar 020 começa a coletar novamente, sem reconstruir
histórico perdido. O retorno da RPC segue compatível com o script.


## 022 — Vendas diárias SOLIDCON

Funcionalidade aprovada. A 022 **foi aplicada em 2026-11-11** (backfill de 180 dias feito; coletor 08b7c809 no servidor). Requer 019 e 020 completas,
as tabelas/funções delas e os helpers de papéis de produção; preflight aborta
com mensagem clara. Não reaplicar SQL base, 019 ou 020. Número 022 não colide
com as 013–016 do outro repo; nomes novos usam `solidcon_vendas_` ou
`solidcon_receber_vendas`.

`solidcon_vendas_dia` tem PK `(dia,ean)`, metadados de produto/formato/família,
quantidade numeric, líquido/bruto/desconto em centavos bigint e instante de
coleta. `solidcon_vendas_sync` registra ok/erro por dia, linhas, valor total,
coleta, UUID, mensagem controlada e horário do banco. Não altera o espelho de
estoque, eventos, histórico ou suas RPCs.

`solidcon_receber_vendas(p_dia date,p_itens jsonb,p_coletado_em timestamptz,
p_execucao_id uuid)` é SECURITY DEFINER com search_path pg_catalog e nomes
qualificados. Exige UUID de usuário em integracoes_autorizadas. EXECUTE somente
authenticated. Lock próprio `(5100,18)`, independente do estoque `(5100,4)`.
Valida dia entre hoje-400 e hoje em São Paulo, array de até 2000 EANs/4 MiB,
chaves/tipos, EAN textual, quantidades/valores não negativos, fatores 1/24/48
ou NULL, família NULL ou 12 dígitos, dinheiro/total dentro de bigint.
Coleta é recente (últimas 24h, até 5min no futuro), diferente da data histórica
das vendas. Rejeita coleta anterior/igual ao último ok **daquele dia**, UUID
de sucesso já usado em qualquer dia, EAN duplicado e `[]` sobre dia com linhas.
Não há exceção para apagar dia existente com resposta vazia nesta fase.

Somente após validar, substitui o dia inteiro com DELETE+INSERT e log ok em uma
transação. Rejeições retornam JSON status erro/motivo e gravam apenas log erro;
dados anteriores permanecem. Erro SQL inesperado reverte a transação; nesse
caso, ou em falha do GET, o script registra o erro no arquivo local.
Novo dia vazio é aceito com log ok/zero e sem linhas na tabela de vendas.
Não há expurgo automático das vendas/logs nesta fase; a janela limita a escrita.

RLS: SELECT só equipe nas duas tabelas, sem escrita direta, inclusive admin.
Três views com security_invoker e SELECT somente authenticated preservam RLS:
`solidcon_vendas_por_dia`, `solidcon_vendas_por_mes` e
`solidcon_vendas_familia_mes`. A conta de sync só executa a RPC autorizada,
sem leitura do painel. Agregados de centavos usam numeric (SUM de bigint).

O coletor mantém o ciclo de estoque e depois tenta vendas de HOJE e ONTEM,
inclusive quando o estoque falha. Novo endpoint permitido, somente GET:

```text
http://localhost:5100/api/Vendas/resumo-produtos-data?idFilial=4&data=YYYY-MM-DD
```

Data é gerada pelo script em São Paulo; host/porta, método e rota são fixos.
Sem proxy/redirect; timeout 60s. Usa o catálogo das duas consultas do ciclo
para nome, categoria, fator e família. Se leitura/filial do catálogo falhar,
mantém valores de vendas, envia nome/categoria NULL, formato outro e fator/
família NULL. Metadados podem ser reconstruídos no próximo sucesso; não são
inventados a partir de preço ou do tamanho do EAN.

`-BackfillDias N` (1..400) processa N datas, incluindo hoje, do mais antigo ao
mais novo. Não envia estoque nem muda seu estado local; faz os dois GETs de
catálogo só para enriquecer, depois GET/RPC de vendas por dia. Pausa 700ms entre
dias com GET real, continua após falha de um dia. UUID novo por envio de dia.
Sem nova configuração/segredo. Em modo teste, só arquivos; detalhes e comandos
em `integracao/solidcon/LEIAME.md`. Não há importação de arquivo em modo real.

Códigos (coletor atual, incluindo 023): 0 = fluxos OK ou clientes ainda não devidos;
1 = configuração/mutex/estoque falhou; 3 = vendas falhou; 4 = somente clientes
falhou. Precedência 1 > 3 > 4. Backfill continua somente vendas (0/1/3). Vendas
e clientes nunca desfazem um sucesso de estoque.

### Validação da 022

Parser PS5.1 e PostgreSQL/PLpgSQL; regressão de estoque; fluxos HTTP/RPC
simulados sem rede; PostgreSQL 18 local isolado (substituição, vazio, limites,
ordem, UUID, tipos, RLS/views, rollback após DELETE, reaplicação). Carga dos
arquivos normalizados pelas 180 chamadas RPC **locais** conferida nas 3 views:
registros, datas, centavos, unidades e potes equivalentes idênticos à origem
(valores comerciais ficam fora do repositório, que é público). A coleta original consultou 180 dias;
o arquivo só lista datas com vendas e não permite distinguir falha original
de dia sem linha. Vazios inferidos do arquivo são usados somente no teste.
Sem execução em Supabase, ERP ou servidor. Nenhuma credencial no repo.

### Como desfazer a 022

Antes de implantação futura, guardar cópia do script anterior à 022. Para
desfazer, pausar a tarefa, restaurar essa cópia e executar como owner:

```sql
begin;
select pg_catalog.pg_advisory_xact_lock(5100,18);
drop view if exists public.solidcon_vendas_familia_mes;
drop view if exists public.solidcon_vendas_por_mes;
drop view if exists public.solidcon_vendas_por_dia;
drop function if exists public.solidcon_receber_vendas(date,jsonb,timestamptz,uuid);
drop table if exists public.solidcon_vendas_dia;
drop table if exists public.solidcon_vendas_sync;
commit;
```

Sem CASCADE. Perde vendas e logs, preserva todos os objetos/dados 019/020.
Retomar a tarefa com o script anterior. Se mantiver o script 022 com a RPC
removida, o estoque continua funcionando, mas as vendas falham e saem com 3.
Nenhuma tarefa, aplicação de SQL ou troca do script do servidor foi realizada
nesta entrega; aguardar revisão e o retorno da usuária.


## 023 — Cadastros SOLIDCON minimizados (NÃO APLICADA)

Entrega aprovada para atendimento B2B e conferência de cadastro; **não executar
esta migração nesta entrega**. O precheck exige os objetos completos de 019/020
(já instalados como 012/017 de A), whitelist e helpers de produção. Aborta antes
de criar objetos se faltar dependência. Não depende da instalação da 022, não
reaplica SQL base e não altera funções/dados de estoque ou vendas.

`solidcon_clientes` é um espelho integral, com PK `documento` **textual**, somente
dígitos: CPF com 11 e CNPJ com 14, conservando zeros à esquerda; `tipo` exige
cpf/cnpj e tamanho correspondente. Demais campos: nome obrigatório (150),
telefone/celular (32 cada), email (254), cidade/bairro (100 cada), estado (2
letras maiúsculas), coletado_em UTC. Campos opcionais ausentes/vazios viram NULL
no coletor. Nenhum histórico de cadastros. `solidcon_clientes_sync` guarda apenas
status ok/erro, linhas, coleta, UUID, horário e motivo técnico fixo — sem valores
pessoais e sem corpo/erro bruto do ERP. Logs técnicos não têm expurgo nesta fase.

Ambas as tabelas têm RLS SELECT por `eh_equipe()` para authenticated. PUBLIC/anon
sem privilégios; ninguém em authenticated escreve diretamente, incluindo admin.
A sequência do log também não é exposta. A conta de sync não ganha papel de
equipe; executa apenas a RPC mediante `integracoes_autorizadas`.

`solidcon_receber_clientes(p_itens jsonb,p_coletado_em timestamptz,p_execucao_id uuid)`
é SECURITY DEFINER com search_path pg_catalog, referências qualificadas e lock
exclusivo `(5100,23)`, independente de estoque/vendas. Exige whitelist, UUID,
coleta finita de até 24h atrás/5min à frente, array não vazio, máximo 10.000
itens/16 MiB JSONB e exatamente os nove campos permitidos. Valida tipos,
tamanhos, nome, UF, caracteres de controle, documento/tipo e duplicatas.
Campo extra, inclusive nascimento ou endereço completo, rejeita o lote inteiro.

Rejeita coleta anterior/igual ao último OK, UUID OK repetido e queda **maior
que 50%** no número de clientes (50% exatos são aceitos). Em sucesso substitui
o espelho e registra OK na mesma transação. Nas rejeições autorizadas retorna
`status=erro` e persiste log sem RAISE. Erro inesperado durante substituição
desfaz o DELETE/INSERT e retorna `falha_interna` com log genérico, sem SQLERRM.
Acesso sem whitelist continua sendo erro de autorização, como na 022.

O agendamento diário, controle pré-GET, normalização e saídas são descritos em
`integracao/solidcon/LEIAME.md`, seção 023. Atualizar o servidor somente após
revisão e aplicação manual futura da 023; este repositório não contém dados
reais nem credenciais. Não substituir a versão operacional da 022 ainda em uso
por esta candidata antes dessa implantação.

### Como desfazer a 023 (somente mediante decisão de implantação)

Pausar/drenar a tarefa e restaurar a cópia anterior do coletor. O SQL abaixo é
documentação; **não foi executado no ambiente remoto**. Apaga o espelho e os
logs de clientes, preservando os objetos de estoque/vendas. Sem CASCADE.

```sql
begin;
select pg_catalog.pg_advisory_xact_lock(5100,23);
drop function if exists public.solidcon_receber_clientes(jsonb,timestamptz,uuid);
drop table if exists public.solidcon_clientes;
drop table if exists public.solidcon_clientes_sync;
commit;
```

Conservar `clientes-consulta.json` fora do repo ao trocar/restaurar o script:
apagá-lo permitiria outro GET no mesmo dia. Se a RPC não existir, estoque e
vendas continuam; clientes sinalizam exit 4 (ou 1/3 conforme precedência).


### Validação da 023

PostgreSQL 18 local isolado, sem Supabase/ERP: parsers SQL/PLpgSQL, precheck
com rollback, RLS equipe/admin/não-equipe/anon, escrita direta negada,
whitelist da RPC, vazio, tipos/limites/campos extras, duplicatas, coleta
antiga/futura, UUID repetido, queda >50% (50% exatos aceitos), substituição
integral e preservação de estoque/histórico. Falha de constraint induzida após
DELETE confirmou rollback total do espelho e log genérico persistido. Lock
de clientes independente dos locks de estoque/vendas; reaplicação idempotente
somente nessa instância descartável, encerrada após os testes.

Windows PowerShell 5.1, com fixtures exclusivamente fictícias: array unitário,
zeros e tipo explícito, campos opcionais/limites/controles, projeção dos nove
campos sem dados proibidos, queda local preservando último OK, modo offline
sem reserva diária, arquivos recusados em real e backfill só de vendas.
Em modo real **simulado**, GET/RPC substituídos por funções locais: janela das
06h, reserva persistida antes do GET, máximo um GET/dia, dia seguinte,
timeout/rejeição/confirmacão divergente sem retry, estado pendente/corrompido/
futuro/inacessível falhando fechado e precedência 1/3/4. Nenhum HTTP real.
O bloco de estoque foi comparado com a versão anterior e permaneceu intacto;
o coletor mantém apenas as quatro rotas ERP fixas GET, sem proxy/redirect.

## 024 — SOLIDCON público: disponibilidade e posição (PREPARADA, NÃO APLICADA)

Arquivo: `024_solidcon_publico.sql`. Depende do catálogo/RLS de 005/014,
019/020 (espelho e histórico) e 022 (`solidcon_vendas_dia`). **Não depende da
021 nem a aplica**: cria `codigo_erp text` com `ADD COLUMN IF NOT EXISTS` e o
mesmo índice `catalogo_produtos_codigo_erp_uk` parcial (`codigo_erp IS NOT NULL`).
As definições são idênticas às da 021; se ela vier depois, os mesmos comandos
serão ignorados com segurança. Não executa totalizadores/gatilhos da 021.
Não executar outras migrações antigas para instalar a 024.
Nenhuma migração foi executada no Supabase nesta entrega; sem commit/push.

A única interface nova é a RPC sem argumentos `solidcon_catalogo_publico()`:

| Campo | Conteúdo público |
|---|---|
| `produto_id` | ID do produto ativo e não removido do catálogo |
| `disponivel` | boolean; desconhecido/falha retorna `true` |
| `posicao` | posição inteira por família, ou `null` sem classificação |

É `STABLE SECURITY DEFINER`, com `search_path=pg_catalog` e tabelas qualificadas.
O owner que instalar precisa ler as tabelas privadas. `PUBLIC` não recebe
EXECUTE; somente `anon` e `authenticated`. Não concede SELECT no espelho,
views de vendas ou logs, nem muda RLS/grants existentes. A RPC não aceita
código, EAN, intervalo ou filtro de volume e não retorna esses dados. Não
retorna estoque, preço ERP, receitas, quantidades, datas internas ou dados
pessoais. O site nunca lê `solidcon_produtos`/`solidcon_vendas_dia` diretamente.

Cada produto do site representa um sabor/família. `trim(codigo_erp)` aceita
a família de 12 dígitos (preferencial), EAN de pote de 13 dígitos (primeiros
12) ou EAN de caixa de 14 (do 2º ao 13º). Mantém código de produto/alias EAN
legado: resolve a família pelos EANs da caixa explicitamente vinculada.
Não converte em número, preservando zeros iniciais; nunca usa o nome.
Expande a família para todas as suas caixas CX24/CX48. Alias legado com
mais de uma família fica desconhecido/fail-open; sem família, mantém o vínculo
exato legado. Família explicitamente cadastrada pode receber ranking mesmo
sem caixa presente no espelho atual, mas não marca esgotado sem dados atuais.
Só informa
esgotado quando existe vínculo, todos os vinculados estão presentes e com
linha recente, o último ciclo é OK e sua coleta tem no máximo 2h. Um saldo
positivo em alguma caixa da família torna o produto disponível. Ausência do espelho,
produto ausente, linha antiga, ciclo com erro ou coleta >2h/futura: fail-open.
Falha HTTP, RPC ainda ausente e resposta inválida também mostram normal.

O ranking soma `qtd * potes_por_unidade` por `familia`, formatos `pote`, `cx24`
e `cx48`, em 90 datas de São Paulo (hoje e os 89 dias anteriores). Ignora
`outro`, datas futuras e famílias sem vendas positivas. GTIN-14 de caixa
usa a base de 12 dígitos, exatamente como `Familia-Venda` no coletor. EANs
repetidos da mesma família não duplicam vendas. Código legado sem família ou
ambíguo não recebe posição. Ranqueia famílias ligadas ao catálogo
ativo; empate por família dá posições consecutivas determinísticas. Produtos
da mesma família compartilham posição. Nenhum volume chega ao navegador.

`js/solidcon-publico.js` guarda a projeção só em memória por até 60s, com
atualização a cada minuto/retorno à aba e timeout de 4s. Expiração ou falha
remove o bloqueio; a regra das 2h é calculada no banco a cada consulta.
Catálogo e os destaques já existentes ordenam pela posição atual, com os
sem ranking depois, na ordem editorial estável. Sem projeção, não exibem
ranking estático como se fosse atual. Não adiciona fotos/produtos à seleção
editorial de destaques. O pedido rápido usa apenas ranqueados disponíveis.

Card/modal/destaque de esgotado oferecem a lista existente via
`pedido.html?espera_produto=<id>`. Esse fluxo valida ID contra o catálogo,
reutiliza formulário/validação/INSERT da lista de espera, grava interesse em
reposição e totais zero e não adiciona produto ao carrinho. Nenhuma nova
coluna pessoal ou endpoint de contato foi criado; não há dado pessoal na
RPC de leitura. Carrinho salvo continua removível, sinaliza esgotado e não
permite aumentar quantidade ou enviar pedido enquanto houver indisponível.
O cadastro regional existente permanece no fluxo normal.

### Escrita do vínculo e integração com a Vitrine

A coluna nova segue a RLS já existente do catálogo: 005 define
`"admin escreve produtos" FOR ALL TO authenticated USING (eh_admin())
WITH CHECK (eh_admin())`; 014 faz esse helper exigir papel `admin`.
As policies de leitura pública/equipe não concedem escrita, e as RPCs de
CRUD da 008 são invoker e também verificam `eh_admin()`. A 024 não concede
escrita nem altera essas policies. Validado localmente com as mesmas policies:
UPDATE anon/vendedor afeta zero linhas, admin altera a coluna nova.
Vitral coordena a tela de vínculo na Vitrine e os cálculos de giro/estoque
por essa mesma família; não há preenchimento automático por nome na 024.

### Validação local da 024

`python -m http.server 8767 --bind 127.0.0.1` na raiz; navegador Maestri Portal
com fetch substituído por mocks sintéticos, sem envio real de pedido/contato.
Casos: ordem/medalhas, busca preservada, card/modal esgotado, bloqueio no
Cart, reposição com modal aberto, 404/JSON inválido/offline, interesse na
lista com carrinho vazio e totais zero, carrinho salvo e bloqueio do checkout.
Verificação de sintaxe com `node --check` nos JS alterados. PostgreSQL 18
local isolado (porta 55424, schema sintético): contrato de três colunas,
EXECUTE anon sem SELECT privado, ativos/removidos, código/EAN, GTIN duplicado,
família ambígua, fatores 1/24/48, limites 89/90 dias e data futura, falha/ausência
ou coleta/linha >2h. Nada foi aplicado em banco remoto ou consultado no ERP.
Reteste após ajuste de família: instalação sem coluna/021, reaplicação,
compatibilidade das DDLs com a 021, RLS anon/vendedor/admin, família 12 dígitos,
EAN13/EAN14/código legado expandindo as duas caixas, zeros iniciais, uma caixa
com saldo e todas zeradas. Estado público também testado com relógio simulado
para expiração de 60s. CSS de `hidden` e quantidade do modal preservada na
atualização periódica foram conferidos no DOM.

Para testar manualmente no mock: retornar IDs fictícios com `disponivel=false`
e posições 2/1/3; conferir ordem e atalho de espera. Alternar a resposta para
`true`, 404 ou erro de rede; a adição volta a funcionar. Para teste SQL, usar
somente banco descartável e fixtures sintéticas com as dependências acima.
Rollback futuro: remover a chamada ao JS e executar manualmente
`drop function public.solidcon_catalogo_publico();` — não remove espelhos nem
coluna/índice de vínculo (preservam o cadastro e a compatibilidade com a 021).

## 025_solidcon_ficha.sql — Ficha técnica pública (NÃO APLICADA)

- `solidcon_receber_ficha` grava só `ncm`, `cest`, `qtd_medida`, `unid_medida`; **nunca** toca `atualizado_em`/`visto_em` (frescor do estoque da 024 continua refletindo só o fluxo de estoque).
- Todo item precisa existir e estar `presente` no espelho (`produto_desconhecido` rejeita o lote); retorno traz `encontrados` (= linhas) e `atualizados` (linhas que mudaram, 0..N).
- `solidcon_ficha_publica()`: produto com GTIN-14 de mais de uma família fica fora; caixa só com GTIN-14 da própria família; valor ambíguo (mais de um distinto) sai `null`; gramatura só com unidade de peso/volume (`g`, `kg`, `ml`, `l`) e quantidade > 0 — "1 un" não é publicado.

## 026_solidcon_vendas_clientes.sql — Histórico de compras por cliente (NÃO APLICADA)

Migração candidata para análise de compras por cliente no painel da Vitral (`js/admin.js`).
**NÃO APLICAR** sem instrução expressa do Tech Lead.

### Estrutura da tabela e chave primária

- Tabela: `public.solidcon_vendas_clientes`
- Colunas exatas consumidas pelo painel:
  - `dia date not null`
  - `dt timestamptz not null`
  - `documento text not null` (CPF com 11 dígitos ou CNPJ com 14 dígitos, completados com zeros à esquerda)
  - `tipo text not null check (tipo in ('cpf', 'cnpj'))`
  - `valor_centavos bigint not null check (valor_centavos >= 0)`
  - `total_itens integer not null check (total_itens >= 0)`
  - `cd_pdv integer not null check (cd_pdv >= 0)`
  - `nr_cupom bigint not null check (nr_cupom >= 0)`
  - `coletado_em timestamptz not null check (isfinite(coletado_em))`
- Chave primária: `(dia, cd_pdv, nr_cupom)`.
  *Justificativa:* Identifica univocamente a emissão de cada cupom fiscal de venda pelo terminal do PDV no dia,
  correspondendo estritamente à ordenação executada pela Vitral em `js/admin.js` (`order by dia, cd_pdv, nr_cupom`).
- Índices:
  - `solidcon_vendas_clientes_doc_dia_idx` em `(documento, dia desc)` — agiliza agregações e histórico por cliente.
  - `solidcon_vendas_clientes_dia_idx` em `(dia desc)` — suporte para consultas gerais e rotina de expurgo de retenção.

### RPC e Substituição Atômica (compatível com safeupdate)

- RPC: `public.solidcon_receber_vendas_clientes(p_inicio date, p_fim date, p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid)`
- `SECURITY DEFINER`, lock consultivo `pg_advisory_xact_lock(5100, 26)`.
- Janela temporal máxima de 31 datas por chamada (`(p_fim - p_inicio) <= 30`).
- Snapshot antigo: recusado (`snapshot_antigo`) se qualquer envio OK cujo intervalo **cruze** `[p_inicio, p_fim]` tiver `coletado_em` igual ou mais novo — um lote velho nunca sobrescreve dia já coberto por um mais novo.
- Validação por item: `dt` ISO com fuso explícito e no mesmo dia (America/Sao_Paulo) de `dia`; CPF/CNPJ com dígitos verificadores válidos (rejeita só zeros/dígito repetido) via `solidcon_026_documento_valido` (sem grant); cupom duplicado comparado por valor (`(dia, cd_pdv, nr_cupom)`).
- Substituição atômica: `DELETE FROM public.solidcon_vendas_clientes WHERE dia >= p_inicio AND dia <= p_fim AND dia IS NOT NULL;` seguido do `INSERT` dos itens validados.
- Retenção automática de 400 dias: executa `DELETE FROM public.solidcon_vendas_clientes WHERE dia < (v_hoje - 400) AND dia IS NOT NULL;` a cada sincronização.
- Subtransação com tratamento de exceções: qualquer inconsistência gera log na tabela técnica `solidcon_vendas_clientes_sync` sem expor dados pessoais no motivo do erro.

### Conformidade LGPD

1. **Finalidade:** Gestão comercial B2B, análise de recorrência, ticket médio e relacionamento da equipe com clientes cadastrados.
2. **Minimização:** Chaves de NF-e (`nfCeChave`), modalidades de pagamento e CNPJ de filial são sumariamente descartados. Vendas a consumidor sem documento não entram no banco.
3. **Controle de Acesso:** RLS habilitada; somente equipe autenticada (`eh_equipe()`) tem acesso de leitura (`SELECT`). Escrita restrita à RPC com token de integração autorizado.
4. **Descarte:** Histórico limitado a 400 dias com expurgo automático garantido no banco.

## 027_solidcon_fabrica_financeiro.sql — Estoque da fábrica, endereço CNPJ e formas de pagamento (APLICADA em 2026-11-11)

Pré-requisitos: 019/023 completas e `eh_equipe()`/`eh_admin()`. Não altera
`solidcon_receber_produtos` nem o espelho vendável. Reaplicável (idempotente;
validada aplicando duas vezes, inclusive com clientes já gravados pela 023).
Locks: insumos (5100,27), modalidades (5100,28), clientes (5100,23).
Leitura de todas as tabelas novas: somente `authenticated` com `eh_equipe()`;
anon sem grant algum; escrita só pelas RPCs SECURITY DEFINER
(`search_path=pg_catalog`, exige `integracoes_autorizadas`). Todo DELETE/UPDATE
tem WHERE (safeupdate). Logs `*_sync` guardam só metadados técnicos.

### (A) Estoque da fábrica — `solidcon_insumos`, `solidcon_insumos_diario`

- `solidcon_insumos(id_produto int PK, nome, categoria, unidade, estoque numeric, presente, dtalteracao_erp, atualizado_em)`:
  todos os itens do GetProdutos **fora** das 2 categorias vendáveis. `estoque` é o
  valor bruto do ERP (pode ser negativo). `unidade` = `unid_medida`, ou `emb` se vazia.
  `atualizado_em` = coleta do último snapshot que tocou a linha.
- `solidcon_insumos_diario(dia, id_produto, estoque)`, PK `(dia,id_produto)`: foto do dia
  (America/Sao_Paulo) = última coleta aceita do dia, só itens presentes; retenção 400 dias.
- `solidcon_insumos_sync`: log técnico (status, linhas, coletado_em, execucao_id, motivo).
- RPC `solidcon_receber_insumos(p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid)`:
  whitelist exata (`id_produto,nome,categoria,unidade,estoque,dtalteracao_erp`), 1..10.000 itens/8 MiB,
  id inteiro 1..2^31-1 sem duplicata, data ERP com fuso. Rejeita `categoria_vendavel` (as 2
  categorias) e `produto_vendavel` (id presente em `solidcon_produtos`). Guardas padrão:
  `coleta_fora_da_janela`, `snapshot_antigo`, `execucao_repetida`, `snapshot_vazio`,
  `queda_superior_50_porcento` (linhas×2 < presentes). Aceito: upsert, ausentes viram
  `presente=false` (estoque fica com o último valor visto), foto do dia substituída.
  Retorno: `{status, linhas, dia, coletado_em, execucao_id}`.

### (B) Endereço de clientes CNPJ — colunas em `solidcon_clientes`

- Novas colunas nullable: `logradouro` (≤100), `numero` (≤30), `complemento` (≤60), `cep` (exatamente 8 dígitos)
  — limites do `vmEndereco` do ERP.
- Constraint `solidcon_clientes_027_endereco_cpf`: `tipo='cpf'` ⇒ os 4 campos são null.
- `solidcon_receber_clientes` (mesma assinatura/retorno da 023) aceita o payload antigo
  (9 campos; endereço fica null) **e** o novo (13 campos; os 4 juntos). CPF com qualquer
  campo de endereço rejeita o lote (`endereco_cpf`); CEP fora do padrão = `cep_invalido`;
  campo extra (ex.: `cdMunicipio`) continua `campos_invalidos`. Na gravação, endereço só
  entra se `tipo='cnpj'`.

### (C) Formas de pagamento — `solidcon_vendas_modalidade`

- `solidcon_vendas_modalidade(dia, id_modalidade int, nome, valor_centavos bigint ≥0, qtde_pagamentos int ≥0, coletado_em)`,
  PK `(dia,id_modalidade)`. **Não guarda sangria nem fundo de caixa.**
- `solidcon_vendas_modalidade_sync`: log técnico por dia.
- RPC `solidcon_receber_vendas_modalidade(p_dia date, p_itens jsonb, p_coletado_em, p_execucao_id)`:
  dia entre hoje-400 e hoje (SP), 0..200 itens (`[]` = dia sem venda, substitui por 0 linhas),
  whitelist exata, inteiros sem fração, valor negativo rejeitado, modalidade duplicada rejeitada,
  `snapshot_antigo` se já houver envio OK do mesmo dia com coleta igual ou mais nova.
  Substitui o dia (`DELETE ... WHERE dia=p_dia` + INSERT). Retorno:
  `{status, dia, linhas, valor_total_centavos, coletado_em, execucao_id}`.

### Validação local da 027 (PG 17 isolado, imagem Supabase)

Aplicada 2× sobre 004–026; casos: aceite, queda 50% (exatos 50% passam), snapshot antigo,
execução repetida, categoria/produto vendável, campos extras, ids inválidos, data sem fuso,
retenção 400/401 dias, foto do dia; clientes v1 e v2, CPF com endereço (RPC e constraint),
limites 100/30/60/8; modalidades com substituição do dia, negativo, fração, duplicada, sangria
extra, dia futuro/h-401, nome null; anon sem SELECT/EXECUTE, autenticado fora da equipe
vê 0 linhas, não-autorizado recebe 42501. Payloads gerados pelo coletor aceitos pelas 3 RPCs.

### Como desfazer a 027 (somente mediante decisão)

Reaplicar o corpo da RPC da 023 (o coletor novo passa a ser recusado com `campos_invalidos`
e precisa voltar à versão anterior), remover as 4 colunas/constraints `solidcon_clientes_027_*`
e dropar `solidcon_insumos*`, `solidcon_vendas_modalidade*` e as duas RPCs novas.

### Texto LGPD proposto (027) — para a Política de Privacidade

Proposta para o dono/Vitral publicarem em `privacidade.html` (nova versão da política;
não editado nesta tarefa):

> **Dados vindos do nosso sistema de gestão (ERP).** Para atender clientes que já compram
> conosco, nossa equipe interna consulta no painel administrativo uma cópia resumida do
> cadastro do sistema de gestão: nome, documento (CPF ou CNPJ), telefone, e-mail, cidade,
> bairro e UF e, **somente para empresas (CNPJ)**, o endereço comercial (logradouro, número,
> complemento e CEP), usado para logística de entrega e atendimento comercial. Endereço de
> pessoa física (CPF) não é copiado. Também guardamos o histórico de compras por cliente por
> até 400 dias. Totais diários por forma de pagamento e o estoque da fábrica são dados da
> empresa, sem informação pessoal. Base legal: execução de contrato e legítimo interesse
> (art. 7º, V e IX). Acesso restrito à equipe autenticada; nada é público nem repassado a
> terceiros. O cadastro é substituído a cada atualização diária: o que for excluído ou
> corrigido no sistema de gestão some ou é corrigido aqui na atualização seguinte.

## 028_reforco_seguranca.sql — Reforço de segurança (APLICADA em 2026-11-12; sem o limite de numero_solidcon, coluna da 011 ausente em produção)

Resultado da auditoria das migrações 004–027 e de `admin/supabase*.sql`, conferida num
Postgres isolado com tudo aplicado (catálogo: RLS, policies, grants, `SECURITY DEFINER`).
Idempotente, `begin/commit`, sem UPDATE/DELETE e sem apagar dados. Rodar no SQL Editor
como `postgres`. Não toca o ERP nem o coletor.

**O que já estava certo:** todas as tabelas de `public` têm RLS; `anon` só lê
`catalogo_produtos` (ativos), `regioes`, `regioes_faixas_cep` e a view
`vitrines_publicas` (só vitrines aprovadas e vigentes, sem telefone/e-mail/CNPJ); as RPCs
SOLIDCON são `SECURITY DEFINER` com `search_path=pg_catalog` e não executáveis por `anon`;
`_lgpd_anonimizar`, `lgpd_marcar_inativos`, `lgpd_excluir_pessoa` e `lgpd_purgar_marcados`
checam `eh_admin()` por conta própria.

**Achados corrigidos pela 028:**

| # | Gravidade | Achado | Correção |
|---|---|---|---|
| 1 | MÉDIO | INSERT anônimo em `pedidos` aceitava `status='confirmado'`, `confirmado_em`, `enviado_whatsapp` e `criado_em` escolhidos pelo cliente: um POST direto criava “pedido confirmado” que somava no faturamento do painel. | Gatilho `pedidos_028_estado_inicial` (BEFORE INSERT): para `anon`/`authenticated` fora da equipe impõe `aguardando`, sem confirmação/envio, `criado_em=now()`. Equipe, `service_role` e SQL Editor não mudam. |
| 2 | MÉDIO | `historico_do_cliente(p_cnpj)` (`SECURITY DEFINER`, liberada a `anon`) devolvia nº de pedidos, caixas e valor total de **qualquer** CNPJ. | Mesma assinatura e retorno; números só para equipe autenticada. `anon`/não-equipe recebem zeros (o site não tem como provar titularidade do CNPJ: um pedido recente pode ser forjado). `js/pedido.js` já trata zeros como “1 pedido”. **Efeito no produto:** o convite da vitrine deixa de usar o histórico (gatilhos “2+ pedidos” e bônus “recorrente”); continua pelo volume do pedido atual. Reativar exige identidade verificada (login do cliente). |
| 3 | MÉDIO | Campos livres sem limite de tamanho em tabelas com INSERT anônimo: `visitas` (pagina, sessao, user_agent, referencia, `pre_registro` jsonb — também via `completar_visita`), `leads` (pagina_origem, sessao, observacoes), `consentimentos`, `vitrines`, `pedidos.itens` (jsonb sem limite de itens) e `lista_espera.itens`. | CHECKs `*_028_tamanhos` **NOT VALID** (linhas antigas não são reprovadas; valem para novas e alteradas). Limites folgados sobre o que o site envia: user_agent 1000, pagina 200, sessao 100, `pre_registro` 2 KB, `pedidos.itens` ≤ 300 itens e 256 KB. |
| 4 | BAIXO | `anon`/`authenticated` tinham TRUNCATE/REFERENCES/TRIGGER (grant padrão do Supabase). TRUNCATE ignora RLS. O PostgREST não expõe TRUNCATE, então hoje não é explorável pela API. | REVOKE desses três privilégios nas tabelas de `public` e nos default privileges do `postgres`. |
| 5 | BAIXO | 10 funções `SECURITY DEFINER` antigas com `search_path=public` sem `pg_temp` explícito. | `ALTER FUNCTION ... SET search_path = public, pg_temp` (corpo não muda). |

**Riscos que ficam (não resolvíveis só em SQL):**

- **Spam / volume:** `pedidos`, `leads`, `visitas`, `consentimentos`, `lista_espera`,
  `vitrines` e `solicitacoes_lgpd` continuam aceitando INSERT anônimo sem limite de taxa
  (o banco não vê IP de forma confiável sem guardar dado pessoal). Recomendação: CAPTCHA
  invisível (ex.: Turnstile) via Edge Function nos formulários de pedido/pré-cadastro, ou
  limite de taxa no gateway.
- **`lgpd_meus_dados(documento, telefone)`:** sem limite de tentativas; força bruta de
  telefone para um CPF conhecido é cara, mas possível. Toda tentativa já vai para
  `auditoria`. Recomendação: limite por documento/hora na própria função (exige reescrever
  o corpo da 015 — fica para revisão própria).
- **`marcar_enviado_whatsapp(p_id)`:** `anon` marca qualquer pedido como enviado se souber
  o UUID (não adivinhável). Baixo.

**Validação (PG isolado `supabase/postgres:17.11.0.018`, 004–027 + 028, e 028 reaplicada):**
anon com status forjado → `aguardando`; payload real do site (pedido, vitrine, lead,
consentimento, visita + `completar_visita`) aceito; equipe mantém status; histórico → zeros para anon (mesmo após
pedido forjado) e números para a equipe; trigger funciona com SELECT em `admins` revogado de anon; campos gigantes recusados; linhas
antigas fora do limite preservadas; TRUNCATE revogado; nenhuma definer com
`search_path=public` restante.

**Desfazer:** `drop trigger pedidos_028_estado_inicial on public.pedidos; drop function
public.pedido_028_estado_inicial();` · `alter table ... drop constraint <tabela>_028_tamanhos;` ·
recriar `historico_do_cliente` a partir de `admin/supabase-vitrine.sql` · `grant truncate,
references, trigger on all tables in schema public to anon, authenticated;` (não recomendado).

## 032_antispam.sql — Anti-spam nos INSERTs anônimos (NÃO APLICADA)

Pendência da auditoria da 028 ("spam/rate limit"). Sem serviço externo e sem conta nova.
Instalar no SQL Editor como `postgres`; idempotente; não altera nem apaga dados existentes.

**O que faz**

1. **Limite por origem + disjuntor global.** Trigger `a000_antispam_032` (BEFORE INSERT; o nome
   começa com `a000` para rodar **antes** dos outros triggers, inclusive os que têm efeito
   colateral como `pedidos_resolver_cliente`) em 7 tabelas. Vale só para `anon` e
   `authenticated` fora da equipe; equipe, `service_role` e SQL Editor nunca são limitados.

   | Tabela | Por origem (curto) | Por origem (dia) | Global por minuto |
   |---|---|---|---|
   | pedidos | 5 / 10 min | 20 | 30 |
   | leads | 10 / hora | 30 | 30 |
   | lista_espera | 10 / hora | 30 | 30 |
   | consentimentos | 20 / hora | 60 | 60 |
   | vitrines | 10 / hora | 30 | 30 |
   | solicitacoes_lgpd | 5 / hora | 10 | 20 |
   | visitas | 120 / hora | 600 | 600 |

   Estourou: erro `muitas tentativas, tente novamente em alguns minutos`, SQLSTATE **`TR429`**
   (PostgREST responde HTTP 400 com `"code":"TR429"`; o site mostra mensagem amigável).
   Tentativa recusada não conta. Inserts concorrentes da mesma tabela são serializados
   (advisory lock) para a contagem não ter corrida.

2. **Origem.** IP lido de `request.headers` (PostgREST): `cf-connecting-ip`, senão `x-real-ip`,
   senão o 1º item de `x-forwarded-for` (o que a documentação do Supabase indica). Valor que não
   é IP válido é ignorado. Sem IP: usa a `sessao` do próprio registro (visitas, leads); sem nada,
   só o disjuntor global. **Limite conhecido:** o 1º item de `x-forwarded-for` pode ser forjado
   pelo cliente (a Cloudflare acrescenta ao header, não substitui). Se em produção só chegar
   `x-forwarded-for`, um robô que troca o header a cada envio escapa do limite por origem — o
   disjuntor global (que não depende de IP) continua valendo.

   **Conferir em produção:** abra o painel (`admin.html`) e entre como **admin**; aperte F12,
   aba Console, cole e dê Enter (cria um cliente novo que reaproveita a sessão já salva no
   navegador; não mostra token nem IP):

   ```js
   window.supabase.createClient(siteConfig.supabase.url, siteConfig.supabase.anonKey).rpc('antispam_032_diagnostico').then(r => console.log(r.error ? r.error.message : r.data))
   ```

   Resposta: `tem_cf_connecting_ip`, `tem_x_real_ip`, `itens_x_forwarded_for`,
   `ip_reconhecido`, `eventos_48h` (só presença/contagem). Não admin recebe `somente admin`.
   O aviso "Multiple GoTrueClient instances" no console é inofensivo. Se `tem_cf_connecting_ip`
   for `false`, avaliar o Turnstile (abaixo).

3. **Honeypot.** Coluna `armadilha` (text) em pedidos, leads, lista_espera, consentimentos,
   vitrines e solicitacoes_lgpd (visitas não tem formulário). Os formulários mandam o campo-isca
   oculto; se vier preenchido, o insert é **descartado em silêncio** (o trigger devolve NULL:
   HTTP 201 sem gravar), para o robô não aprender. Vazio/espaços = humano. A coluna é sempre
   gravada como NULL. Precisa ser coluna porque o PostgREST recusa campo desconhecido no JSON.

**LGPD.** O IP **nunca** é gravado: só `sha256(sal || ip)` em `antispam_032_eventos` (chave,
tabela, instante). O sal é aleatório, gerado na instalação e guardado em `antispam_032_config`
(sem acesso pela API, fora do repositório) — com sal público o hash seria reversível testando
os ~4 bilhões de IPv4. Retenção de 48 h: eventos vencidos são apagados em **toda** escrita
protegida (DELETE com WHERE) e, com a extensão `pg_cron` habilitada no Supabase (Database →
Extensions), também por um job de hora em hora (`antispam_032_limpeza`, criado pela 032 se a
extensão existir; senão a instalação só avisa). Sem `pg_cron` e sem nenhuma escrita no site, um
evento vencido fica até a próxima escrita — habilite o `pg_cron` antes de aplicar para o prazo
valer sempre (rodar a 032 de novo cria o job). Nenhuma das duas tabelas é legível pela API, nem pela equipe. Finalidade: segurança do
serviço (legítimo interesse); citar na política de privacidade na próxima revisão.

**Opção não implementada: Cloudflare Turnstile.** Desafio invisível no formulário + validação do
token no servidor. Exige conta Cloudflare e uma Edge Function do Supabase (com a chave secreta)
recebendo os envios no lugar do POST direto às tabelas. Resolve o robô que forja IP; custa conta
nova, um serviço a manter e mudança no fluxo de envio. Avaliar se o diagnóstico mostrar que só
`x-forwarded-for` chega ou se o disjuntor global começar a disparar com tráfego legítimo.

**Ajustar limites:** os números ficam no `case` de `public.antispam_032_trigger()`; mudar e
rodar o `create or replace function` de novo (revisão antes).

**Desfazer:** para cada tabela, `drop trigger a000_antispam_032 on public.<tabela>;` depois
`select cron.unschedule('antispam_032_limpeza');` (se existir), `drop function public.antispam_032_trigger(), public.antispam_032_ip(),
public.antispam_032_diagnostico(); drop table public.antispam_032_eventos,
public.antispam_032_config;`. A coluna `armadilha` pode ficar (sempre NULL) ou sair com
`alter table ... drop column armadilha` **depois** de tirar o campo do site.

## 033_solidcon_clientes_geo.sql — Mapa de expansão: um pino por cliente CNPJ (NÃO APLICADA)

Pedido do dono: trocar o mapa por bairro (seção Regiões) por **um pino por cliente** no
endereço, com **linha do tempo** (voltar no tempo e ver o crescimento). Esta migração entrega
só o banco; o mapa é da Vitral. Requer 023, 026 e 027 (colunas de endereço CNPJ) e
`eh_equipe()`. Idempotente, `begin/commit`, sem UPDATE/DELETE de dados existentes, nenhum
DELETE/UPDATE sem WHERE (compatível com safeupdate). Não toca ERP, coletor nem as tabelas
023/026 (só lê). Instalar no SQL Editor como `postgres`.

### Objetos

| Objeto | Tipo | Acesso |
|---|---|---|
| `solidcon_clientes_geo` | tabela, PK `documento` | SELECT só equipe (RLS `eh_equipe()`); **nenhuma** escrita direta (anon/authenticated sem INSERT/UPDATE/DELETE) |
| `solidcon_gravar_geo_clientes(p_itens jsonb)` | RPC SECURITY DEFINER, `search_path=pg_catalog` | EXECUTE authenticated; exige `auth.uid()` e `eh_equipe()` |
| `solidcon_geo_pendentes(p_limite int default 100)` | RPC SECURITY INVOKER + checagem `eh_equipe()` | EXECUTE authenticated |
| `solidcon_mapa_clientes()` | RPC SECURITY INVOKER + checagem `eh_equipe()` | EXECUTE authenticated |
| `solidcon_033_norm`, `solidcon_033_chave_endereco` | helpers imutáveis (chave do endereço) | EXECUTE authenticated (usados pelas RPCs INVOKER) |

Colunas de `solidcon_clientes_geo`: `documento` (14 dígitos), `lat`/`lng` `numeric(9,6)`,
`precisao` (`endereco` | `cep` | `bairro` | `nao_encontrado`), `fonte` (`nominatim` |
`manual`), `chave_endereco` (sha256 hex), `geocodificado_em`, `geocodificado_por` (e-mail
da equipe que gravou). `nao_encontrado` = nenhuma tentativa achou; lat/lng NULL; existe para
**não repetir** requisições ao Nominatim (volta a ser tentado só após 30 dias ou se o endereço mudar).

**CPF nunca:** CHECK de 14 dígitos na tabela; a RPC recusa o lote inteiro se vier documento
que não tenha 14 dígitos e ignora documento que não exista em `solidcon_clientes` com
`tipo='cnpj'`. As RPCs de leitura só olham `tipo='cnpj'`.

**Chave do endereço:** calculada **no servidor** a partir de logradouro, número, CEP, bairro,
cidade e UF (minúsculas, sem acento, só letras/dígitos; complemento fica de fora). O
navegador **não** calcula hash: recebe `chave_endereco` de `solidcon_geo_pendentes` e a
devolve igual ao gravar. Se o ERP mudar o endereço, a chave muda, o pino antigo deixa de ser
mostrado (`pino_desatualizado=true`) e o cliente volta para os pendentes como `mudou`.

Sem FK para `solidcon_clientes` (aquele espelho é trocado inteiro a cada sync). CNPJ que sai
do ERP deixa linha órfã na tabela de coordenadas; ela não aparece no mapa. Limpeza manual,
se quiser: `delete from public.solidcon_clientes_geo g where not exists (select 1 from
public.solidcon_clientes c where c.documento=g.documento and c.tipo='cnpj');`

### Contrato para o painel (Vitral)

**1) Pendentes** — `sb.rpc('solidcon_geo_pendentes', { p_limite: 50 })` (1..500).
Devolve linhas `{documento, logradouro, numero, cep, bairro, cidade, estado, chave_endereco,
motivo}`; `motivo` ∈ `novo` | `mudou` | `retentar`. Ordem: quem mais comprou primeiro (janela
da 026). Só CNPJ com algum endereço (logradouro, CEP ou bairro). Sem nome/telefone/e-mail.

**2) Gravar** — `sb.rpc('solidcon_gravar_geo_clientes', { p_itens: [...] })`, 1..200 itens,
cada um com **exatamente** estes campos:

```json
{ "documento": "11222333000181", "lat": -22.9035, "lng": -43.1762,
  "precisao": "endereco", "fonte": "nominatim", "chave_endereco": "<64 hex de pendentes>" }
```

`nao_encontrado` exige `"lat": null, "lng": null`; `manual` não pode ser `nao_encontrado`.
Lat/lng arredondados a 6 casas. Erro estrutural (campo a mais/faltando, documento sem 14
dígitos, repetido, tipo errado, fora da caixa do Brasil, lote vazio/>200) → exceção
`22023`, **nada** é gravado. Não equipe → `42501`. Retorno de sucesso:
`{"status":"ok","gravados":N,"ignorados":[{"documento":"...","motivo":"..."}]}`; motivos por item:

| motivo | quando |
|---|---|
| `cliente_inexistente` | documento não está em `solidcon_clientes` como CNPJ |
| `endereco_mudou` | a chave enviada não é a do endereço atual (o ERP mudou no meio) — buscar pendentes de novo |
| `fora_do_rj` | cliente com `estado='RJ'` e pino fora da faixa do RJ (lat −23,50..−20,60; lng −45,00..−40,80): homônimo de rua/bairro em outro estado |
| `precisao_inferior` | mesmo endereço já tem pino mais preciso (endereco > cep > bairro > nao_encontrado); `nao_encontrado` nunca apaga pino |
| `correcao_manual_preservada` | mesmo endereço já tem pino `manual`; `nominatim` não sobrescreve |

`fonte='manual'` (equipe arrastou o pino) sempre grava, desde que a chave seja a atual.

**3) Mapa** — `sb.rpc('solidcon_mapa_clientes')`, sem parâmetros. Uma linha por cliente CNPJ
do espelho (com ou sem pino, com ou sem compra):

| campo | conteúdo |
|---|---|
| `documento`, `nome`, `bairro`, `cidade`, `estado` | do espelho 023 |
| `lat`, `lng`, `precisao` | só se a coordenada é do endereço **atual**; senão NULL. `precisao='nao_encontrado'` com lat/lng NULL = tentado e não achado |
| `pino_desatualizado` | true = existe coordenada, mas de endereço antigo |
| `primeira_compra`, `ultima_compra` | `date` (dia em America/Sao_Paulo, mesmo `dia` da 026); NULL sem compra |
| `total_centavos`, `cupons` | soma da janela inteira (bigint / integer) |
| `meses` | objeto `{"AAAA-MM": [centavos, cupons], ...}`; `{}` sem compra |

Linha do tempo no navegador, para a data X: cliente aparece se `primeira_compra <= X`;
vendas até X = soma de `meses[m][0]` com `m <= 'AAAA-MM' de X` (granularidade mensal: o
mês de X entra inteiro; para corte exato no dia use só `primeira_compra`/`ultima_compra`).
Cliente "ativo" em X pode ser derivado de `meses` (ex.: comprou nos 3 meses anteriores).
A RPC é chamada uma vez; o controle deslizante filtra tudo localmente, sem nova consulta.
PostgREST corta respostas em 1000 linhas por padrão: com mais de 1000 CNPJs, paginar com
`.range()` (ordem estável por `documento`), como `vendPaginar` já faz.

**Limite importante:** `solidcon_vendas_clientes` guarda só **400 dias** (retenção da 026).
`primeira_compra` é a primeira compra **dentro da janela**, não a primeira da história do
cliente, e a linha do tempo vai no máximo ~13 meses para trás. Para crescimento de anos é
preciso uma tabela de agregado mensal sem expurgo (proposta para migração futura, alimentada
pela RPC da 026) ou um backfill histórico do ERP — fora deste escopo.

### Geocodificação: estratégia e política do Nominatim

Feita **no navegador do admin** (o CSP do admin em `vercel.json` já libera
`https://nominatim.openstreetmap.org` em `connect-src`). Nada no servidor, nada agendado.
Política de uso do Nominatim público (<https://operations.osmfoundation.org/policies/nominatim/>),
que o painel deve cumprir:

- **No máximo 1 requisição por segundo**, sequencial (o painel já usa 1,1 s, `GEO_INTERVALO_MS`),
  uma aba por vez (trava simples, ex. `navigator.locks` ou flag em `localStorage`).
- **Só endereços novos ou mudados** (`solidcon_geo_pendentes`); o resultado vai para o banco,
  que é o cache compartilhado entre todos os admins. Nunca regeocodificar a base inteira.
- **Sem uso em massa automático/repetido:** a geocodificação começa por clique ("Localizar
  N clientes novos"), com botão Parar e limite por clique (sugestão: 100). A carga inicial
  (todos os CNPJs, uma vez) é aceitável dentro de 1 req/s; não repetir.
- Identificação: o navegador manda o `Referer` do painel automaticamente (o Nominatim aceita
  isso em apps web; o browser não deixa trocar o User-Agent). Não suprimir o Referer.
- Parar tudo ao receber HTTP **429** ou **403** e avisar a equipe (bloqueio por excesso).
- Atribuição obrigatória no mapa: "© OpenStreetMap contributors" (dados ODbL).
- Proibido autocomplete/busca enquanto digita contra o Nominatim público.

Ordem de tentativas por cliente (cada tentativa é uma requisição, todas dentro de 1 req/s;
`format=jsonv2&limit=1&countrycodes=br&addressdetails=1`, busca **estruturada**):

1. `street=<numero> <logradouro>&city=<cidade>&state=<UF>&postalcode=<CEP>` → `precisao='endereco'`
   (se o `address` do resultado vier sem `road`, tratar como falha e ir para a próxima).
2. `postalcode=<CEP>&city=<cidade>&state=<UF>` → `precisao='cep'`
   (cobertura de CEP no OSM brasileiro é parcial: falha é comum).
3. Centro do bairro → `precisao='bairro'`: **reaproveitar primeiro** o cache local de
   bairros da seção Regiões (`GEO_CACHE_CHAVE`, sem requisição nova); só se não houver,
   `q=<bairro>, <cidade>, <UF>, Brasil`.
4. Nada achou → gravar `precisao='nao_encontrado'` (lat/lng null). O banco só devolve de
   novo como `retentar` após 30 dias.

Gravar em lotes pequenos (ex.: a cada 10 clientes) para não perder trabalho se a aba fechar.
O banco recusa pino de cliente do RJ fora do RJ (`fora_do_rj`): o painel deve aplicar a mesma
faixa antes de gravar e, se cair fora, seguir para a próxima regra. Enviar ao Nominatim só
endereço de **CNPJ**; nunca nome, documento ou qualquer dado de CPF.

### Validação (PG 18 local isolado; roles, `auth.*` e default privileges do Supabase simulados)

Cadeia `admin/supabase*.sql` + 004–032 (sem a 009 opcional) + 033 aplicada **duas vezes**
sem erro. Casos: anon sem SELECT na tabela e sem EXECUTE nas 3 RPCs (apesar do default
privilege do Supabase); autenticado fora da equipe recebe `somente equipe` e lê 0 linhas;
vendedor (equipe) lista pendentes na ordem por venda; INSERT/UPDATE direto negados; CPF,
documento de 15 dígitos, duplicado, campo extra, lat em string, fora do Brasil,
`nao_encontrado` com coordenada, `manual`+`nao_encontrado`, lote vazio e de 201 itens
recusam o lote inteiro; lote misto grava os válidos e lista `fora_do_rj`/`cliente_inexistente`;
bairro→endereço grava; piora e `nao_encontrado` não apagam pino; manual sobrescreve e é
preservado contra nominatim; `retentar` após 30 dias; mudança de número no ERP → `mudou`,
chave velha recusada (`endereco_mudou`) e o mapa esconde o pino (`pino_desatualizado`);
mapa sem CPF, com primeira/última compra, totais e `meses` corretos; chave igual para o mesmo
endereço com/sem acento e caixa. Nenhuma conexão com ERP ou Supabase.

### Desfazer

```sql
begin;
drop function if exists public.solidcon_mapa_clientes();
drop function if exists public.solidcon_geo_pendentes(integer);
drop function if exists public.solidcon_gravar_geo_clientes(jsonb);
drop table if exists public.solidcon_clientes_geo;
drop function if exists public.solidcon_033_chave_endereco(text, text, text, text, text, text);
drop function if exists public.solidcon_033_norm(text);
commit;
```

Perde só as coordenadas (refazê-las custa novas requisições ao Nominatim). Nada da 023/026 muda.

## 034_pedidos_erp_vinculo.sql — Kanban andando pelo ERP, fase 2 (NÃO APLICADA)

Pedido do dono: os pedidos do site andam sozinhos conforme a venda aparece no ERP.

- **Fase 1** (sem migração) é a função pura `js/admin-erp-casamento.js`. O painel busca `solidcon_vendas_clientes` só dos CNPJs com pedido aberto e mostra o selo "Faturado no ERP · cupom · dd/mm · R$" ou "Conferir no ERP". Os casados em Aguardando ganham o botão **"Confirmar (faturado no ERP)"**, que usa o fluxo de status já existente.
- **Fase 2** (esta migração) faz a mesma conta no banco, grava o vínculo e move **aguardando → confirmado** sem clique. Fica para o dono aprovar.

Requer pedidos (com `frete_centavos`), 015 (`auditoria`), 026 e `eh_equipe()`. Idempotente, `begin/commit`, todos os UPDATE/DELETE com WHERE (safeupdate). Não acessa o ERP nem altera o coletor.

### Regra (idêntica no SQL e no JS; mudar nos dois lugares)

1. `venda.tipo='cnpj'` e `venda.documento` = dígitos de `pedidos.cnpj` (CPF nunca).
2. `venda.dt >= pedido.criado_em - 30 min` e `venda.dia <= dia_SP(pedido.criado_em) + 7`.
3. `|venda - alvo| <= max(5% do alvo, R$ 10,00)`. O alvo é `valor_centavos` **ou** `valor_centavos + frete_centavos` (não se sabe se o cupom inclui frete). Vale a menor diferença; no empate fica "produtos".
4. Uma venda `(dia, cd_pdv, nr_cupom)` casa com no máximo um pedido: índice único no banco.
5. Pedidos em ordem `(criado_em, id)`. **Casado** = exatamente uma venda livre na tolerância, e essa venda não serve para nenhum outro pedido aberto ainda sem vínculo. Qualquer dúvida não grava; a tela mostra "Conferir":
   - várias vendas;
   - venda disputada;
   - valor fora da tolerância;
   - soma de 2–3 cupons que bate.
6. Só `aguardando` e `confirmado` dos últimos 120 dias. `entregue` e `cancelado` nunca são tocados. Status nunca volta. `confirmado` só ganha o vínculo.

O casamento usa as **vendas registradas no ERP** (cupons de `GetVendasResumo`, migração 026). Venda lançada por outro caminho do ERP que não chegue a esse endpoint não casa; o pedido fica como hoje (manual).

### Objetos

| Objeto | Acesso |
|---|---|
| `pedidos_erp_vinculo` (PK `pedido_id` → `pedidos` on delete cascade; único `(dia,cd_pdv,nr_cupom)`; `dt`, `valor_erp_centavos`, `alvo`, `diferenca_centavos`, `confirmou`, `venda_presente`, `casado_em`, `casado_por`) | SELECT só equipe (RLS); sem escrita direta |
| `pedidos_erp_recusa` (pares pedido/cupom desfeitos pela equipe; o automático não recasa) | SELECT só equipe; sem escrita direta |
| `pedidos_casar_erp()` → `{status, casados, confirmados, em_duvida, vendas_sumiram, vendas_voltaram}` | DEFINER, `search_path=pg_catalog`. EXECUTE authenticated. Exige equipe autenticada, **ou** sessão sem JWT de `postgres`/`supabase_admin` (lista fechada: SQL Editor e pg_cron). Pela API a sessão é `authenticator` e não passa; qualquer outro login direto é recusado |
| `pedidos_desvincular_erp(p_pedido uuid)` → `{status, removido}` | DEFINER, só equipe. Status **não** muda: quem confirmou errado reabre pelo fluxo normal |
| `pedidos_034_pode()` | helper interno, sem EXECUTE para a API |

Ao confirmar sozinho:
- **dois UPDATEs:** o primeiro faz a transição; o gatilho `marcar_atualizacao` carimba `now()`. O segundo grava `confirmado_em = dt da venda`, para o faturamento cair no mês da venda.
- **auditoria:** registra `auditoria(acao='pedido_confirmado_erp', ator='automatico')` com cupom e valor; `executado_por` = e-mail da equipe ou `automatico`.
- **WhatsApp:** não abre (exige clique). O painel deve oferecer "Avisar cliente".

Cupom que some do ERP (estorno) vira `venda_presente=false` na próxima rodada. O status **não** é revertido; a tela deve alertar "venda não está mais no ERP".

Com `pg_cron` habilitado, a instalação agenda `pedidos_034_casar_erp` a cada 30 min. Sem ele, rodar `select public.pedidos_casar_erp();` no SQL Editor. **O painel (fase 1) não chama esta RPC**: ele só faz SELECT. Duas integrações ficam para depois de aplicar a 034:
- chamar `sb.rpc('pedidos_casar_erp')` ao abrir Pedidos;
- ler `pedidos_erp_vinculo` e passar os vínculos para `TempRioErpCasamento.casar(..., {vinculos})`, para não sugerir de novo o que o banco já casou.

Fase 1, completude: lote de vendas que bate no teto de 5000 linhas é dividido ao meio até isolar o CNPJ. O CNPJ que sozinho passa do teto fica **fora** do casamento (o pedido aparece como antes) e a tela informa. Resultado parcial nunca vira "Faturado no ERP".

### Validação (PG 18 local isolado, mesmo ambiente da 033, gatilho da 021 desligado como em produção)

034 aplicada 2x sem erro. Casos testados:
- **acesso:** anon sem EXECUTE e sem SELECT; autenticado fora da equipe → `somente equipe`; INSERT direto negado; índice único barra o segundo vínculo do mesmo cupom;
- **casamentos:**
  - pedido com frete casa pelo alvo "produtos+frete" e vai a confirmado com `confirmado_em` = dt da venda;
  - pedido já confirmado só ganha o vínculo;
  - duas vendas → dúvida; dois pedidos para uma venda → dúvida nos dois;
  - não casam: cancelado e entregue, venda antes do pedido (−30 min), venda após 7 dias e valor fora da tolerância;
- **rodadas seguintes:**
  - 2ª rodada não muda nada;
  - desvincular mantém o status, registra recusa e não recasa;
  - cupom removido → `venda_presente=false` com status mantido;
  - quando uma das duas vendas some, o pedido passa a casar (rodada como `postgres`, sem JWT, como o pg_cron);
- **auditoria:** registros corretos.

`js/admin-erp-casamento.js` testado em Node com os mesmos cenários: mesmo resultado, mais "conferir" por valor diferente e soma de cupons, CPF nunca, limite de 30 min e corte de 120 dias. Desfazer + reinstalar OK.

### Desfazer

```sql
begin;
do $$ begin if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname = 'pedidos_034_casar_erp'; end if; end $$;
drop function if exists public.pedidos_casar_erp();
drop function if exists public.pedidos_desvincular_erp(uuid);
drop function if exists public.pedidos_034_pode();
drop table if exists public.pedidos_erp_vinculo;
drop table if exists public.pedidos_erp_recusa;
commit;
```

Status e `confirmado_em` já gravados permanecem; o histórico fica em `auditoria`.

## 035_solidcon_pedidos_erp.sql — Pedidos de venda do ERP por etapa do WMS (APLICADA em 2026-11-13)

Objetivo: o Kanban mostrar os pedidos de venda do ERP (filial 4) na etapa real do depósito. Os dados vêm do módulo `pedidos` do `integracao/solidcon/sync-banco.ps1`.

Requer 019 (`integracoes_autorizadas`), 023 (`solidcon_clientes`), 026 (`solidcon_026_documento_valido`) e `eh_equipe()`. Idempotente, `begin/commit`, DELETE com WHERE (safeupdate). Lock `(5100,35)`.

### Origem no ERP (só SELECT, READ UNCOMMITTED, filial 4)

Leitura de **tabelas** autorizada pelo dono em 2026-11-13, só estas quatro:
- `tbPedido`;
- `tbPedidoVenda`;
- `tbWmsCarga`;
- `tbWmsCargaUmaSaida`.

O validador do sync aceita essas tabelas só nas consultas `pedidos.*`, escritas exatamente como `dbo.tbX`. Qualquer outro `tb*` ou outro módulo é barrado. O documento do cliente vem de `VW_MGN_PARCEIRO` (`CodigoParceiro = tbPedidoVenda.cdPessoaComercial`), o mesmo caminho do módulo `receber`. Não lê endereço, `txObs`, `txJson` nem `tbPedidoItem`. A trava de permissões do login (falha fechado se puder gravar) continua valendo.

### Etapa (prioridade; calculada no coletor, conferida no banco)

| Etapa | Regra | Data exigida |
|---|---|---|
| (fora) | carga cancelada (`dtCancelada`) | — |
| `atendido` | `dtAtendido` e (sem carga **ou** carregou/partida) | `dt_atendido` |
| `saiu` | carregou (`MAX dtCarregou`) ou partida (`dtLiberadaPartida`) | `dt_saida` = a menor das duas |
| `conferido` | `MAX dtConferencia` | `dt_conferencia` |
| `separado` | `MAX dtFim` e 0 saídas abertas | `dt_sep_fim` |
| `separando` | `MIN dtInicio` | `dt_sep_inicio` |
| `na_carga` | tem `cdWmsCarga` | `nr_carga` |
| `aberto` | nenhuma das anteriores | — |

Datas anteriores a 2000 (sentinelas do ERP) contam como vazias. Os horários do ERP são tratados como hora de São Paulo e enviados em ISO com fuso.

### Janela e poda

- Pedidos com `dtPedido` nos últimos 30 dias.
- `saiu` e `atendido` ficam só enquanto a data de conclusão estiver nos últimos 3 dias.
- Cada coleta aceita substitui a tabela inteira, então o que sai da janela some (poda).
- O módulo roda a cada execução da tarefa (5 min).

### Contrato da RPC `solidcon_receber_pedidos_erp(p_itens jsonb, p_coletado_em timestamptz, p_execucao_id uuid)`

- Só a conta de integração (`integracoes_autorizadas`). Equipe, anon e outros recebem `42501`. **Nunca** adicionar a conta de sync a `admins`.
- `p_itens`: até 5000 objetos, até 4 MiB, com campos **exatos**:
  - `cd_pedido`, `dt_pedido`, `etapa`;
  - `dt_carga`, `dt_sep_inicio`, `dt_sep_fim`, `dt_conferencia`, `dt_saida`, `dt_nota`, `dt_atendido`;
  - `cliente_tipo`, `documento`, `valor_centavos`, `nr_carga`.
- `cliente_nome` nunca vem do coletor. Para CNPJ, a RPC preenche com o `nome` de `solidcon_clientes`.
- Datas são `null` ou ISO com fuso, entre 2000 e a coleta + 1 dia. `dt_pedido` é obrigatória e tem no máximo 32 dias.
- `cliente_tipo`:
  - `cnpj` exige um CNPJ válido;
  - `cpf` e `indefinido` exigem `documento = null` (LGPD: só o tipo).
- A etapa precisa da data que a justifica (tabela acima). `valor_centavos` é `null` ou inteiro ≥ 0. `cd_pedido` não repete.
- Recusas: coleta com mais de 1 h ou no futuro, snapshot mais antigo que o último aceito, `execucao_id` repetido e queda de mais de 70% com 20 ou mais linhas anteriores.
- Resposta:
  - sucesso: `{status:'ok', linhas, ...}`;
  - recusa: `{status:'erro', motivo}`, com motivo fixo, sem SQLERRM, e a tabela não muda.

### Objetos

| Objeto | Acesso |
|---|---|
| `solidcon_pedidos_erp` (PK `cd_pedido`; `dt_pedido`, `etapa`, `dt_carga`, `dt_sep_inicio`, `dt_sep_fim`, `dt_conferencia`, `dt_saida`, `dt_nota`, `dt_atendido`, `cliente_tipo`, `documento`, `cliente_nome`, `valor_centavos`, `nr_carga`, `atualizado_em`) | SELECT só equipe (RLS `eh_equipe()`); sem escrita direta |
| `solidcon_pedidos_erp_sync` (`status`, `linhas`, `por_etapa` jsonb, `coletado_em`, `execucao_id`, `mensagem`; 30 dias) | SELECT só equipe |
| `solidcon_receber_pedidos_erp(...)` | DEFINER, `search_path=pg_catalog`; EXECUTE authenticated; barrada sem `integracoes_autorizadas` |

Para o painel:
- ler `solidcon_pedidos_erp` ordenado por `etapa, dt_pedido`;
- o frescor é `max(coletado_em)` de `solidcon_pedidos_erp_sync` com `status='ok'`.

### Pendências conhecidas

- **Valor do pedido:** `valor_centavos` vai sempre `null`. As colunas de `tbPedidoItem` ainda não foram confirmadas. `sync-banco.ps1 -Testar` lista as candidatas (só metadados) para decidir depois.
- **Cliente:** falta confirmar que `cdPessoaComercial` = `VW_MGN_PARCEIRO.CodigoParceiro`. O `-Testar` mostra quantos pedidos resolveram para CNPJ/CPF/indefinido. Muitos `indefinido` indicam ligação errada; nesse caso, nada identifica ninguém.

### Instalar

1. Aplicar a 035 no SQL Editor.
2. Copiar o `sync-banco.ps1` novo para o servidor.
3. No servidor, rodar `sync-banco.ps1 -Testar`. Ele roda só o módulo pedidos, imprime as contagens por etapa e por tipo de cliente e as colunas candidatas. Não grava nada no Supabase, na agenda nem em arquivo.
4. A partir daí, a tarefa de 5 min já envia o módulo.

### Validação (PG 18 local isolado, mesmo ambiente da 033/034)

035 aplicada 2x. 26 casos:
- **acesso:**
  - anon sem EXECUTE e sem SELECT;
  - equipe não escreve pela RPC nem por INSERT;
  - fora da equipe lê 0 linhas;
  - vendedor lê;
- **payload:**
  - o lote gerado por `sync-banco.ps1 -Simular` é aceito (8 pedidos, nome preenchido só nos CNPJ, 0 identificação em CPF/indefinido);
  - recusas com o motivo certo e tabela intacta: campo extra `cliente_nome`, CPF com documento, etapa sem data, CNPJ inválido, pedido com 40 dias, duplicado, data sem fuso, etapa desconhecida, valor negativo, `dt_pedido` nula, coleta antiga e execução repetida;
- **trava de queda:** 25 → 5 recusado; 25 → 10 aceito (poda).

### Desfazer

```sql
begin;
drop function if exists public.solidcon_receber_pedidos_erp(jsonb, timestamptz, uuid);
drop table if exists public.solidcon_pedidos_erp;
drop table if exists public.solidcon_pedidos_erp_sync;
commit;
```

No servidor, voltar o `sync-banco.ps1` anterior. Sem a 035, o módulo `pedidos` falha só ele (código de saída 5); os outros módulos seguem.
