# 066 — Assistente da semana: contrato real (Forja, 26/11)

O sistema **sugere e avisa**. O Márcio decide. Nada aqui grava plano nem muda o fechamento das 08:00, onde só o plano salvo vale (regra 065).
Arquivos: `admin/migracoes/066_rota_sugestoes.sql` e `066_rollback.sql`. Teste: `supabase/tests/rota-sugestoes-066.sql`, com 39 checks (43 com as correções B066 abaixo).

## `rota_066_sugestoes(p_semana date) returns jsonb` — só leitura, exige `pode_marcar_rota()`

- Sem permissão: **42501**.
- `p_semana` tem de ser uma segunda-feira, entre hoje − 8 semanas e hoje + 12 semanas. Fora disso: `{status:'erro', motivo:'parametro_invalido'}`.
- Sucesso. Os campos **a mais** em relação ao stub estão marcados com `+`:

```json
{ "status": "ok", "semana": "2026-11-30", "hoje": "2026-11-29", "versao": 7,
  "pedidos": [ { "cd_pedido": 98106, "dia_sugerido": "2026-11-30", "veiculo_sugerido": "s10",
                 "motivo": ["vencido"], "texto": "Venceu ter 24/11 — primeiro dia livre seg", "score": 130.0,
                 "prazo": "2026-11-24", "atrasado_se_dia": "2026-11-25", "dia_plano": null } ],
  "dias": [ { "dia": "2026-12-01", "veiculo_id": "s10", "cx_planejadas": 290.0, "cx_capacidade": 300.0, "paradas": 1,
              "folga_cx": 10.0, "paradas_max": null, "folga_paradas": null } ],
  "encaixes": [ { "dia": "2026-12-01", "veiculo_id": "s10", "cd_pedido": 98110, "distancia_km": 1.0, "perto_de_cd": 98109,
                  "texto": "S10 tem 10 cx livres na ter: cabe Pedido 98110 (1,0 km de Cliente I)" } ] }
```

- `+status`, `+semana`, `+hoje`. `versao` é a de `rota_065_semana` para essa segunda. Se for diferente da versão que o quadro tem, as sugestões são de outro estado do plano: releia.
- **pedidos**: só os pendentes **sem programação válida**, ou seja, sem plano, removidos, com plano antigo, ou programados **depois do prazo**.
  Pedido programado dentro do prazo não aparece. Ficam fora os que estão na foto de hoje, os ignorados (045) e os de etapa saiu/atendido.
  - `dia_sugerido` e `veiculo_sugerido` ficam `null` quando o veículo não sai em nenhum dia editável da semana (motivo `sem_dia_de_saida`).
  - `+dia_plano`: o dia programado hoje quando o plano atrasa o pedido (motivo `atrasa_no_plano`). Nos outros casos, `null`.
  - `atrasado_se_dia` = prazo + 1 dia. Qualquer dia a partir dele atrasa. O selo "Atrasa X dia(s)" é a diferença em dias corridos: dia − prazo.
  - Ordem da lista: score maior primeiro. O vencido ou que vence hoje fica no topo (score ≥ 100).
  - Códigos de `motivo` (o primeiro é sempre o de prazo):
    - prazo: `prazo`, `vencido`, `vence_hoje`, `atrasa` (não há saída até o prazo), `sem_prazo`, `sem_dia_de_saida`;
    - os demais: `atrasa_no_plano`, `mesma_regiao`, `costuma_dia`, `costuma_junto`, `feedback_ignorado`, `feedback_aceito`, `sem_capacidade`, `sem_geo`, `sem_marcacao`.
  - `sem_geo` = o cliente não tem posição. O pedido fica fora da linha do mapa e não entra em encaixes.
- **dias**: uma linha por dia **editável** da semana e veículo ativo que **sai** nesse dia. Valem os dias fixos, os feriados, o "não sai nesta data" e o veículo ativo.
  Dia/veículo que não aparece na lista não tem saída.
  - `cx` = caixa equivalente de 24 (volume do rota-core ÷ 9). `cx_capacidade` e `folga_cx` ficam `null` quando o veículo não tem limite.
  - `paradas` conta clientes distintos programados. No CD/CEASA, conta no máximo 1.
  - `+paradas_max` = média histórica de paradas por dia do veículo, arredondada para cima. Fica `null` sem histórico ou no CD/CEASA, e aí `folga_paradas` também fica `null`.
  - O quadro deve somar os cartões do **rascunho** por cima destes números, que vêm do plano salvo.
- **encaixes**: até 3 por dia/veículo. São pedidos da lista acima, a até 5 km de uma parada já programada naquele dia/veículo, que cabem na folga e não atrasam.

## `rota_066_registrar(p_cd bigint, p_acao text, p_dia date) returns jsonb` — exige `pode_marcar_rota()`

- `p_acao`: `'aceita'` (ao Aceitar e ao salvar a semana com a sugestão) ou `'ignorada'` (ao Ignorar). `p_dia` = o dia que foi sugerido.
- Respostas: `{status:'ok'}`, `{status:'erro', motivo:'parametro_invalido'|'pedido_inexistente'}` ou 42501.
- O mesmo clique repetido dentro de 1 minuto não duplica.
- Ignorar pesa contra aquele cliente naquele dia da semana, com meia-vida de 4 semanas, e pesa bem mais contra aquele pedido naquele dia.

## Memória ("aprende com as escolhas")

- Gatilhos alimentam `rota_066_historico`: a foto ativa de dia fechado (o que saiu) e o plano ativo (o que o Márcio programou).
- Desprogramar hoje ou um dia futuro apaga a linha da memória. A limpeza de dia passado (046) não apaga.
- A sugestão usa as 12 semanas anteriores à semana pedida, com meia-vida de 4 semanas.
  Para cada cliente, conta o dia da semana e o veículo mais frequentes e com quem ele costuma ir no mesmo dia/veículo.

## Sem a 066 aplicada

A RPC volta `PGRST202`/`42883`. O quadro funciona sem sugestões.

## Correções Sentinela B066-R1..R3 (Forja, 26/11)

- **R1:** `dias` (cx e paradas), os encaixes e a âncora de "mesma região" contam só a programação que **ainda vale**:
  plano ativo de pedido pendente (etapa aberto..conferido, 055/063, ou seja, sem Recebido nem canhoto), fora da 045 e
  fora da foto de hoje. Linha de plano de pedido entregue ou ignorado não ocupa o dia.
- **R2:** o `score` funciona em faixas que os pesos não atravessam. Pedido sem dia no prazo (`vencido`, `vence_hoje`,
  `atrasa`) tem score ≥ 100 (100 + 5 por dia de atraso, até +30, mais os bônus) e fica sempre no topo. Os demais ficam
  em no máximo 99. Capacidade e feedback negativo aparecem no `motivo` e só escolhem o dia dentro da faixa.
- **R3:** `rota_066_registrar` usa uma trava por (pedido, ação, dia) antes de conferir a duplicidade. Duas chamadas
  simultâneas com a mesma decisão gravam 1 registro, e as duas respondem `ok`. Ação ou dia diferente não é a mesma decisão.
- **Testes:** `rota-sugestoes-066.sql` com 43 checks na 066 (289 no total) e o opt-in
  `rota-sugestoes-066.pg.test.js` (`ROTA_SUGESTOES_066_TEST_DB`), com duas sessões e uma barreira SHARE.
