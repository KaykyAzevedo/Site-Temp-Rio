const produtos = [
    {
        id: "alho-em-po",
        nome: "Alho Em Po",
        imagem: "assets/images/produtos/alho-em-po.png",
        destaque: false
    },
    {
        id: "alho-frito",
        nome: "Alho Frito",
        imagem: "assets/images/produtos/alho-frito.png",
        destaque: true
    },
    {
        id: "ana-maria",
        nome: "Ana Maria",
        imagem: "assets/images/produtos/ana-maria.png",
        destaque: false
    },
    {
        id: "baiano",
        nome: "Baiano",
        imagem: "assets/images/produtos/baiano.png",
        destaque: false
    },
    {
        id: "bicarbonato-de-sodio",
        nome: "Bicarbonato De Sodio",
        imagem: "assets/images/produtos/bicarbonato-de-sodio.png",
        destaque: false
    },
    {
        id: "cacau-em-po",
        nome: "Cacau Em Po",
        imagem: "assets/images/produtos/cacau-em-po.png",
        destaque: false
    },
    {
        id: "caldo-de-bacon",
        nome: "Caldo De Bacon",
        imagem: "assets/images/produtos/caldo-de-bacon.png",
        destaque: false
    },
    {
        id: "caldo-de-carne",
        nome: "Caldo De Carne",
        imagem: "assets/images/produtos/caldo-de-carne.png",
        destaque: false
    },
    {
        id: "caldo-de-galinha",
        nome: "Caldo De Galinha",
        imagem: "assets/images/produtos/caldo-de-galinha.png",
        destaque: false
    },
    {
        id: "caldo-de-legumes",
        nome: "Caldo De Legumes",
        imagem: "assets/images/produtos/caldo-de-legumes.png",
        destaque: false
    },
    {
        id: "camomila",
        nome: "Camomila",
        imagem: "assets/images/produtos/camomila.png",
        destaque: false
    },
    {
        id: "canela-em-pau",
        nome: "Canela Em Pau",
        imagem: "assets/images/produtos/canela-em-pau.png",
        destaque: false
    },
    {
        id: "canela-em-po",
        nome: "Canela Em Po",
        imagem: "assets/images/produtos/canela-em-po.png",
        destaque: false
    },
    {
        id: "carne-fit",
        nome: "Carne Fit",
        imagem: "assets/images/produtos/carne-fit.png",
        destaque: false
    },
    {
        id: "chia",
        nome: "Chia",
        imagem: "assets/images/produtos/chia.png",
        destaque: false
    },
    {
        id: "chimichurri-com-pimenta",
        nome: "Chimichurri Com Pimenta",
        imagem: "assets/images/produtos/chimichurri-com-pimenta.png",
        destaque: false
    },
    {
        id: "chimichurri-defumado",
        nome: "Chimichurri Defumado",
        imagem: "assets/images/produtos/chimichurri-defumado.png",
        destaque: false
    },
    {
        id: "chimichurri",
        nome: "Chimichurri",
        imagem: "assets/images/produtos/chimichurri.png",
        destaque: true
    },
    {
        id: "churrasco",
        nome: "Churrasco",
        imagem: "assets/images/produtos/churrasco.png",
        destaque: false
    },
    {
        id: "coentro-em-po",
        nome: "Coentro Em Po",
        imagem: "assets/images/produtos/coentro-em-po.png",
        destaque: false
    },
    {
        id: "coloral-temperado",
        nome: "Coloral Temperado",
        imagem: "assets/images/produtos/coloral-temperado.png",
        destaque: false
    },
    {
        id: "colorau-colorifico",
        nome: "Colorau Colorifico",
        imagem: "assets/images/produtos/colorau-colorifico.png",
        destaque: false
    },
    {
        id: "cominho-em-po",
        nome: "Cominho Em Po",
        imagem: "assets/images/produtos/cominho-em-po.png",
        destaque: false
    },
    {
        id: "completo-fit",
        nome: "Completo Fit",
        imagem: "assets/images/produtos/completo-fit.png",
        destaque: false
    },
    {
        id: "conquista-sogra",
        nome: "Conquista Sogra",
        imagem: "assets/images/produtos/conquista-sogra.png",
        destaque: false
    },
    {
        id: "cravo-em-flor",
        nome: "Cravo Em Flor",
        imagem: "assets/images/produtos/cravo-em-flor.png",
        destaque: false
    },
    {
        id: "curcuma",
        nome: "Curcuma",
        imagem: "assets/images/produtos/curcuma.png",
        destaque: true
    },
    {
        id: "curry",
        nome: "Curry",
        imagem: "assets/images/produtos/curry.png",
        destaque: true
    },
    {
        id: "edu-guedes",
        nome: "Edu Guedes",
        imagem: "assets/images/produtos/edu.png",
        destaque: true
    },
    {
        id: "do-chefe",
        nome: "Do Chefe",
        imagem: "assets/images/produtos/do-chefe.png",
        destaque: false
    },
    {
        id: "dry-hub",
        nome: "Dry Hub",
        imagem: "assets/images/produtos/dry-hub.png",
        destaque: false
    },
    {
        id: "edu",
        nome: "Edu",
        imagem: "assets/images/produtos/edu.png",
        destaque: true
    },
    {
        id: "ervas-finas",
        nome: "Ervas Finas",
        imagem: "assets/images/produtos/ervas-finas.png",
        destaque: false
    },
    {
        id: "familia",
        nome: "Familia",
        imagem: "assets/images/produtos/familia.png",
        destaque: false
    },
    {
        id: "fazenda",
        nome: "Fazenda",
        imagem: "assets/images/produtos/fazenda.png",
        destaque: false
    },
    {
        id: "frango-fit",
        nome: "Frango Fit",
        imagem: "assets/images/produtos/frango-fit.png",
        destaque: false
    },
    {
        id: "fumaca-em-po",
        nome: "Fumaca Em Po",
        imagem: "assets/images/produtos/fumaca-em-po.png",
        destaque: false
    },
    {
        id: "gengibre-em-po",
        nome: "Gengibre Em Po",
        imagem: "assets/images/produtos/gengibre-em-po.png",
        destaque: false
    },
    {
        id: "gergelim-preto",
        nome: "Gergelim Preto",
        imagem: "assets/images/produtos/gergelim-preto.png",
        destaque: false
    },
    {
        id: "hibisco-em-flor",
        nome: "Hibisco Em Flor",
        imagem: "assets/images/produtos/hibisco-em-flor.png",
        destaque: false
    },
    {
        id: "lemon-pepper",
        nome: "Lemon Pepper",
        imagem: "assets/images/produtos/lemon-pepper.png",
        destaque: true
    },
    {
        id: "limao-com-ervas",
        nome: "Limao Com Ervas",
        imagem: "assets/images/produtos/limao-com-ervas.png",
        destaque: false
    },
    {
        id: "limao-e-oregano",
        nome: "Limao E Oregano",
        imagem: "assets/images/produtos/limao-e-oregano.png",
        destaque: false
    },
    {
        id: "linhaca-dourada",
        nome: "Linhaca Dourada",
        imagem: "assets/images/produtos/linhaca-dourada.png",
        destaque: false
    },
    {
        id: "louro",
        nome: "Louro",
        imagem: "assets/images/produtos/louro.png",
        destaque: false
    },
    {
        id: "manjericao",
        nome: "Manjericao",
        imagem: "assets/images/produtos/manjericao.png",
        destaque: false
    },
    {
        id: "mineiro",
        nome: "Mineiro",
        imagem: "assets/images/produtos/mineiro.png",
        destaque: false
    },
    {
        id: "mostarda-em-po",
        nome: "Mostarda Em Po",
        imagem: "assets/images/produtos/mostarda-em-po.png",
        destaque: false
    },
    {
        id: "natural",
        nome: "Natural",
        imagem: "assets/images/produtos/natural.png",
        destaque: false
    },
    {
        id: "orange-pepper",
        nome: "Orange Pepper",
        imagem: "assets/images/produtos/orange-pepper.png",
        destaque: false
    },
    {
        id: "oregano-peruano",
        nome: "Oregano Peruano",
        imagem: "assets/images/produtos/oregano-peruano.png",
        destaque: false
    },
    {
        id: "paprica-defumada-picante",
        nome: "Paprica Defumada Picante",
        imagem: "assets/images/produtos/paprica-defumada-picante.png",
        destaque: false
    },
    {
        id: "paprica-defumada",
        nome: "Paprica Defumada",
        imagem: "assets/images/produtos/paprica-defumada.png",
        destaque: true
    },
    {
        id: "paprica-doce",
        nome: "Paprica Doce",
        imagem: "assets/images/produtos/paprica-doce.png",
        destaque: false
    },
    {
        id: "paprica-picante",
        nome: "Paprica Picante",
        imagem: "assets/images/produtos/paprica-picante.png",
        destaque: true
    },
    {
        id: "para-feijao",
        nome: "Para Feijao",
        imagem: "assets/images/produtos/para-feijao.png",
        destaque: false
    },
    {
        id: "pega-esposa",
        nome: "Pega Esposa",
        imagem: "assets/images/produtos/pega-esposa.png",
        destaque: false
    },
    {
        id: "pega-marido",
        nome: "Pega Marido",
        imagem: "assets/images/produtos/pega-marido.png",
        destaque: false
    },
    {
        id: "peixe",
        nome: "Peixe",
        imagem: "assets/images/produtos/peixe.png",
        destaque: false
    },
    {
        id: "pimenta-calabresa-em-graos",
        nome: "Pimenta Calabresa Em Graos",
        imagem: "assets/images/produtos/pimenta-calabresa-em-graos.png",
        destaque: false
    },
    {
        id: "pimenta-em-po",
        nome: "Pimenta Em Po",
        imagem: "assets/images/produtos/pimenta-em-po.png",
        destaque: false
    },
    {
        id: "pimenta-preta-em-graos",
        nome: "Pimenta Preta Em Graos",
        imagem: "assets/images/produtos/pimenta-preta-em-graos.png",
        destaque: false
    },
    {
        id: "pimenta-preta-em-po",
        nome: "Pimenta Preta Em Po",
        imagem: "assets/images/produtos/pimenta-preta-em-po.png",
        destaque: false
    },
    {
        id: "pimenta-rosa-em-graos",
        nome: "Pimenta Rosa Em Graos",
        imagem: "assets/images/produtos/pimenta-rosa-em-graos.png",
        destaque: false
    },
    {
        id: "psyllium-husk",
        nome: "Psyllium Husk",
        imagem: "assets/images/produtos/psyllium-husk.png",
        destaque: false
    },
    {
        id: "sabor-do-nordeste",
        nome: "Sabor Do Nordeste",
        imagem: "assets/images/produtos/sabor-do-nordeste.png",
        destaque: false
    },
    {
        id: "sal-de-ouro",
        nome: "Sal De Ouro",
        imagem: "assets/images/produtos/sal-de-ouro.png",
        destaque: false
    },
    {
        id: "sal-rosa-do-himalaia-fino",
        nome: "Sal Rosa Do Himalaia Fino",
        imagem: "assets/images/produtos/sal-rosa-do-himalaia-fino.png",
        destaque: false
    },
    {
        id: "sal-rosa-do-himalaia-grosso",
        nome: "Sal Rosa Do Himalaia Grosso",
        imagem: "assets/images/produtos/sal-rosa-do-himalaia-grosso.png",
        destaque: false
    },
    {
        id: "salsa-cebola-e-alho",
        nome: "Salsa Cebola E Alho",
        imagem: "assets/images/produtos/salsa-cebola-e-alho.png",
        destaque: false
    },
    {
        id: "salsa-cebola-e-bacon",
        nome: "Salsa Cebola E Bacon",
        imagem: "assets/images/produtos/salsa-cebola-e-bacon.png",
        destaque: false
    },
    {
        id: "sirio",
        nome: "Sirio",
        imagem: "assets/images/produtos/sirio.png",
        destaque: false
    },
    {
        id: "tartaro",
        nome: "Tartaro",
        imagem: "assets/images/produtos/tartaro.png",
        destaque: false
    },
    {
        id: "tempera-tudo",
        nome: "Tempera Tudo",
        imagem: "assets/images/produtos/tempera-tudo.png",
        destaque: false
    },
    {
        id: "vinagrete",
        nome: "Vinagrete",
        imagem: "assets/images/produtos/vinagrete.png",
        destaque: false
    },
];

