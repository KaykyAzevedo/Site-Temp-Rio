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
| 021_total_servidor_solidcon.sql | A, antes 011 | NÃO APLICADA; depende de revisão/aprovação |
| 022_solidcon_vendas.sql | A, antes 018 | APLICADA (2026-11-11) |
| 023_solidcon_clientes.sql | Espelho minimizado de clientes | APLICADA (2026-11-11) |
| 024_solidcon_publico.sql | Disponibilidade e ranking públicos, vínculo codigo_erp | APLICADA (2026-11-11) |

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
