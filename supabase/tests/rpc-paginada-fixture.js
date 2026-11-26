'use strict';
// Contrato PostgREST/Supabase RPC de tabela: ordenar e paginar antes de resolver.
module.exports = function rpcTabela(data, error = null) {
 let rows = (data || []).slice(), range = null;
 const q = {
  order(k, {ascending = true} = {}) { rows.sort((a,b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (ascending ? 1 : -1)); return q; },
  range(a,b) { range = [a,b]; return q; },
  then(ok,bad) { return Promise.resolve({data: range ? rows.slice(range[0],range[1]+1) : rows, error}).then(ok,bad); }
 };return q;
};
