'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const R=require('../functions/_shared/rota-core.js'),M=require('../../js/admin-movimento.js');
function ambiente(qtd=1){
 let agora='2026-11-26T23:59:59-03:00';const pendentes=[],chamadas=[];
 class Clock extends Date{constructor(...a){super(...(a.length?a:[agora]));}static now(){return Date.parse(agora);}}
 const pedidos=Array.from({length:qtd},(_,i)=>({cd_pedido:i+1,etapa:'atendido',dt_pedido:'2026-11-25T12:00:00-03:00',dt_saida:'2026-11-26T09:00:00-03:00',cliente_tipo:'cnpj',cliente_nome:'QA recebido hoje'}));
 const T={solidcon_pedidos_erp:pedidos,rota_config:[{id:1}],rota_pedido_ignorado:[],rota_veiculos:[{id:'s10',nome:'S10',modo:'porta',ativo:true,dias_sem_saida:[0,6]}]};
 const sb={rpc(n,a){chamadas.push({n,a});if(n==='rota_068_estados_pedidos')return new Promise(resolve=>pendentes.push({a,resolve}));if(n==='pode_marcar_rota')return Promise.resolve({data:true});return Promise.resolve({data:[]});},from(t){const q={select(){return q;},order(){return q;},eq(){return q;},limit(){return q;},is(){return q;},in(){return q;},then(ok,bad){return Promise.resolve({data:T[t]||[]}).then(ok,bad);}};return q;}};
 const win={TempRioRotaCore:R,TempRioMovimento:M,addEventListener(){},dispatchEvent(){}};
 const ctx={window:win,Intl,Date:Clock,sb,papel:'admin',celular:()=>false,localStorage:{getItem:()=>null},document:{getElementById:()=>null,querySelectorAll:()=>[]},$:()=>null,peAtualizarTopo(){},secaoVisivel:()=>false,abasParaRedesenhar:{},vendPaginar:f=>Promise.resolve(f()),solidTabelaAusente:()=>false,esc:String,brl:String,NUM:new Intl.NumberFormat('pt-BR'),cmpCadastros:()=>({}),docDigitos:x=>x||'',docNorm:x=>x,geoNorm:x=>String(x||'').toLowerCase()};
 const src=fs.readFileSync(require.resolve('../../js/admin.js'),'utf8'),a=src.indexOf('    var PE_COLUNAS ='),b=src.indexOf('    function peFecharLegenda',a);
 const app=vm.runInNewContext(src.slice(a,b)+';({pe,carregarPedidosErp,pePedidoJaSaiu,peVeiculoHtml});',ctx);
 async function aguardar(n){for(let i=0;i<200&&pendentes.length<n;i++)await Promise.resolve();assert.ok(pendentes.length>=n,'consulta de estado pendente '+n);}
 function resolver(i,entregue){const p=pendentes[i];p.resolve({data:p.a.p_cds.map(cd=>({cd_pedido:cd,entregue,pendente:false}))});}
 return {app,pendentes,chamadas,pedidos,aguardar,resolver,virar:()=>agora='2026-11-27T00:00:01-03:00'};
}
test('UIH-R1 loader real: resposta26 após00h não recebe etiqueta27; descarta e relê antes de liberar seletor',async()=>{
 const a=ambiente(),p=a.app.carregarPedidosErp();await a.aguardar(1);a.virar();a.resolver(0,false);
 await a.aguardar(2);
 assert.equal(a.app.pe.estadosH,null,'não publica flagfalse de ontem');assert.equal(a.app.pePedidoJaSaiu(a.pedidos[0]),true);assert.ok(!a.app.peVeiculoHtml(a.pedidos[0]).includes('<select'));
 a.resolver(1,true);await p;
 assert.equal(a.app.pe.estadosDia,'2026-11-27');assert.equal(a.app.pe.estadosH[1].entregue,true);assert.equal(a.app.pePedidoJaSaiu(a.pedidos[0]),true);
});
test('UIH-R1 blocos: cruzar00h entre200+1 descarta lote inteiro e relê todos os CDs',async()=>{
 const a=ambiente(201),p=a.app.carregarPedidosErp();await a.aguardar(1);a.resolver(0,false);await a.aguardar(2);a.virar();a.resolver(1,false);
 await a.aguardar(3);assert.equal(a.app.pe.estadosH,null);a.resolver(2,true);await a.aguardar(4);a.resolver(3,true);await p;
 assert.deepEqual(a.pendentes.map(p=>p.a.p_cds.length),[200,1,200,1]);assert.equal(Object.keys(a.app.pe.estadosH).length,201);assert.ok(Object.values(a.app.pe.estadosH).every(x=>x.entregue));
});
test('UIH-R1 releitura após virada falha: estado indisponível explícito, sem liberar flag velha nem repetir indefinidamente',async()=>{
 const a=ambiente(),p=a.app.carregarPedidosErp();await a.aguardar(1);a.virar();a.resolver(0,false);await a.aguardar(2);
 a.pendentes[1].resolve({error:{code:'57014',message:'Falha da releitura'}});await p;
 assert.equal(a.app.pe.estadosH,null);assert.equal(a.app.pePedidoJaSaiu(a.pedidos[0]),true);assert.match(a.app.pe.msgVeic,/Falha da releitura/);assert.equal(a.pendentes.length,2);
});
test('Contrato H final: retirar para bandeja envia dia e veículo nulos, preservando marcação no servidor',async()=>{
 let payload;await M.mover({rpc:async(n,a)=>{assert.equal(n,'rota_068_mover_pedido');payload=a;return {data:{status:'ok',entregue:false,reprogramado:true,origem:null,destino:null}};}},{cd_pedido:1,dia:null,veiculo:'caminhao',requisicao:'00000000-0000-4000-8000-000000000001'});
 assert.equal(payload.p_dia,null);assert.equal(payload.p_veiculo,null);
});
