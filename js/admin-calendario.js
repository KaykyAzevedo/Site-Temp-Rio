/* Mini calendário compartilhado por programação e prazo. A RPC valida a data ao gravar. */
(function (w) {
    'use strict';
    var meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    function data(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
        var d = new Date(iso + 'T12:00:00Z');
        return isFinite(d.getTime()) && d.toISOString().slice(0,10) === iso ? d : null;
    }
    function somar(iso, n) { var d = data(iso); if (!d) return null; d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); }
    function mes(iso, n) { var d = data(iso); if (!d) return null; d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0,10); }
    function motivo(iso, o) {
        o = o || {};
        var d = data(iso);
        if (!d) return 'Data inválida';
        if (o.desabilitado || o.carregando || o.erro) return 'Edição indisponível';
        if (o.min && iso < o.min) return 'Data anterior ao permitido';
        if (o.max && iso > o.max) return 'Data posterior ao permitido';
        if (d.getUTCDay() === 0 && !o.permitirDomingo) return 'Domingo sem saída';
        return typeof o.indisponivel === 'function' ? o.indisponivel(iso) || '' : '';
    }
    function html(o) {
        o = o || {};
        var inicio = mes(o.mes || o.valor || o.hoje || o.min, 0);
        if (!inicio) return '<p role="alert">Calendário indisponível. Atualize os dados.</p>';
        var d = data(inicio), offset = (d.getUTCDay() + 6) % 7;
        var seguinte = mes(inicio, 1), anterior = mes(inicio, -1), dias = (data(seguinte) - d) / 86400000;
        var cells = '';
        for (var i = 0; i < offset; i++) cells += '<span aria-hidden="true"></span>';
        for (var dia = 1; dia <= dias; dia++) {
            var iso = somar(inicio, dia - 1), erro = motivo(iso,o), selecionado = iso === o.valor;
            cells += '<button type="button" class="adm-cal-dia' + (selecionado ? ' is-selecionado' : '') + (iso === o.hoje ? ' is-hoje' : '') + '" data-cal-dia="' + iso + '" aria-label="' + esc(dia + ' de ' + meses[d.getUTCMonth()] + ' de ' + d.getUTCFullYear() + (erro ? ': ' + erro : '')) + '" aria-pressed="' + selecionado + '"' + (iso === o.hoje ? ' aria-current="date"' : '') + (erro ? ' disabled title="' + esc(erro) + '"' : '') + '>' + dia + '</button>';
        }
        return '<div class="adm-cal" data-calendario="' + esc(o.chave || '') + '" data-cal-mes="' + inicio + '">' +
            '<div class="adm-cal-topo"><button type="button" data-cal-mudar="' + anterior + '" aria-label="Mês anterior"' + (o.min && mes(o.min,0) > anterior ? ' disabled' : '') + '>‹</button>' +
            '<strong aria-live="polite">' + meses[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + '</strong>' +
            '<button type="button" data-cal-mudar="' + seguinte + '" aria-label="Próximo mês"' + (o.max && mes(o.max,0) < seguinte ? ' disabled' : '') + '>›</button></div>' +
            '<div class="adm-cal-semana" aria-hidden="true">' + ['S','T','Q','Q','S','S','D'].map(function(x){return '<span>' + x + '</span>';}).join('') + '</div>' +
            '<div class="adm-cal-dias" role="group" aria-label="Escolher data">' + cells + '</div>' +
            (o.carregando ? '<p role="status">Consultando disponibilidade…</p>' : o.erro ? '<p role="alert">'+esc(o.erro)+'</p><button type="button" data-cal-retry>Tentar novamente</button>' : '') +
            '<p class="adm-cal-valor" role="status">' + (o.valor ? 'Selecionado: ' + esc(o.valor.split('-').reverse().join('/')) : 'Escolha uma data') + '</p></div>';
    }
    function ligar(alvo, obter) {
        function opcoes(cal) { return Object.assign({}, obter(cal.getAttribute('data-calendario')) || {}, {chave:cal.getAttribute('data-calendario'), mes:cal.getAttribute('data-cal-mes')}); }
        function redesenhar(cal, o, foco) {
            var caixa = cal.ownerDocument.createElement('div'); caixa.innerHTML = html(o);
            var novo = caixa.firstElementChild; cal.replaceWith(novo);
            var b = foco && novo.querySelector(foco);if(foco && (!b || b.disabled))b=novo.querySelector('[data-cal-dia]:not(:disabled)') || novo.querySelector('[data-cal-mudar]:not(:disabled)');if(b)b.focus();return novo;
        }
        function carregar(cal,o,foco) {
            if(typeof o.carregarMes!=='function'){redesenhar(cal,o,foco);return;}
            o.carregando=true;o.erro='';var novo=redesenhar(cal,o,foco);
            Promise.resolve().then(function(){return o.carregarMes(o.mes);}).then(function(){
                if(!novo.isConnected)return;
                o=opcoes(novo);o.carregando=false;redesenhar(novo,o,foco);
            },function(e){
                if(!novo.isConnected)return;
                o=opcoes(novo);o.erro=e.message || 'Disponibilidade indisponível.';redesenhar(novo,o,'[data-cal-retry]');
            });
        }
        function toggle(ev){
            var d=ev.target;if(!d.open || !d.querySelector)return;
            var cal=d.querySelector('[data-calendario]');if(cal)carregar(cal,opcoes(cal));
        }
        function click(ev) {
            var b = ev.target.closest && ev.target.closest('[data-cal-dia],[data-cal-mudar],[data-cal-retry]');
            if (!b || !alvo.contains(b)) return;
            ev.preventDefault(); ev.stopPropagation(); if (b.disabled) return;
            var cal = b.closest('[data-calendario]'), o = opcoes(cal), nav = b.getAttribute('data-cal-mudar');
            if (nav || b.hasAttribute('data-cal-retry')) { o.mes=nav || o.mes;carregar(cal,o,nav ? '[data-cal-mudar]' : '[data-cal-retry]');return; }
            var iso = b.getAttribute('data-cal-dia'); if (motivo(iso,o)) return;
            if (typeof o.selecionar === 'function') o.selecionar(iso);
            // O callback pode substituir o cartão inteiro após uma gravação.
            if (cal.isConnected) { o.valor = iso; redesenhar(cal,o,'[data-cal-dia="' + iso + '"]'); }
        }
        function key(ev) {
            var b = ev.target.closest && ev.target.closest('[data-cal-dia]');
            if (!b || !alvo.contains(b)) return;
            var saltos = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
            var iso = b.getAttribute('data-cal-dia'), cal = b.closest('[data-calendario]'), o = opcoes(cal), alvoDia;
            if (Object.prototype.hasOwnProperty.call(saltos,ev.key)) alvoDia = somar(iso,saltos[ev.key]);
            else if (ev.key === 'PageUp' || ev.key === 'PageDown') alvoDia = mes(iso,ev.key === 'PageUp' ? -1 : 1);
            else return;
            ev.preventDefault(); ev.stopPropagation();
            if(o.min && alvoDia<o.min)alvoDia=o.min;
            if(o.max && alvoDia>o.max)alvoDia=o.max;
            if(mes(alvoDia,0)!==o.mes && typeof o.carregarMes==='function'){
                o.mes=mes(alvoDia,0);carregar(cal,o,'[data-cal-dia="'+alvoDia+'"]');return;
            }
            var passo = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'PageUp' ? -1 : 1;
            for (var i=0;i<366 && alvoDia && motivo(alvoDia,o);i++) alvoDia=somar(alvoDia,passo);
            if (!alvoDia || motivo(alvoDia,o)) return;
            o.mes=mes(alvoDia,0); carregar(cal,o,'[data-cal-dia="' + alvoDia + '"]');
        }
        alvo.addEventListener('click',click,true); alvo.addEventListener('keydown',key,true);alvo.addEventListener('toggle',toggle,true);
        return function(){alvo.removeEventListener('click',click,true);alvo.removeEventListener('keydown',key,true);alvo.removeEventListener('toggle',toggle,true);};
    }
    var api = {html:html,ligar:ligar,motivo:motivo,somar:somar,mes:mes};
    w.TempRioCalendario=api; if(typeof module !== 'undefined') module.exports=api;
})(typeof window !== 'undefined' ? window : globalThis);
