'use strict';
// 070-CAL Hotfix (somente SQL sobre 91544d9): verificacao estrutural de seguranca, grants privados e preservacao da 068V.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('070-CAL SQL e rollback: seguranca, grants privados e preservacao da 068V', () => {
    const lf = (s) => s.replace(/\r\n/g, '\n');
    const mig = lf(fs.readFileSync(path.join(__dirname, '../../admin/migracoes/070_cal_sem_veiculo.sql'), 'utf8'));
    const rb = lf(fs.readFileSync(path.join(__dirname, '../../admin/migracoes/070_cal_rollback.sql'), 'utf8'));

    const migSemCom = mig.replace(/--[^\n]*/g, '');
    assert.match(migSemCom, /if p_veiculo is null then\n\s+if not exists \(select 1 from public\.rota_veiculos v where v\.ativo and public\.rota_065_sai\(v\.id, p_dia\)\) then/);
    assert.match(migSemCom, /revoke all on function public\.rota_070_dia_motivo\(bigint, date, text, boolean\) from public, anon, authenticated, service_role;/);
    assert.match(migSemCom, /revoke all on function public\.rota_070_saida_gravar\(bigint, date, uuid, boolean\) from public, anon, authenticated, service_role;/);
    assert.doesNotMatch(migSemCom, /rota_054_padrao_separando|rota_070_fechavel|rota_070_virar_dia|rota_066_sugestoes/, '070-CAL nao mexe em 068V/fechamento/066');
    assert.doesNotMatch(migSemCom, /insert into public\.rota_pedido_veiculo|insert into public\.rota_cliente_veiculo/i, '070-CAL nunca atribui veiculo');
    assert.match(rb, /create or replace function public\.rota_070_dia_motivo/);
    assert.match(rb, /create or replace function public\.rota_070_saida_gravar/);
    assert.doesNotMatch(rb, /drop table|truncate/i, 'rollback preserva dados');
});
