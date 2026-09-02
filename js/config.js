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
    }
};
