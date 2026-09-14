/* Regiões de entrega.
 *
 * ATENÇÃO — DUAS COISAS PRECISAM DA SUA CONFERÊNCIA ANTES DE PUBLICAR:
 *
 *   1. AS FAIXAS DE CEP são as que eu conheço, não uma fonte oficial dos
 *      Correios. Um limite errado cobra frete errado ou recusa um cliente
 *      válido. Confira cada faixa contra os CEPs que você realmente atende.
 *
 *   2. AS TAXAS E OS PRAZOS abaixo são EXEMPLOS. Nenhum deles veio de você.
 *      Troque todos antes de o site ir ao ar — ou pela aba Regiões do painel,
 *      que edita sem precisar mexer em código.
 *
 * ----------------------------------------------------------------------------
 * POR QUE `faixas` E NÃO UM PAR cep_inicio/cep_fim
 *
 * O pedido original previa uma faixa única por região. No Rio isso não fecha:
 * a Zona Sul ocupa 22000–22299 (Flamengo, Botafogo, Copacabana) E 22400–22499
 * (Ipanema, Leblon, Lagoa), com a faixa 22300 pertencendo a outra área. A Zona
 * Oeste é pior: Bangu fica em 21800 e Campo Grande em 23000, com a Barra no
 * meio. Uma faixa só por região obrigaria a inventar regiões artificiais ou a
 * engolir bairros errados.
 *
 * Por isso cada região tem uma LISTA de faixas. No banco isso vira uma tabela
 * filha (regioes_faixas_cep) — ver admin/supabase-regioes.sql.
 *
 * ----------------------------------------------------------------------------
 * A REGIÃO "RESTO DO ESTADO" EXISTE DE PROPÓSITO
 *
 * Hoje o site atende todo o estado do Rio. Se as regiões cobrissem só a capital
 * e a Baixada, um cliente de Petrópolis passaria a ser recusado da noite para o
 * dia — uma mudança de regra de negócio que ninguém pediu. A região de menor
 * prioridade cobre o estado inteiro, preservando o comportamento atual. Para
 * deixar de atender uma área, desative-a no painel; é uma decisão sua, não um
 * efeito colateral deste módulo.
 *
 * `prioridade`: quando um CEP cai em mais de uma faixa, vence a de maior
 * prioridade. É o que faz "Zona Sul" ganhar de "Resto do estado".
 */
const regioesEntrega = [
    {
        id: 'centro',
        nome: 'Centro',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 2500,   // EXEMPLO
        prazoDias: 2,         // EXEMPLO
        faixas: [{ inicio: '20000000', fim: '20099999' }],
        bairros: ['Centro', 'Lapa', 'Cinelândia', 'Saúde', 'Gamboa', 'Santo Cristo',
                  'Praça Mauá', 'Castelo']
    },
    {
        id: 'zona-sul',
        nome: 'Zona Sul',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 3000,   // EXEMPLO
        prazoDias: 2,         // EXEMPLO
        faixas: [
            { inicio: '22000000', fim: '22299999' }, // Glória a Botafogo, Copacabana, Leme
            { inicio: '22400000', fim: '22499999' }, // Ipanema, Leblon, Gávea, Lagoa
            { inicio: '22600000', fim: '22619999' }  // São Conrado
        ],
        bairros: ['Copacabana', 'Leme', 'Ipanema', 'Leblon', 'Botafogo', 'Flamengo',
                  'Laranjeiras', 'Catete', 'Glória', 'Urca', 'Humaitá', 'Gávea',
                  'Jardim Botânico', 'Lagoa', 'São Conrado', 'Vidigal', 'Cosme Velho']
    },
    {
        id: 'zona-norte',
        nome: 'Zona Norte',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 3500,   // EXEMPLO
        prazoDias: 3,         // EXEMPLO
        faixas: [{ inicio: '20500000', fim: '21399999' }],
        bairros: ['Tijuca', 'Vila Isabel', 'Maracanã', 'Grajaú', 'Andaraí', 'Méier',
                  'Engenho Novo', 'Cachambi', 'Todos os Santos', 'Madureira',
                  'Penha', 'Olaria', 'Ramos', 'Bonsucesso', 'Ilha do Governador',
                  'São Cristóvão', 'Benfica']
    },
    {
        id: 'barra-jacarepagua',
        nome: 'Barra e Jacarepaguá',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 4000,   // EXEMPLO
        prazoDias: 3,         // EXEMPLO
        faixas: [{ inicio: '22620000', fim: '22799999' }],
        bairros: ['Barra da Tijuca', 'Recreio dos Bandeirantes', 'Jacarepaguá',
                  'Freguesia', 'Taquara', 'Anil', 'Itanhangá', 'Vargem Grande',
                  'Vargem Pequena', 'Curicica']
    },
    {
        id: 'zona-oeste',
        nome: 'Zona Oeste',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 5000,   // EXEMPLO
        prazoDias: 4,         // EXEMPLO
        faixas: [
            { inicio: '21800000', fim: '21899999' }, // Bangu, Realengo, Padre Miguel
            { inicio: '23000000', fim: '23799999' }  // Campo Grande, Santa Cruz, Guaratiba
        ],
        bairros: ['Bangu', 'Realengo', 'Padre Miguel', 'Campo Grande', 'Santa Cruz',
                  'Guaratiba', 'Sepetiba', 'Paciência', 'Inhoaíba', 'Cosmos',
                  'Senador Camará']
    },
    {
        id: 'niteroi',
        nome: 'Niterói',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 4500,   // EXEMPLO
        prazoDias: 3,         // EXEMPLO
        faixas: [{ inicio: '24000000', fim: '24399999' }],
        bairros: ['Icaraí', 'Centro', 'Santa Rosa', 'Ingá', 'São Francisco',
                  'Charitas', 'Piratininga', 'Itaipu', 'Fonseca', 'Barreto',
                  'Pendotiba', 'Camboinhas']
    },
    {
        id: 'sao-goncalo',
        nome: 'São Gonçalo',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 5000,   // EXEMPLO
        prazoDias: 4,         // EXEMPLO
        faixas: [{ inicio: '24400000', fim: '24799999' }],
        bairros: ['Alcântara', 'Centro', 'Neves', 'Trindade', 'Colubandê',
                  'Mutuá', 'Porto da Pedra', 'Zé Garoto']
    },
    {
        id: 'baixada',
        nome: 'Baixada Fluminense',
        prioridade: 10,
        ativo: true,
        taxaCentavos: 5500,   // EXEMPLO
        prazoDias: 4,         // EXEMPLO
        faixas: [{ inicio: '25000000', fim: '26599999' }],
        bairros: ['Duque de Caxias', 'Nova Iguaçu', 'São João de Meriti',
                  'Belford Roxo', 'Nilópolis', 'Mesquita', 'Queimados',
                  'Japeri', 'Magé']
    },
    {
        // Menor prioridade: só vence quando nenhuma região específica casar.
        // Existe para não recusar quem o site já atende hoje.
        id: 'resto-rj',
        nome: 'Resto do estado do Rio',
        prioridade: 0,
        ativo: true,
        taxaCentavos: 8000,   // EXEMPLO
        prazoDias: 7,         // EXEMPLO
        faixas: [{ inicio: '20000000', fim: '28999999' }],
        bairros: []
    }
];
