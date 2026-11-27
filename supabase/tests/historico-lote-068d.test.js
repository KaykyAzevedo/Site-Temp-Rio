'use strict';
// 068 D r2 sobre 070: verificacoes estruturais da migracao e rollback (sem duplicar virada de meia-noite).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lf = (s) => s.replace(/\r\n/g, '\n');

test('068D r2 sobre 070: le estado canonico do 070 sem duplicar regra de meia-noite e respeita seguranca RLS/ACL', () => {
  const mig = lf(fs.readFileSync(path.join(__dirname, '../../admin/migracoes/068_d_historico_lote_dia.sql'), 'utf8'));
  const rb = lf(fs.readFileSync(path.join(__dirname, '../../admin/migracoes/068_d_rollback.sql'), 'utf8'));

  // Exige 070 e usa estado_070='historico', rota_070_politica e rota_070_hoje
  assert.match(mig, /to_regprocedure\('public\.rota_070_estado\(bigint\)'\)/);
  assert.match(mig, /to_regclass\('public\.rota_070_politica'\)/);
  assert.match(mig, /\(public\.rota_070_estado\(e\.cd_pedido\)->>'estado_070'\)\s*=\s*'historico'/);
  assert.match(mig, /from public\.rota_070_politica/);
  assert.match(mig, /public\.rota_070_hoje\(\)/);

  // Nao duplica a virada de meia-noite com rota_068_hoje()
  assert.doesNotMatch(mig, /rota_068_hoje\(/, '068D r2 nao deve duplicar relogio/virada usando rota_068_hoje');
  assert.doesNotMatch(mig, /data_entrega\s*<\s*public\.rota_068_hoje/, '068D r2 nao deve filtrar historico por data_entrega < rota_068_hoje');

  // Seguranca RLS / ACL / guards
  assert.match(mig, /enable row level security/);
  assert.match(mig, /using \(\(select public\.eh_equipe\(\)\)\)/);
  assert.doesNotMatch(mig, /for all/i);
  assert.match(mig, /revoke all on function public\.rota_068_historico\(date\) from public, anon, authenticated, service_role/);
  assert.match(mig, /revoke all on function public\.rota_068_lote_purgar\(\) from public, anon, authenticated, service_role/);
  assert.match(mig, /name !~ '\^lote\/'/);

  // Rollback preserva acervo e nao toca em nenhum objeto do 070
  assert.doesNotMatch(rb, /drop table/i);
  assert.doesNotMatch(rb, /rota_070_/i);
  assert.match(rb, /drop function if exists public\.rota_068_historico\(date\)/);
  assert.match(rb, /drop policy if exists canhotos_068_lote_insere on storage\.objects/);
});
