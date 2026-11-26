const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ console, Date, Intl, Number, Set, Promise });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'rota-core-base.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../functions/_shared/whatsapp-core.js'), 'utf8'), ctx);
const wa = ctx.TempRioWhatsCore;
const now = '2026-11-26T15:00:00-03:00';
const rows = [
 { cd_pedido: 1, etapa: 'atendido', dt_pedido: now, dt_saida: now, valor_centavos: 99900, cliente_tipo: 'cnpj', cliente_nome: 'ERP sem rota' },
 { cd_pedido: 2, etapa: 'conferido', dt_pedido: now, valor_centavos: 10000, cliente_tipo: 'cnpj', cliente_nome: 'Oculto' },
];
const entregas = [
 { cd_pedido: 3, status: 'entregue', data_entrega: '2026-11-26', valor_centavos: 12300, cliente_tipo: 'cnpj', documento:'11222333000181', cliente_nome: 'Snapshot sem ERP' },
 { cd_pedido: 4, status: 'problema', data_entrega: '2026-11-26', valor_centavos: 55500, cliente_tipo: 'cnpj', cliente_nome: 'Problema' },
 { cd_pedido: 2, status: 'entregue', data_entrega: '2026-11-26', valor_centavos: 10000, cliente_tipo: 'cnpj', cliente_nome: 'Oculto' },
 { cd_pedido: 5, status: 'entregue', data_entrega: '2026-11-25', valor_centavos: 33300, cliente_tipo: 'cnpj', cliente_nome: 'Ontem' },
];

test('pedido_dia conta somente saida canonica, sem problema/site, mesmo sem fonteERP', () => {
 const r = wa.montarPedidosDia({ pedidos: rows, entregas, foraDoSite: {2:true}, coletado: now }, now);
 assert.equal(r.resumo.entrou, 1);
 assert.equal(r.resumo.enviou, 1);
 assert.equal(r.resumo.pronto, 1); // faturado depois do corte continua pronto para o despacho seguinte (061).
 assert.match(r.texto, /Snapshot sem ERP/);
 assert.doesNotMatch(r.texto, /Problema|Oculto|Ontem/);
});
test('problema mantem exclusao dos pendentes pela projecao063 canonica', () => {
 const core = ctx.TempRioRotaCore;
 const p = { cd_pedido: 4, etapa:'aberto', dt_pedido:now };
 assert.equal(core.pendenteEntrega(p, {}, '2026-11-26', null, {confirmacoes:{4:{id:4,confirmado_em:now}}}), false);
});

function fake({ missing=false, source=rows, shipped=entregas, hidden=[{cd_pedido:2}], failure=null }={}) {
 const calls=[];
 function query(name, data, error=null) {
  let filtered=data, from=0, to=Infinity;
  const q={
   select(){return q},order(){return q},gte(){return q},limit(){return q},is(){return q},
   eq(k,v){ if(k==='etapa') filtered=filtered.filter(r=>r[k]===v);calls.push(['eq',name,k,v]);return q; },
   in(k,vs){filtered=filtered.filter(r=>vs.includes(r[k]));return q},
   range(a,b){from=a;to=b;calls.push(['range',name,a,b]);return q},
   then(ok,bad){return Promise.resolve({data:filtered.slice(from,to===Infinity?undefined:to+1),error}).then(ok,bad)}
  };return q;
 }
 return {calls,
  from(name){
   if(name==='solidcon_pedidos_erp') return query(name,source);
   if(name==='rota_pedido_ignorado') return query(name,hidden,failure);
   if(name==='solidcon_pedidos_erp_sync') return query(name,[{coletado_em:now}]);
   return query(name,[]);
  },
  rpc(name,args){calls.push(['rpc',name,args]);if(name==='rota_068_entregas') return query(name,shipped,missing?{code:'PGRST202',message:'missing C'}:null);
   return query(name,[]);
  }
 };
}
test('coleta aplica filtro site e le RPC C paginada', async () => {
 const sb=fake();const d=await wa.coletarPedidosDia(sb,now);
 assert.deepEqual(Array.from(d.pedidos,p=>p.cd_pedido),[1]);
 assert.equal(d.entregas.length,4);
 assert(sb.calls.some(c=>c[0]==='eq'&&c[1]==='rota_pedido_ignorado'&&c[2]==='alcance'&&c[3]==='site'));
 assert(sb.calls.some(c=>c[0]==='range'&&c[1]==='rota_068_entregas'));
});
test('RPC C ausente interrompe mensagem', async () => {await assert.rejects(wa.coletarPedidosDia(fake({missing:true}),now),/missing C/)});
test('leitura de exclusao falha sem assumir vazio', async () => {await assert.rejects(wa.coletarPedidosDia(fake({failure:{code:'42501',message:'denied'}}),now),/denied/)});
test('coleta mais de1000 entregas sem truncar', async () => {
 const list=Array.from({length:1001},(_,i)=>({...entregas[0],cd_pedido:100+i}));
 const d=await wa.coletarPedidosDia(fake({shipped:list}),now);assert.equal(d.entregas.length,1001);
});
