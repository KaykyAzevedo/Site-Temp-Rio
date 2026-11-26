'use strict';
const rpcTabela = require('./rpc-paginada-fixture.js');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../functions/_shared/rota-core.js'),W=require('../functions/_shared/whatsapp-core.js'),UI=require('../../js/entrega-admin.js');
const p={cd_pedido:1530,etapa:'atendido',dt_saida:'2026-11-23T17:00:00-03:00',dt_pedido:'2026-11-22T07:00:00-03:00',documento:'12000000001530',caixas_24:1,caixas_48:0,caixas_outras:0};
const c={cd_pedido:1530,id:10,confirmado_em:'2026-11-25T16:00:00-03:00',confirmado_nome:'Marcio <QA>'};
const ctx={cfg:R.cfgDe({hora_saida:'08:00',canhoto_desde:'2026-01-01T00:00Z'}),confirmacoes:{1530:c},canhotos:{},agora:'2026-11-25T16:01:00-03:00'};
test('063 recebido pela marca, data SP e foto tem precedencia; desfazer volta a pendencia',()=>{
 assert.equal(R.etapaEntrega(p,ctx),'recebido');assert.equal(R.recebidoEm(p,ctx),c.confirmado_em);assert.equal(R.recebidoRecente(p,ctx),true);
 assert.equal(R.pendenteEntrega(p,{},'2026-11-25',ctx.cfg,ctx),false);
 assert.equal(R.recebidoRotulo(p,ctx),'Recebido (marcado por Marcio <QA>)');
 const comFoto={...ctx,canhotos:{1530:[{enviado_em:'2026-11-25T17:00:00-03:00'}]}};
 assert.equal(R.recebidoEm(p,comFoto),'2026-11-25T17:00:00-03:00');assert.equal(R.recebidoRotulo(p,comFoto),'Recebido (canhoto)');
 const desfeita={...ctx,confirmacoes:{1530:{...c,desfeito_em:'2026-11-25T16:05:00-03:00'}}};
 assert.equal(R.etapaEntrega(p,desfeita),'enviado');assert.equal(R.pendenteEntrega(p,{},'2026-11-25',ctx.cfg,desfeita),true);
 assert.equal(R.etapaEntrega(p,{...comFoto,confirmacoes:desfeita.confirmacoes}),'recebido');
 assert.equal(R.recebidoRecente(p,{...ctx,agora:'2026-11-27T02:59:59Z'}),true);
 assert.equal(R.recebidoRecente(p,{...ctx,agora:'2026-11-27T03:00:00Z'}),false);
});
test('063 nao volta na rota/semana/sugestoes nem entra Enviou pelo resumo',()=>{
 const o={...ctx,marcacao:true,porPedido:{1530:'s10'},hoje:'2026-11-25'};
 const pl=R.planejar([p],{},'2026-11-25',o);assert.ok(!pl.entregues[1530]);assert.equal(pl.aguardando.length+pl.fica.length,0);
 assert.equal(R.planejarSemana([p],{},'2026-11-23',o).resumo.pedidos,0);
 const resumo=W.montarPedidosDia({pedidos:[p],...ctx},new Date(ctx.agora),{});assert.equal(resumo.resumo.enviou,0);assert.equal(resumo.resumo.pronto,0);
 assert.equal(R.enviadoAntigo(p,{},'2026-12-15',ctx.cfg,ctx),false);
});
test('063 sugestao com trajeto valido ignora recebido; lista da rota tem Recebido para Marcio',()=>{
 const origem=R.ROTA.ORIGEM,anchor={...p,cd_pedido:1531,documento:'12000000001531'};
 const cs={[p.documento]:{nome:'Cliente',pos:[origem[0]+.01,origem[1]+.01]},[anchor.documento]:{nome:'Ancora',pos:[origem[0]+.02,origem[1]+.02]}};
 const o={...ctx,marcacao:true,porPedido:{1530:'s10',1531:'s10'},hoje:'2026-11-25'};
 const rota=R.planejar([anchor],cs,'2026-11-25',o);
 assert.ok(R.sugestoesJuntar([anchor,p],cs,rota,{...o,confirmacoes:{}}).sugestoes.length>0);
 assert.equal(R.sugestoesJuntar([anchor,p],cs,rota,o).sugestoes.length,0);
 const window={TempRioRotaCore:R,TempRioEntregaAdmin:UI};
 const src=fs.readFileSync(require.resolve('../../js/admin-rota.js'),'utf8').replace('raiz.TempRioRota = {','raiz.qa={st,celulaFechada,seletorPedidoV2,optsPlano};raiz.TempRioRota = {');
 vm.runInNewContext(src,{window,Intl,Date,setTimeout,clearTimeout,console});
 const q=window.qa;q.st.papel='vendedor';q.st.podeMarcar=true;q.st.entrega063=true;q.st.v2=true;q.st.cfg=ctx.cfg;
 const x={p,veiculo:'s10',marcacao:'pedido'};
 assert.match(q.celulaFechada([x],'s10','Cliente'),/>Recebido<\/button>/);
 assert.match(q.seletorPedidoV2(x,'Cliente',true),/>Recebido<\/button>/);
 q.st.podeMarcar=false;assert.ok(!q.celulaFechada([x],'s10','Cliente').includes('data-entrega063'));
 q.st.confirmacoes=ctx.confirmacoes;assert.equal(q.optsPlano().confirmacoes[1530].id,10);
});
test('063 UI: Recebido para marca_rota; desfazer so admin; nomes escapados e foto identificada',()=>{
 const base={...ctx,confirmacoes:{},instalada:true,papel:'vendedor',podeMarcar:true};
 assert.match(UI.html(p,base),/>Recebido<\/button>/);
 assert.ok(!UI.html(p,{...base,podeMarcar:false}).includes('data-entrega063'));
 assert.ok(!UI.html(p,{...base,instalada:false}).includes('data-entrega063'));
 const marcado={...base,confirmacoes:{1530:c}};
 assert.match(UI.html(p,marcado),/marcado por Marcio &lt;QA&gt;/);assert.ok(!UI.html(p,marcado).includes('Desfazer'));
 assert.match(UI.html(p,{...marcado,papel:'admin'}),/Desfazer/);
 assert.match(UI.html(p,{...marcado,canhotos:{1530:[{}]}}),/Recebido \(canhoto\)/);
});
test('063 coleta limitada, migracao ausente desabilita e erro real nao vira entregue/pendente',async()=>{
 let chamadas=0;const sb={rpc(n,a){assert.equal(n,'rota_063_ler_entregas');assert.ok(a.p_cds.length<=200);chamadas++;return Promise.resolve({data:a.p_cds.includes(1530)?[c]:[]});}};
 const r=await R.coletarConfirmacoes(sb,Array.from({length:401},(_,i)=>({...p,cd_pedido:1530+i})));assert.equal(chamadas,3);assert.equal(r.porPedido[1530].id,10);
 for(const code of ['PGRST202','42883'])assert.equal((await R.coletarConfirmacoes({rpc:()=>Promise.resolve({error:{code}})},[p])).instalada,false);
 for(const code of ['42501','57014','PGRST000'])await assert.rejects(R.coletarConfirmacoes({rpc:()=>Promise.resolve({error:{code}})},[p]),new RegExp(code));
 await assert.rejects(R.coletarConfirmacoes({rpc:()=>Promise.resolve({data:[{...c,id:null}]})},[p]),/invalido/);
});
test('063 acao usa RPC separada e id de desfazer, nunca escreve canhoto',async()=>{
 const chamadas=[],sb={rpc(n,a){chamadas.push([n,a]);return Promise.resolve({data:{id:10,ativa:n.includes('confirmar')}});},from(){throw Error('nao escrever canhoto');}};
 await UI.executar(sb,'confirmar',1530,null,'motivo','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 await UI.executar(sb,'desfazer',1530,10);
 assert.equal(chamadas[0][0],'rota_063_confirmar_entrega');assert.equal(chamadas[0][1].p_cd,1530);assert.deepEqual(chamadas[1],['rota_063_desfazer_entrega',{p_id:10}]);
});
test('063 coletores WA integram marca na rota/alertas/resumo',async()=>{
 const T={solidcon_pedidos_erp:[p],rota_config:[{hora_saida:'08:00'}],rota_pedido_veiculo:[{cd_pedido:1530,veiculo:'s10'}],rota_cliente_regras:[],rota_cliente_veiculo:[],rota_veiculos:[{id:'s10',nome:'S10',modo:'porta',ativo:true,dias_sem_saida:[0]}]};
 const sb={rpc(n){if(n==='rota_068_entregas')return rpcTabela([{...p,status:'entregue',data_entrega:'2026-11-25'}]);return Promise.resolve({data:n==='rota_063_ler_entregas'?[c]:n==='rota_050_ler'?null:[]});},from(t){let rows=T[t]||[];const q={select(){return q;},order(){return q;},range(){return q;},limit(){return q;},is(){return q;},eq(){return q;},in(){return q;},gte(){return q;},lt(){return q;},then(ok,bad){return Promise.resolve({data:rows}).then(ok,bad);}};return q;}};
 const a=new Date(ctx.agora),d=await W.coletarRota(sb,a);assert.equal(d.confirmacoes[1530].id,10);
 assert.ok(W.montarRota(d,'s10',a,{}).vazio);
 const resumo=await W.coletarPedidosDia(sb,a);assert.equal(W.montarPedidosDia(resumo,a,{}).resumo.enviou,1,'068C/R1 legado063 ativo conta no dia da confirmacao');
 const alerta=await W.coletarAlertas(sb,a);assert.equal(alerta.parados.length,0);
});
