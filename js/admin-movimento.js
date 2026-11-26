(function(w){
    'use strict';
    function erro(r){return new Error(r && r.motivo || 'Não foi possível atualizar o pedido.');}
    function mapa(d){
        var m=Object.create(null);
        if(Array.isArray(d)) d.forEach(function(x){if(x && x.cd_pedido!=null)m[Number(x.cd_pedido)]=x;});
        else if(d && typeof d==='object') Object.keys(d).forEach(function(cd){if(/^\d+$/.test(cd))m[Number(cd)]=d[cd];});
        else throw new Error('Estado dos pedidos indisponível. Atualize para conferir.');
        return m;
    }
    function lerEstados(sb,cds){
        var ids=Array.from(new Set((cds || []).map(Number).filter(function(cd){return cd>0;}))),out=Object.create(null);
        return ids.reduce(function(p,cd,i){
            if(i%200)return p;
            var bloco=ids.slice(i,i+200);
            return p.then(function(){return sb.rpc('rota_068_estados_pedidos',{p_cds:bloco});}).then(function(r){
                if(!r || r.error)throw new Error(r && r.error && r.error.message || 'Estado dos pedidos indisponível.');
                var m=mapa(r.data);
                bloco.forEach(function(id){if(!m[id] || typeof m[id].entregue!=='boolean' || typeof m[id].pendente!=='boolean' || (m[id].entregue && m[id].pendente))throw new Error('Resposta incompleta ou incoerente sobre o estado/pendência dos pedidos.');out[id]=m[id];});
            });
        },Promise.resolve()).then(function(){return out;});
    }
    function uuid(){
        if(w.crypto && w.crypto.randomUUID)return w.crypto.randomUUID();
        throw new Error('Não foi possível preparar a alteração. Atualize o navegador.');
    }
    function mover(sb,a){
        return Promise.resolve().then(function(){return sb.rpc('rota_068_mover_pedido',{
            p_cd_pedido:Number(a.cd_pedido),p_dia:a.dia || null,p_veiculo:a.dia ? a.veiculo || null : null,p_requisicao:a.requisicao
        });}).then(function(r){
            if(!r || r.error)throw new Error(r && r.error && r.error.message || 'Sem resposta ao mover pedido.');
            if(!r.data || r.data.status!=='ok')throw erro(r.data);
            return r.data;
        });
    }
    var api={lerEstados:lerEstados,mapa:mapa,uuid:uuid,mover:mover};w.TempRioMovimento=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
