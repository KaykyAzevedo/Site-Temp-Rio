/* 070: apresentação compartilhada dos modos e da data de saída. Sem inferência de entrega. */
(function(w){
 'use strict';
 var cal=typeof module!=='undefined'&&module.exports?require('./admin-calendario.js'):w.TempRioCalendario;
 function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function br(d){return /^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.split('-').reverse().join('/'):'';}
 function htmlModos(modo,o){
  o=o||{};modo=modo==='definitiva'?'definitiva':'previsao';
  return '<section class="adm-card p-4 mb-4 no-print" aria-label="Modo de planejamento"><div class="rota-cab rota-cab-compacto"><strong>Planejamento da Semana</strong><div class="flex flex-wrap gap-1" role="group" aria-label="Modo de planejamento">'+
   [['previsao','Previsão'],['definitiva','Rota de amanhã']].map(function(x){return '<button type="button" class="adm-chip'+(modo===x[0]?' is-ativo':'')+'" data-rota-modo="'+x[0]+'" aria-pressed="'+(modo===x[0])+'"'+(o.desabilitado?' disabled':'')+'>'+x[1]+'</button>';}).join('')+
   '</div></div><p class="rota-sub" role="status">'+(modo==='definitiva'?'Somente pedidos em Pronto pra despacho. Esta é a base da rota definitiva.':'Previsão com todos os pedidos pendentes. Recebidos e entregues ficam fora. A rota de amanhã usa somente Pronto pra despacho.')+'</p></section>';
 }
 function htmlSaida(cd,o){
  o=o||{};cd=Number(cd);if(!Number.isSafeInteger(cd)||cd<=0)return '';
  var rot=o.valor?'Data de saída marcada: '+br(o.valor):'Sem data de saída marcada';
  if(!o.podeEditar)return o.valor?'<p class="rota-sub">'+esc(rot)+'</p>':'';
  var c=Object.assign({},o.calendario||{},{chave:'saida070-'+cd,valor:o.valor||null,hoje:o.hoje,min:o.min||o.hoje,mes:o.mes||o.valor||o.hoje,desabilitado:!!o.salvando});
  return '<details class="mt-2" data-saida070="'+cd+'"><summary class="adm-botao-fantasma">'+esc(rot)+'</summary><p class="rota-sub">Opcional: adia a saída do pedido pronto até a data marcada.</p>'+
   (cal?cal.html(c):'<p role="alert">Calendário indisponível. Atualize a tela.</p>')+
   (o.valor?'<button type="button" class="adm-botao-fantasma" data-saida070-remover="'+cd+'"'+(o.salvando?' disabled':'')+'>Remover data marcada</button>':'')+
   (o.salvando?'<p role="status">Salvando data de saída…</p>':'')+(o.erro?'<p role="alert">'+esc(o.erro)+'</p>':'')+'</details>';
 }
 function validarEstados(d,ids){
  if(!Array.isArray(d)&&(!d||typeof d!=='object'))throw Error('Estados070 indisponíveis.');
  var m=Object.create(null);if(Array.isArray(d))d.forEach(function(e){if(e&&e.cd_pedido!=null)m[Number(e.cd_pedido)]=e;});else Object.keys(d).forEach(function(cd){m[Number(cd)]=d[cd];});
  Array.from(new Set((ids||[]).concat(Object.keys(m).map(Number)))).forEach(function(cd){
   var e=m[cd];
   if(!e||typeof e.entregue!=='boolean'||typeof e.pendente!=='boolean'||typeof e.pronto_despacho!=='boolean'||typeof e.estado_070!=='string'||!e.estado_070||e.pronto_despacho!==(e.estado_070==='pronto_despacho')||e.entregue&&e.pendente||e.pronto_despacho&&(!e.pendente||e.entregue||e.estado_070!=='pronto_despacho'))throw Error('Resposta incompleta ou incoerente de prontidão070.');
   ['data_saida_marcada','data_rota_reservada','historico_em','data_recebimento'].forEach(function(k){if(e[k]!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(e[k]||''))throw Error('Data070 inválida ou ausente.');});
  });return m;
 }
 function rpc(sb,n,a){return Promise.resolve().then(function(){return sb.rpc(n,a);}).then(function(r){if(!r||r.error)throw Error(r&&r.error&&(r.error.message||r.error.code)||'Sem resposta de '+n);if(r.data&&r.data.status==='erro')throw Error(r.data.motivo||'Alteração recusada.');return r.data;});}
 function lerEstados(sb,cds){
  var ids=Array.from(new Set((cds||[]).map(Number).filter(function(cd){return Number.isSafeInteger(cd)&&cd>0;}))),out=Object.create(null);
  return ids.reduce(function(p,cd,i){if(i%200)return p;var bloco=ids.slice(i,i+200);return p.then(function(){return rpc(sb,'rota_070_estados_pedidos',{p_cds:bloco});}).then(function(d){if(!Array.isArray(d))throw Error('Lista070 inválida.');var m=validarEstados(d,bloco);bloco.forEach(function(cd){out[cd]=m[cd];});});},Promise.resolve()).then(function(){return out;});
 }
 function respostaOK(d){if(!d||d.status!=='ok')throw Error(d&&d.motivo||'Resposta070 inválida.');return d;}
 function salvarSaida(sb,cd,dia,req){return rpc(sb,dia?'rota_070_saida_salvar':'rota_070_saida_remover',Object.assign({p_cd_pedido:Number(cd),p_requisicao:req},dia?{p_data:dia}:{})).then(respostaOK);}
 function lerCalendario(sb,cd,mes){
  var de=cal.mes(mes,0),ate=cal.somar(cal.mes(mes,1),-1);if(!de||!ate)return Promise.reject(Error('Mês inválido.'));
  return rpc(sb,'rota_070_calendario',{p_cd_pedido:Number(cd),p_de:de,p_ate:ate}).then(function(d){respostaOK(d);if(!Array.isArray(d.dias)||Number(d.cd_pedido)!==Number(cd)||d.de!==de||d.ate!==ate)throw Error('Calendário070 incompleto.');var vistos={};d.dias.forEach(function(x){if(!x||typeof x.habilitado!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(x.dia)||x.dia<de||x.dia>ate||vistos[x.dia])throw Error('Calendário070 incoerente.');vistos[x.dia]=true;});return d;});
 }
 function lerDefinitiva(sb,dia){return rpc(sb,'rota_070_definitiva_ler',{p_dia:dia}).then(function(d){respostaOK(d);if(d.dia!==dia || d.cabecalho!==null&&(!d.cabecalho||d.cabecalho.dia!==dia||!Number.isInteger(d.cabecalho.versao)) || d.foto!==null&&(!d.foto||d.foto.data!==dia||!Array.isArray(d.foto.itens)) || !d.reservas_070||typeof d.reservas_070!=='object'||Array.isArray(d.reservas_070))throw Error('Reserva070 incompleta.');Object.keys(d.reservas_070).forEach(function(k){var r=d.reservas_070[k];if(!r||r.dia!==k||!Array.isArray(r.itens)||!Number.isInteger(r.versao))throw Error('Reserva070 inválida.');r.itens.forEach(function(x){if(!x||!Number.isSafeInteger(Number(x.cd_pedido))||x.pronto_ao_reservar!==true||typeof x.ativo!=='boolean')throw Error('Itens da reserva070 inválidos.');});});return d;});}
 function salvarDefinitiva(sb,dia,itens,versao,req){return rpc(sb,'rota_070_definitiva_salvar',{p_dia:dia,p_itens:itens,p_versao_base:versao,p_requisicao:req}).then(respostaOK);}
 function mesclarItensOcultos(enviar,persistidos,estados,hoje,fechados){
  var vistos={},out=(enviar||[]).map(function(i){vistos[i.cd_pedido]=true;return Object.assign({},i);});
  (persistidos||[]).forEach(function(i){var e=estados&&estados[i.cd_pedido];if(!vistos[i.cd_pedido]&&i.dia>hoje&&(fechados||[]).indexOf(i.dia)<0&&(!e||!e.pronto_despacho))out.push(Object.assign({},i));});
  var ocupados={},prox={};out.forEach(function(i){if(!vistos[i.cd_pedido]&&i.ordem!=null&&!i.removido)(ocupados[i.dia+'@'+i.veiculo_id]||(ocupados[i.dia+'@'+i.veiculo_id]={}))[i.ordem]=true;});out.forEach(function(i){if(!vistos[i.cd_pedido]||i.removido||i.ordem==null)return;var k=i.dia+'@'+i.veiculo_id,n=prox[k]||1;while(ocupados[k]&&ocupados[k][n])n++;i.ordem=n;prox[k]=n+1;});return out;
 }
 function itensDefinitiva(quadro,dia,estados,reservas){
  var col=(quadro.dias||[]).filter(function(d){return d.dia===dia;})[0],vistos={},ordem={},ativos={};
  var reserva=reservas&&reservas[dia];(reserva&&reserva.itens||[]).forEach(function(i){if(i.ativo&&i.pronto_ao_reservar===true)ativos[i.cd_pedido]=i;});
  if(!col)throw Error('Atualize a semana da rota de amanhã.');
  return (col.cartoes||[]).map(function(c){
   var e=estados&&estados[c.cd_pedido];if(!e||!e.pronto_despacho&&!ativos[c.cd_pedido])throw Error('Pedido #'+c.cd_pedido+' não está pronto nem reservado.');
   if(e.data_saida_marcada&&e.data_saida_marcada>dia)throw Error('Pedido #'+c.cd_pedido+' tem saída marcada para outra data.');
   var v=c.veiculo||c.veiculo_id;if(!v||vistos[c.cd_pedido])throw Error('Pedido sem veículo ou duplicado.');vistos[c.cd_pedido]=true;ordem[v]=(ordem[v]||0)+1;
   return {cd_pedido:Number(c.cd_pedido),veiculo_id:v,ordem:ordem[v]};
  });
 }
 function ligarModos(alvo,obter,selecionar){
  if(alvo._soltarModo070)alvo._soltarModo070();
  function click(ev){
   var b=ev.target.closest&&ev.target.closest('[data-rota-modo]');if(!b||!alvo.contains(b))return;
   var modo=b.getAttribute('data-rota-modo'),o=obter()||{};
   if(b.disabled||o.desabilitado||['previsao','definitiva'].indexOf(modo)<0)return;
   ev.preventDefault();selecionar(modo);
  }
  alvo.addEventListener('click',click);var soltar=function(){alvo.removeEventListener('click',click);};alvo._soltarModo070=soltar;return soltar;
 }
 function ligarSaida(alvo,obter){
  if(alvo._soltarSaida070)alvo._soltarSaida070();
  function click(ev){
   var det=ev.target.closest&&ev.target.closest('[data-saida070]');if(!det||!alvo.contains(det))return;
   ev.stopPropagation();
   var b=ev.target.closest('[data-saida070-remover]');if(!b)return;
   ev.preventDefault();var o=obter(Number(b.getAttribute('data-saida070-remover')))||{};
   if(!b.disabled&&o.podeEditar&&!o.salvando&&typeof o.remover==='function')o.remover();
  }
  function key(ev){var d=ev.target.closest&&ev.target.closest('[data-saida070]');if(d&&alvo.contains(d))ev.stopPropagation();}
  var detalhes=Array.from(alvo.querySelectorAll('[data-saida070]'));detalhes.forEach(function(det){det.addEventListener('click',click,true);det.addEventListener('keydown',key,true);});
  function obterCalendario(chave){
   if(!/^saida070-\d+$/.test(chave))return {};
   var o=obter(Number(chave.slice(9)))||{};
   return Object.assign({},o.calendario||{},{valor:o.valor,hoje:o.hoje,min:o.min||o.hoje,desabilitado:!o.podeEditar||!!o.salvando,selecionar:function(d){var atual=obter(Number(chave.slice(9)))||{};if(atual.podeEditar&&!atual.salvando&&typeof atual.selecionar==='function')atual.selecionar(d);}});
  }
  var calendarios=cal?detalhes.map(function(det){return cal.ligar(det,obterCalendario);}):[];
  var soltar=function(){calendarios.forEach(function(f){f();});detalhes.forEach(function(det){det.removeEventListener('click',click,true);det.removeEventListener('keydown',key,true);});};alvo._soltarSaida070=soltar;return soltar;
 }
 var api={itensDefinitiva:itensDefinitiva,lerCalendario:lerCalendario,lerDefinitiva:lerDefinitiva,salvarSaida:salvarSaida,salvarDefinitiva:salvarDefinitiva,mesclarItensOcultos:mesclarItensOcultos,rpc:rpc,lerEstados:lerEstados,validarEstados:validarEstados,htmlModos:htmlModos,htmlSaida:htmlSaida,ligarModos:ligarModos,ligarSaida:ligarSaida};w.TempRioPrevisao=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
