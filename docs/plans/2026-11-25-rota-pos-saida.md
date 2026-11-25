# Rota após saída — implementação sobre de06144

Objetivo: impedir acréscimos automáticos à rota que já saiu e impedir Enviado antes do primeiro despacho compatível com o faturamento. Não publicar nem corrigir dados de produção.

1. Reproduzir a inclusão das 10:30 e o faturamento de 24/11 à noite com foto da rota de 24/11. Cobrir 07:59, 08:00 e 08:01 SP.
2. Core: saída efetiva = maior entre a saída da foto ativa e a primeira hora de saída >= faturamento. Manter dias corridos no fallback e o calendário por veículo no adiamento do planejamento.
3. Migração 061/rollback: corte servidor na inclusão 054, sob a mesma trava 5001; candidatos privados com o mesmo corte; pendência SQL com a mesma regra do core. Não alterar fotos existentes, grants ou a inclusão manual 050. Limite inclusivo na hora exata; depois da hora não inclui.
4. Core/WA: cortar projeção automática e passar relógio explícito do tique. Não reordenar nem mudar revisão depois da saída. Se o primeiro fechamento automático atrasar, filtrar pedidos criados ou com início da separação depois do corte (core e servidor050); previsão anterior ao corte continua entrando. Fechamento manual preservado. Conservar o fallback S10 após avanço noturno de etapa usando dt_sep_inicio posterior à saída da véspera.
5. Preparar SQL de reparo separado para os nove pedidos, com confirmação explícita, validações e rollback padrão. Não executar contra o projeto.
6. Testar serialmente em Node e PG18 local isolado: idempotência, rollback, permissões, corte, ajuste manual e datas SP. Entregar pacote, hashes, diff e relatório STATUS para Vitral/TL.

Decisão operacional: pedidos adiados continuam pela próxima saída do veículo (regra existente); nenhum item histórico é movido na migração. A correção dos nove itens requer aprovação e execução separadas pelo TL. O relógio de segurança é do servidor; relógio do browser só evita propostas inúteis.
