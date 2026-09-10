const siteConfig = {
    empresa: {
        nome: "Temp Rio Indústria e Comércio",
        telefone: "(21) 99620-3535",
        whatsapp: "5521996203535",
        email: "ouvidoriatemprio@gmail.com",
        endereco: "Rio de Janeiro, RJ"
    },
    redesSociais: {
        instagram: "https://instagram.com/temp_riorj",
        facebook: "#",
        tiktok: "#"
    },
    links: {
        whatsappApi: "https://wa.me/5521996203535"
    },

    // Condições comerciais do pedido pelo site.
    //
    // Fonte única de verdade: mexer aqui propaga para o carrinho, a gaveta e a
    // página de pedido — inclusive para carrinhos já salvos no navegador dos
    // clientes, porque nenhum preço é gravado no localStorage.
    pedido: {
        // Preço por pote, igual para qualquer sabor e qualquer tamanho de caixa.
        precoPorPoteCentavos: 400,

        // Caixa fechada: cada caixa leva um sabor só.
        caixas: [
            { potes: 24, precoCentavos: 9600 },
            { potes: 48, precoCentavos: 19200 }
        ],

        // Pedido mínimo expresso em POTES — um número só.
        // 480 potes = 20 caixas de 24 = 10 caixas de 48 = R$ 1.920,00.
        // Os três são a mesma condição, porque o preço por pote é constante;
        // caixas e reais são derivados em js/cart.js.
        minimoPotes: 480
    },

    // Onde a Temp Rio entrega hoje.
    //
    // A verificação usa o CEP que o cliente digita, não a geolocalização do
    // navegador: o CEP é o endereço real de entrega, já é consultado no ViaCEP,
    // não pede permissão e não depende de o cliente aceitar ser rastreado.
    entrega: {
        // Estados atendidos. Fora daqui, o pedido não é fechado pelo site:
        // o cliente entra na lista de espera e ainda pode negociar no WhatsApp.
        ufsAtendidas: ["RJ"],
        prazoAtendido: "Entrega em até 7 dias em todo o estado do Rio de Janeiro."
    },

    // Lista de espera de quem está fora da área de entrega.
    //
    // O site é estático e não tem servidor, então o cadastro precisa de um
    // destino externo. Aqui ele vai para uma planilha do Google, via um script
    // publicado como aplicativo web — o "painel" é a própria planilha.
    //
    // COMO CONFIGURAR: siga admin/LEIAME.md e cole abaixo a URL que o Google
    // devolver ao publicar o script. Enquanto estiver vazio, o botão da lista
    // de espera avisa que o cadastro está indisponível e oferece o WhatsApp.
    listaEspera: {
        endpoint: ""
    },

    // Banco do painel de administrador (Supabase).
    //
    // A anonKey abaixo é PÚBLICA por natureza — ela vai no código da página e
    // qualquer visitante consegue lê-la. Isso não é vazamento: quem protege os
    // dados são as políticas de RLS em admin/supabase.sql, que permitem ao site
    // apenas INSERIR pedidos e visitas, nunca ler.
    //
    // A chave service_role do Supabase NUNCA deve entrar aqui nem em nenhum
    // arquivo do site: ela ignora todas as políticas de segurança.
    //
    // COMO CONFIGURAR: siga admin/LEIAME-PAINEL.md. Enquanto estiver vazio, o
    // site funciona igual — só não registra pedidos nem visitas.
    supabase: {
        url: "https://nucgjzfzptixvvxakftw.supabase.co",
        anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51Y2dqemZ6cHRpeHZ2eGFrZnR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5ODQ2MzUsImV4cCI6MjEwNDU2MDYzNX0.3KiuI8nDxaexAEZ4V15CChtNO6hHmvPklIitdEGIANA"
    },

    // Vitrine "Onde comprar Temp Rio": a loja do lojista em destaque no site,
    // como cortesia por volume. Não é vendida — ver js/vitrine.js.
    vitrine: {
        // Limiares em CAIXAS. Os números originais da ideia (10/30) não
        // serviam: o pedido mínimo já é 10 caixas, então todo pedido nasceria
        // no teto do Basic. Estes mantêm a proporção sobre os números reais.
        planos: [
            { tipo: "basic",   rotulo: "Basic Display",   ateCaixas: 20,   dias: 1 },
            { tipo: "pro",     rotulo: "Pro Display",     ateCaixas: 60,   dias: 3 },
            { tipo: "premium", rotulo: "Premium Display", ateCaixas: null, dias: 7 }
        ],

        // Gatilhos da sugestão: basta um dos dois.
        caixasParaSugerir: 21,
        pedidosParaSugerir: 2,

        // Bônus: cada um sobe um nível, sem passar do topo.
        pedidosParaRecorrente: 3,
        valorParaBonusCentavos: 576000, // 3x o pedido mínimo

        // Exclusividade Rio. Também garantida no banco, por constraint.
        ufsPermitidas: ["RJ"]
    }
};
