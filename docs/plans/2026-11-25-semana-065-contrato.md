# 065 — Semana programável: contrato front ↔ backend

Worktree: `C:\Users\emporio\Downloads\temp-rio-065`, ramo `semana-065`, criado a partir de 3e59fa3. Sem commit e sem publicar.

Quem mexe em quê:

- **Forja:** `admin/migracoes/065_*.sql` e os testes SQL/PG do 065.
- **Vitral:** `js/admin-rota.js`, `js/admin-rota-quadro.js`, `css/admin-rota-quadro.css`, `admin.html` e os testes de front.
- `supabase/functions/_shared/rota-core.js`: só depois de combinar.

Datas são `'YYYY-MM-DD'` no fuso de São Paulo. A semana vai de segunda (`inicio`) a sábado (`inicio + 5`).
As três RPCs são `security definer`, com a checagem feita dentro delas (a leitura precisa de `rota_050_hoje()`, que é privada). Ler exige `eh_equipe()`; salvar e marcar exigem `pode_marcar_rota()`.
Só a falta de permissão levanta exceção (`42501`). Todo o resto responde `{status:'erro', motivo}`.

## Ler — `rota_065_ler_semana(p_inicio date) returns jsonb`

```json
{ "status": "ok", "inicio": "2026-11-30", "hoje": "2026-11-25", "versao": 0,
  "itens": [ { "cd_pedido": 1531, "dia": "2026-12-01", "veiculo_id": "s10", "ordem": 1, "removido": false } ],
  "sem_saida": [ { "dia": "2026-12-03", "veiculo_id": "s10", "motivo": "médico" } ],
  "fechados": [ "2026-12-01" ] }
```

- `versao` = 0 quando a semana nunca foi salva. Sobe a cada gravação da semana, em qualquer veículo, inclusive pela 047.
- `sem_saida` lista só as datas avulsas ("veículo não sai nesta data"). Os dias fixos continuam em `rota_veiculos.dias_sem_saida`.
- Erro: `parametro_invalido` (inicio nulo ou que não cai numa segunda).

## Salvar — `rota_065_salvar_semana(p_inicio date, p_versao_base bigint, p_itens jsonb, p_veiculo text default null) returns jsonb`

- `p_itens`: `[{cd_pedido:int, dia, veiculo_id:text, ordem:int|null, removido:bool}]`, no máximo 3000, `cd_pedido` sem repetir.
- `p_veiculo = null` substitui o plano da semana **inteira** (todos os veículos). Com um id, substitui só aquele veículo,
  e todo item tem de ter `veiculo_id = p_veiculo`.
- Só dias **editáveis** são substituídos: `dia > hoje`, dia não fechado, veículo ativo que sai naquele dia.
  As linhas que já estão em dias não editáveis ficam como estão. Um item num dia não editável recusa o envio inteiro.
- `ordem`:
  - veículo modo `porta`, item não removido: 1..N sem buracos dentro de cada (dia, veículo);
  - modo `cd_ceasa`: `null`;
  - `removido: true`: `ordem null`. O pedido fica tirado daquele dia e **não entra no fechamento**.
- Sucesso: `{status:'ok', versao:<nova>, itens:<n>}`.
- Erro: `{status:'erro', motivo, cd_pedido?}`. Nada é gravado e a versão não muda. Motivos possíveis:
  `parametro_invalido`, `versao_antiga`, `veiculo_invalido`, `dia_sem_saida`, `dia_bloqueado`,
  `pedido_inexistente`, `pedido_duplicado`, `ordem_invalida`.
  - `versao_antiga`: outra pessoa salvou antes. O quadro mostra o aviso e recarrega, sem mesclar.

## Veículo não sai nesta data — `rota_065_marcar_sem_saida(p_dia date, p_veiculo text, p_sem_saida boolean, p_versao_base bigint, p_motivo text default null) returns jsonb`

- `p_sem_saida = true` marca a data e tira do plano os pedidos daquele veículo naquele dia. Eles voltam para a bandeja.
  `false` desmarca a data; os pedidos não voltam sozinhos para o dia.
- `p_motivo` aceita até 80 caracteres ou `null`. Só vale para dia editável.
- Sucesso: `{status:'ok', versao, devolvidos:[cd_pedido...]}`.
- Erro: `parametro_invalido`, `versao_antiga`, `veiculo_invalido` ou `dia_bloqueado`.

## Compatibilidade

- `rota_047_salvar_semana` e `rota_046_salvar_semana` continuam funcionando e também sobem a versão.
- Antes de a 065 estar aplicada, o front recebe `PGRST202` ou `42883`. Nesse caso cai no 047, como hoje.
- O fechamento do dia (050) passa a respeitar o plano: `ordem` salva e `removido` fora. O front não muda nada por isso.

## Implementado (Forja, 25/11) — `admin/migracoes/065_semana_plano.sql` + `065_rollback.sql`

