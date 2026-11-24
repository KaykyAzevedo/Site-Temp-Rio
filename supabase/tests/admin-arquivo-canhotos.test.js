'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function app(){const window={};let src=fs.readFileSync(require.resolve('../../js/admin-arquivo-canhotos.js'),'utf8');src=src.replace('raiz.TempRioArquivoCanhotos = {','raiz.__qa={get:()=>st,buscar,carregarFotos,verFoto,item,endereco};raiz.TempRioArquivoCanhotos = {');vm.runInNewContext(src,{window,Intl,URL,Date,Promise,console});return {...window.__qa,api:window.TempRioArquivoCanhotos,window};}
const row=n=>({cd_pedido:n,ultimo_canhoto_em:'2026-11-24T12:00:00Z',cliente_tipo:'cpf',cliente_nome:'Pessoa <script>',documento:null});
test('arquivo UI busca paginada por cursor sem truncar nem duplicar pedido',async()=>{
 const q=app(),calls=[];q.get().sb={rpc(name,args){calls.push({name,args});return Promise.resolve({data:calls.length===1?Array.from({length:26},(_,i)=>row(i+1)):[row(25),row(27)]});}};
 await q.buscar({busca:'Pessoa',de:'2026-11-01',ate:'2026-11-24'},false);assert.equal(q.get().lista.length,25);assert.equal(q.get().mais,true);
 await q.buscar({},true);assert.equal(q.get().lista.length,26);assert.equal(calls[1].args.p_antes_cd,25);assert.equal(calls[1].args.p_busca,'Pessoa');assert.equal(calls[1].args.p_limite,26);
});
test('arquivo UI pagina de pedidos nao abandona carregamento de fotos em andamento',async()=>{
 const q=app();let resolver;q.get().sb={rpc:()=>Promise.resolve({data:[row(1)]}),from(){const b={select(){return b;},eq(){return b;},is(){return b;},order(){return b;},range(){return new Promise(r=>{resolver=r;});}};return b;}};
 await q.buscar({},false);const fotos=q.carregarFotos(1);await q.buscar({},true);resolver({data:[{caminho:'foto1',enviado_em:'2026-11-24'}]});await fotos;
 assert.equal(q.get().fotos[1].ocupado,false);assert.equal(q.get().fotos[1].lista.length,1);
});
test('arquivo UI pagina fotos com mais10 e trata erro sem perder anteriores',async()=>{
 const q=app();let erro=false,n=0;q.get().sb={from(){const b={select(){return b;},eq(){return b;},is(){return b;},order(){return b;},range(a,z){n++;assert.equal(z-a,10);return Promise.resolve(erro?{error:{code:'57014'}}:{data:Array.from({length:11},(_,i)=>({caminho:'foto'+(a+i),enviado_em:'2026-11-24'}))});}};return b;}};
 await q.carregarFotos(1);assert.equal(q.get().fotos[1].lista.length,10);assert.equal(q.get().fotos[1].mais,true);erro=true;await q.carregarFotos(1);assert.equal(q.get().fotos[1].lista.length,10);assert.ok(q.get().fotos[1].erro);assert.equal(n,2);
});
test('arquivo UI descarta busca e URL assinada tardias depois do logout',async()=>{
 const q=app();let busca;q.get().sb={rpc:()=>new Promise(r=>{busca=r;})};const p=q.buscar({},false);q.api.sair();busca({data:[row(1)]});await p;assert.equal(q.get().lista.length,0);
 let assina;q.get().sb={};q.get().fotos[1]={lista:[],erro:''};q.window.TempRioCanhoto={urlAssinada:()=>new Promise(r=>{assina=r;})};const foto=q.verFoto(1,'foto');await Promise.resolve();q.api.sair();assina('https://example.test/foto?token=x');await foto;assert.equal(Object.keys(q.get().urls).length,0);
});
test('arquivo UI dados escapados e CPF jamais imprime documento mesmo se resposta vier errada',()=>{
 const q=app(),html=q.item({...row(1),documento:'12345678901',logradouro:'<img>',motorista_nome:'<driver>',valor_centavos:0});
 assert.ok(!html.includes('12345678901'));assert.ok(!html.includes('Pessoa <script>'));assert.match(html,/Pessoa &lt;script&gt;/);assert.match(html,/&lt;img&gt;/);assert.match(html,/&lt;driver&gt;/);assert.match(html,/documento não armazenado/);
});
