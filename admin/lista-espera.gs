/**
 * Lista de espera da Temp Rio — recebe os cadastros do site e escreve numa
 * planilha do Google.
 *
 * Este arquivo NÃO roda no site. Ele é colado no editor de Apps Script de uma
 * planilha sua e publicado como aplicativo web. Veja admin/LEIAME.md.
 *
 * Por que existe: o site é estático, sem servidor. Sem um destino externo, o
 * cadastro morreria no navegador do cliente e nunca chegaria até você.
 */

const ABA = 'Lista de espera';

const COLUNAS = [
  'Data', 'Razão social', 'CNPJ', 'Responsável', 'Telefone', 'E-mail',
  'CEP', 'Cidade', 'UF', 'Endereço',
  'Potes', 'Caixas', 'Valor', 'Itens', 'Observações'
];

/**
 * Filtro simples contra ruído automatizado.
 *
 * ATENÇÃO: isto NÃO é segredo. O site é público e qualquer pessoa consegue ler
 * este valor no código-fonte da página. Serve só para descartar varredura
 * automática que encontre a URL por acaso. Se um dia começar a chegar lixo de
 * verdade, o caminho é trocar por um serviço com proteção real.
 *
 * Deixe '' para aceitar qualquer envio.
 */
const CHAVE = '';

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);

    if (CHAVE && dados.chave !== CHAVE) {
      return resposta({ ok: false, erro: 'chave invalida' });
    }

    const aba = obterAba();
    aba.appendRow([
      dados.enviadoEm ? new Date(dados.enviadoEm) : new Date(),
      dados.razaoSocial || '',
      dados.cnpj || '',
      dados.responsavel || '',
      dados.telefone || '',
      dados.email || '',
      dados.cep || '',
      dados.cidade || '',
      dados.uf || '',
      dados.endereco || '',
      Number(dados.potes) || 0,
      Number(dados.caixas) || 0,
      dados.valor || '',
      dados.itens || '',
      dados.observacoes || ''
    ]);

    return resposta({ ok: true });
  } catch (erro) {
    return resposta({ ok: false, erro: String(erro) });
  }
}

/** Abrir a URL no navegador cai aqui — serve para conferir que publicou certo. */
function doGet() {
  const aba = obterAba();
  return resposta({
    ok: true,
    mensagem: 'Lista de espera da Temp Rio ativa.',
    cadastros: Math.max(0, aba.getLastRow() - 1)
  });
}

function obterAba() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(ABA);

  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.appendRow(COLUNAS);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, COLUNAS.length).setFontWeight('bold');
    aba.autoResizeColumns(1, COLUNAS.length);
  }

  return aba;
}

function resposta(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