- **Versão:** gatilho por linha em `rota_plano_semana` sobe a versão de cada semana tocada (046/047, escrita direta e 065).
  "Não sai nesta data" também sobe. Salvar sobe sempre, mesmo com a mesma lista.
- **Fechamento:** `rota_050_gravar_itens` (corpo da 055 + 1 linha) chama `rota_065_aplicar_plano(hoje, lista do painel)`.
  Vale para o fechamento manual (`rota_050_fechar`) e para o automático (`rota_050_fechar_auto`, Edge).
  - Planejado para hoje entra no veículo e na ordem do plano. Os demais pedidos que o painel mandou vêm depois, renumerados.
    CD/CEASA fica com ordem nula.
  - Saem da foto: planejado para outro dia, removido, veículo com "não sai nesta data", pedido ignorado (045) e pedido não pendente (055/063).
  - Veículo sem plano para hoje: a lista do painel passa sem mudança.
- **Limitação:** feriados não são checados no servidor (igual à 047; quem cuida é o painel/rota-core).
  A previsão do painel (rota-core, modo marcação) ainda trata o plano como informação (`planoDia`).
  A foto segue o plano; se quiserem que a previsão de hoje mostre o mesmo antes de fechar, isso é mudança no rota-core, a combinar.
- **Teste:** `supabase/tests/rota-semana-065.sql` (sobre `entrega-sem-canhoto.sql`, DB `sentinela_separando_*`), 57 checks.

## Correções Sentinela B065-R1..R4 (Forja, 26/11) — mesma migração 065, ainda não publicada

- **R1 (corte 061 no automático):** no fechamento automático (`rota_dia_fechada.automatico`), o corte 061 vale sobre a
  lista FINAL, já com o plano: pedido criado ou com separação iniciada depois de `hora_saida` (truncada ao minuto) não
  entra, mesmo que esteja no plano. 08:00:00 exato entra; 08:00:00.001 não. A ordem é renumerada só quando algo sai.
  O fechamento manual continua livre do corte.
- **R2 (inclusão 054):** `rota_054_candidatos` e `rota_054_incluir` seguem o plano: outro dia, removido, veículo sem
  saída (fixo ou avulso) ficam fora. O veículo é o do plano de hoje. `rota_054_incluir` pega a trava 4601 depois da
  5001, então espera uma gravação de plano em andamento e relê o plano. Se a proposta do painel/Edge (o rota-core ainda
  não conhece o plano 065) trouxer pedido que o plano tira e que não está na foto, a 054 aceita sem ele e renumera a
  ordem 1..N. Qualquer outra diferença continua 40001. "Trazer para hoje" (`rota_050_ajustar`) continua livre.
- **R3 (linhas não editáveis):** uma linha está **travada** quando é da segunda desta semana (SP) em diante e não é
  editável (hoje, dia fechado, passado desta semana, veículo inativo ou sem saída). `rota_065_salvar_semana` recusa
  mexer nela, devolvendo `{status:'erro', motivo:'dia_bloqueado', cd_pedido, origem:true}` (o front já mostra a mensagem
  de `dia_bloqueado`). O DELETE só pega linha editável completa. Sobra de semana anterior (que a limpeza 046 ainda não
  apagou) pode ser reprogramada. O gatilho `rota_065_plano_guardar` recusa com 22023 o DML direto do `authenticated`
  (policies 046) em linha travada ou para dia não editável. Funções DEFINER passam direto.
- **R4 (047/046 legadas):** a `rota_047_salvar_semana` (e a 046, que chama ela) grava a programação legada como ATIVA
  (`removido=false`) e com ordem 1..N por dia, na ordem da lista, também no ON CONFLICT. Item para dia não editável, ou
  de linha travada, fica sem efeito: o cliente antigo que reenvia o dia de hoje não apaga nem move nada. O rollback
  deixa a 047 num corpo compatível (limpa `removido` e grava a ordem, sem depender da 065) e devolve a 054 exata da 061.
- **Ordem das travas:** 5201 → 5001 → 4601. Nenhuma função pega a 4601 e depois a 5001.
- **Testes:** `rota-semana-065.sql` com 242 checks (219 + 23 B065; 246 com o R2-A abaixo). Opt-in `rota-semana-065.pg.test.js`
  (`ROTA_SEMANA_065_TEST_DB`) testa a troca concorrente do plano durante a 054.
- **R2-A (veículo do plano x marcação, revalidação Sentinela):** o veículo do plano de HOJE manda. Quando a proposta do
  painel/Edge (o rota-core segue a marcação) põe noutro veículo um candidato cujo veículo vem do plano de hoje, a
  `rota_054_incluir` tira esse pedido da proposta, valida o resto como antes e põe o pedido no veículo do plano, no fim
  da rota dele (CD/CEASA: ordem nula). Vale nos dois sentidos (S10↔Strada) e para o CD/CEASA. As outras inclusões da
  mesma chamada entram, e o retry não duplica. Divergência real continua 40001. O rota-core não muda.
  Testes: `rota-semana-065.sql` com 246 checks.
