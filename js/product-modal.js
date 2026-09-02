// product-modal.js

const productData = {
    "ALHO FRITO": {
        ingredientes: "Alho e óleo de palma.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "CANELA EM PAU": {
        ingredientes: "Canela.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "ALHO EM PÓ": {
        ingredientes: "Alho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "BICARBONATO DE SÓDIO": {
        ingredientes: "Carbonato de sódio, dióxido de carbono e água.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },

    "CHIA": {
        ingredientes: "Chia Hispânica",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "4",
            porcao: "15g (1 Colher de sopa)",
            medida: "15 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "443", porcao: "66", vd: "3" },
                { nome: "Carboidratos (g)", cem: "41", porcao: "6", vd: "2" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "17", porcao: "3", vd: "5" },
                { nome: "Gorduras totais (g)", cem: "31", porcao: "5", vd: "7" },
                { nome: "Gord saturadas (g)", cem: "3", porcao: "1", vd: "3" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "34", porcao: "5", vd: "21" },
                { nome: "Sódio (mg)", cem: "16", porcao: "2", vd: "0" }
            ]
        }
    },
    "COLORAU TEMPERADO": {
        ingredientes: "Colorau especial (farinha de milho (Agrobacterium tumefaciens, Streptomyces Viridochromogenes e Bacillus Thuringienses), corante natural de urucum e óleo de soja (Agrobacterium spp), salsa, alho, cebola, louro e aroma idêntico ao natural de bacon.",
        alergicos: "CONTÉM DERIVADO DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "351", porcao: "17", vd: "0" },
                { nome: "Carboidratos (g)", cem: "68", porcao: "3", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "10", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "9", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "91", porcao: "5", vd: "0" }
            ]
        }
    },
    "CRAVO EM FLOR": {
        ingredientes: "Cravo em flor",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "DRY RUB": {
        ingredientes: "Páprica, alho, cebola, manjericão, mostarda, pimenta do reino, pimenta calabresa, açúcar mascavo, acidulante ácido cítrico e antiumectante fosfato tricálcico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "378", porcao: "19", vd: "1" },
                { nome: "Carboidratos (g)", cem: "57", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "1", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "15", porcao: "1", vd: "2" },
                { nome: "Gorduras totais (g)", cem: "10", porcao: "1", vd: "1" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "26", porcao: "1", vd: "5" },
                { nome: "Sódio (mg)", cem: "54", porcao: "3", vd: "0" }
            ]
        }
    },
    "CANELA EM PÓ": {
        ingredientes: "Canela em pó",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "MANJERICÃO": {
        ingredientes: "Manjericão",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "LINHAÇA DOURADA": {
        ingredientes: "Linhaça Dourada",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "Cerca de 5",
            porcao: "15g (1 Colher de sopa)",
            medida: "15 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "533", porcao: "80", vd: "4" },
                { nome: "Carboidratos (g)", cem: "30", porcao: "5", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "2", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "20", porcao: "3", vd: "6" },
                { nome: "Gorduras totais (g)", cem: "40", porcao: "6", vd: "9" },
                { nome: "Gord saturadas (g)", cem: "4", porcao: "1", vd: "2" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "27", porcao: "4", vd: "16" },
                { nome: "Sódio (mg)", cem: "30", porcao: "5", vd: "0" }
            ]
        }
    },
    "GERGELIM PRETO": {
        ingredientes: "Gergelim preto",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "PIMENTA PRETA EM PÓ": {
        ingredientes: "Pimenta do reino preta e farinha de milho enriquecida com ferro e ácido fólico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "8",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "260", porcao: "13", vd: "0" },
                { nome: "Carboidratos (g)", cem: "64", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "10", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "24", porcao: "1", vd: "4" },
                { nome: "Sódio (mg)", cem: "0", porcao: "0", vd: "0" }
            ]
        }
    },
    "LEMON PEPPER": {
        ingredientes: "Sal, pimenta do reino, cebola granulada, coentro, cúrcuma, salsa desidratada, óleo de soja, aroma idêntico ao natural de limão, acidulante ácido cítrico e antiumectante fosfato tricálcico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "14",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "72", porcao: "4", vd: "0" },
                { nome: "Carboidratos (g)", cem: "11", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "1", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "8", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "24.410", porcao: "1.220", vd: "61" }
            ]
        }
    },
    "SAL ROSA DO HIMALAIA GROSSO": {
        ingredientes: "Sal Rosa do Himalaia Grosso",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "130",
            porcao: "1g (1/4 da Colher de chá)",
            medida: "1 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Carboidratos (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "4.000", porcao: "4", vd: "0" }
            ]
        }
    },
    "SAL DE OURO": {
        ingredientes: "Sal marinho, cúrcuma em pó, farinha de linhaça dourada, cebola em pó, mostarda em pó (mostarda e farinha de milho (Agrobacterium tumefaciens, Streptomyces Viridochromogenes e Bacillus Thuringienses) enriquecida com ferro e ácido fólico), farinha de milho (Agrobacterium tumefaciens, Streptomyces Viridochromogenes e Bacillus Thuringienses) enriquecida com ferro e ácido fólico), e pimenta preta em pó (pimenta do reino preta (Piper nigrum)).",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "70",
            porcao: "1g (1/4 da Colher de chá)",
            medida: "1 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "194", porcao: "2", vd: "0" },
                { nome: "Carboidratos (g)", cem: "27", porcao: "2", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "7", porcao: "1", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "9", porcao: "2", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "17", porcao: "0.5", vd: "2" },
                { nome: "Sódio (mg)", cem: "19.508", porcao: "195", vd: "10" }
            ]
        }
    },
    "PSYLLIUM HUSK": {
        ingredientes: "Psyllium Husk",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "ANA MARIA": {
        ingredientes: "Sal, cebola granulada, cebolinha verde desidratada, amido de milho, especiarias, açúcar, aroma idêntico ao natural de galinha, óleo de soja, antioxidante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "122", porcao: "6", vd: "0" },
                { nome: "Carboidratos (g)", cem: "27", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "2", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "16.569", porcao: "828", vd: "41" }
            ]
        }
    },
    // PENDENTE: ficha orfa - nenhum produto do catalogo tem esse nome
    "ANA": {
        ingredientes: "Sal, cebola granulada, cebolinha verde desidratada, amido de milho, especiarias, açúcar, aroma idêntico ao natural de galinha, óleo de soja, antioxidante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "122", porcao: "6", vd: "0" },
                { nome: "Carboidratos (g)", cem: "27", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "2", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "16.569", porcao: "828", vd: "41" }
            ]
        }
    },
    "SAL ROSA DO HIMALAIA FINO": {
        ingredientes: "Sal Rosa do Himalaia fino",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "130",
            porcao: "1g (1/4 da Colher de chá)",
            medida: "1 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Carboidratos (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "4.000", porcao: "4", vd: "0" }
            ]
        }
    },
    "CALDO DE GALINHA": {
        ingredientes: "Sal, amido de milho, aroma idêntico ao natural de galinha, açúcar, cebola, alho, óleo de soja, salsa, aipo, cúrcuma, antioxidante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "16",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "57", porcao: "3", vd: "0" },
                { nome: "Carboidratos (g)", cem: "10", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "28.617", porcao: "1.431", vd: "72" }
            ]
        }
    },
    "CALDO DE CARNE": {
        ingredientes: "Sal, amido de milho, açúcar, páprica doce, aroma idêntico ao natural de carne, óleo de soja, alho em pó, cebola em pó, salsa, aipo, corante caramelo, aipo, salsa, antiumectante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "16",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "36", porcao: "2", vd: "0" },
                { nome: "Carboidratos (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "3", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "30.549", porcao: "1.527", vd: "76" }
            ]
        }
    },
    // PENDENTE: ficha orfa - o produto 'Peixe' foi mapeado para PEIXE FIT
    "CALDO DE PEIXE": {
        ingredientes: "Sal, amido de milho, páprica doce, açúcar, especiarias, aroma idêntico ao natural de peixe, óleo de soja, antiumectante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "16",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "63", porcao: "3", vd: "0" },
                { nome: "Carboidratos (g)", cem: "12", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "7", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "5", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "26.579", porcao: "1.329", vd: "66" }
            ]
        }
    },
    "CALDO DE BACON": {
        ingredientes: "Sal, amido de milho, açúcar, aroma idêntico ao natural de bacon, óleo de soja, páprica, alho em pó, cebola em pó, salsa, aipo, pimenta do reino, corante, antiumectante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "16",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "29", porcao: "1", vd: "0" },
                { nome: "Carboidratos (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "33.542", porcao: "1.677", vd: "84" }
            ]
        }
    },
    "BAIANO": {
        ingredientes: "Farinha de milho enriquecida com ferro e ácido fólico, pimenta calabresa, pimenta do reino, coentro, cúrcuma, louro, orégano, cominho e corante natural de urucum.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "295", porcao: "15", vd: "1" },
                { nome: "Carboidratos (g)", cem: "66", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "9", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "12", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "52", porcao: "2", vd: "0" }
            ]
        }
    },
    "CHIMICHURRI DEFUMADO": {
        ingredientes: "Cebola, alho, salsa, caldo de galinha (sal, amido de milho, açúcar, cúrcuma, óleo de soja, cebola, alho, salsa) tomate, manjerona, colorau especial, páprica defumada, óleo de soja, aroma idêntico ao natural de fumaça, acidulante ácido cítrico, antiumectantes fosfato tricálcico e dióxido de silício.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "124", porcao: "6", vd: "0" },
                { nome: "Carboidratos (g)", cem: "17", porcao: "0,8", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "2,4", porcao: "0,1", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "3,7", porcao: "0,2", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2,2", porcao: "0,1", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0,2", porcao: "0,0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "6", porcao: "0,3", vd: "1" },
                { nome: "Sódio (mg)", cem: "2539", porcao: "127", vd: "6" }
            ]
        }
    },
    "CHIMICHURRI": {
        ingredientes: "Cebola desidratada, salsa desidratada, alho desidratado, farinha de milho enriquecida com ferro e ácido fólico, cominho, corante natural de urucum, manjericão desidratado, sal, aroma artificial de galinha, óleo de soja e açúcar.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "232", porcao: "12", vd: "0" },
                { nome: "Carboidratos (g)", cem: "52", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "9", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "13", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "4.839", porcao: "242", vd: "12" }
            ]
        }
    },
    "COLORAU COLORÍFICO": {
        ingredientes: "Farinha de milho enriquecida com ferro e ácido fólico, urucum em pó e óleo de soja.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "14",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "340", porcao: "17", vd: "1" },
                { nome: "Carboidratos (g)", cem: "70", porcao: "4", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "6", porcao: "1", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "5", porcao: "0", vd: "1" },
                { nome: "Sódio (mg)", cem: "40", porcao: "2", vd: "0" }
            ]
        }
    },
    "CHIMICHURRI COM PIMENTA": {
        ingredientes: "Alho, cebola, caldo de galinha (sal, amido de milho, açúcar, cúrcuma, óleo de soja, salsinha, alho, cebola), salsinha, majericão, colorau especial (farinha de milho, corante natural de urucum e óleo de soja), manjerona, pimenta calabresa e cominho.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "136", porcao: "7", vd: "0" },
                { nome: "Carboidratos (g)", cem: "19", porcao: "1,5", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "1,6", porcao: "0,1", vd: "0" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "6,4", porcao: "0,3", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "2,7", porcao: "0,1", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0,4", porcao: "0,0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "11", porcao: "0,6", vd: "2" },
                { nome: "Sódio (mg)", cem: "24", porcao: "1", vd: "0" }
            ]
        }
    },
    "COENTRO EM PÓ": {
        ingredientes: "Coentro.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "CURRY": {
        ingredientes: "Farinha de milho enriquecida com ferro e ácido fólico, cúrcuma, feno grego, pimenta do reino, canela, mostarda, coentro, gengibre, cravo, louro, pimenta calabresa e cominho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "340", porcao: "17", vd: "1" },
                { nome: "Carboidratos (g)", cem: "73", porcao: "4", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "9", porcao: "1", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "13", porcao: "1", vd: "4" },
                { nome: "Sódio (mg)", cem: "37", porcao: "2", vd: "0" }
            ]
        }
    },
    "COMINHO EM PÓ": {
        ingredientes: "Cominho e farinha de milho enriquecida com ferro e ácido fólico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "337", porcao: "17", vd: "1" },
                { nome: "Carboidratos (g)", cem: "57", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "17", porcao: "1", vd: "2" },
                { nome: "Gorduras totais (g)", cem: "11", porcao: "0", vd: "1" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "30", porcao: "1", vd: "6" },
                { nome: "Sódio (mg)", cem: "24", porcao: "1", vd: "0" }
            ]
        }
    },
    "FAZENDA": {
        ingredientes: "Farinha de milho enriquecida com ferro e ácido fólico, sal, cúrcuma moída, cebola granulada, pimentão flocos, manjerona moída, aroma idêntico ao natural de galinha, cebolinha desidratada, alho granulado, pimenta calabresa flocos, óleo de soja e salsa desidratada.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "124", porcao: "6", vd: "0" },
                { nome: "Carboidratos (g)", cem: "23", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "7", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "7.383", porcao: "369", vd: "18" }
            ]
        }
    },
    "CONQUISTA SOGRA": {
        ingredientes: "Cebola granulada, sal, aroma idêntico ao natural de limão, pimentão flocos, alho granulado, salsa egípcia, salsa desidratada, óleo de soja, açúcar refinado, colorau extra, cúrcuma moída, pimenta calabresa moída, pimenta calabresa, tomate flocos, e acidulante ácido cítrico",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "92", porcao: "5", vd: "0" },
                { nome: "Carboidratos (g)", cem: "14", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "4.264", porcao: "213", vd: "11" }
            ]
        }
    },
    "FAMÍLIA": {
        ingredientes: "Sal, farinha de milho enriquecida com ferro e ácido fólico, caldo de galinha, cebola granulada, cenoura flocos, alho granulado, cúrcuma moída, orégano flocos, salsa moída, óleo de girassol, aroma idêntico ao natural de legumes, pimenta preta moída e antiumectante dióxido de silício.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "14",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "70", porcao: "4", vd: "0" },
                { nome: "Carboidratos (g)", cem: "70", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "1", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "9.204", porcao: "460", vd: "0" }
            ]
        }
    },
    "ERVAS FINAS": {
        ingredientes: "Manjericão, salsa, manjerona, segurelha, sálvia, cebolinha e tomilho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "8",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "172", porcao: "9", vd: "0" },
                { nome: "Carboidratos (g)", cem: "35", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "12", porcao: "1", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "25", porcao: "1", vd: "5" },
                { nome: "Sódio (mg)", cem: "38", porcao: "2", vd: "0" }
            ]
        }
    },
    "TEMPERA TUDO": {
        ingredientes: "Sal, colorau extra, farinha de milho enriquecida com ferro e ácido fólico (geneticamente modificada por Agrobacterium tumefaciens, Streptomyces viridochromogenes e Bacillus thuringiensis),cebola granulada, alho granulado, salsa e corante, natural marrom.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "14",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "138", porcao: "7", vd: "0" },
                { nome: "Carboidratos (g)", cem: "28", porcao: "1", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "9", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "9.744", porcao: "487", vd: "12" }
            ]
        }
    },
    "COMPLETO FIT": {
        ingredientes: "Alho, páprica, cúrcuma, salsa, cominho, louro, pimenta calabresa e noz moscada.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "215", porcao: "11", vd: "1" },
                { nome: "Carboidratos (g)", cem: "32", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "5", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "8", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "5", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "2", porcao: "0", vd: "1" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "15", porcao: "1", vd: "3" },
                { nome: "Sódio (mg)", cem: "33", porcao: "2", vd: "0" }
            ]
        }
    },
    "CARNE FIT": {
        ingredientes: "Alho, cebola, cúrcuma, especiarias e noz moscada.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "176", porcao: "9", vd: "0" },
                { nome: "Carboidratos (g)", cem: "24", porcao: "1", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "2", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "6", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "5", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "3", porcao: "0", vd: "1" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "12", porcao: "1", vd: "2" },
                { nome: "Sódio (mg)", cem: "20", porcao: "2", vd: "0" }
            ]
        }
    },
    "DO CHEFE": {
        ingredientes: "Cebola granulada, sal, salsa, alho, curry, orégano, óleo de soja, pimenta do reino e cominho.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "141", porcao: "7", vd: "0" },
                { nome: "Carboidratos (g)", cem: "19", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "5", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "7", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "6.443", porcao: "322", vd: "16" }
            ]
        }
    },
    "NATURAL FIT": {
        ingredientes: "Alho, cebola, cúrcuma, manjericão, salsa, manjerona, tomilho, sálvia, segurelha, coentro, louro, páprica e cominho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "167", porcao: "8", vd: "0" },
                { nome: "Carboidratos (g)", cem: "28", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "3", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "8", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "14", porcao: "1", vd: "3" },
                { nome: "Sódio (mg)", cem: "27", porcao: "1", vd: "42" }
            ]
        }
    },
    "PEIXE FIT": {
        ingredientes: "Coentro, gengibre, alho, louro, especiarias e noz moscada.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "272", porcao: "14", vd: "1" },
                { nome: "Carboidratos (g)", cem: "49", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "15", porcao: "1", vd: "2" },
                { nome: "Gorduras totais (g)", cem: "4", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "2", porcao: "0", vd: "1" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "11", porcao: "1", vd: "2" },
                { nome: "Sódio (mg)", cem: "126", porcao: "6", vd: "0" }
            ]
        }
    },
    "FUMAÇA EM PÓ": {
        ingredientes: "Sal, amido de milho, farinha de milho enriquecida com ferro e ácido fólico, aroma idêntico ao natural de fumaça, carvão vegetal (E153), acidulante ácido cítrico e antiumectante fosfato tricálcico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "8",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "168", porcao: "8", vd: "0" },
                { nome: "Carboidratos (g)", cem: "37", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "2", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "10.818", porcao: "541", vd: "27" }
            ]
        }
    },
    "EDU": {
        ingredientes: "Cebola desidratada, cenoura desidratada, alho em pó, pimentão, cúrcuma moída, manjericão, cebolinha desidratada, salsa flocos e aroma idêntico ao natural de costela.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "150", porcao: "7", vd: "0" },
                { nome: "Carboidratos (g)", cem: "33", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "7", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "9", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "54", porcao: "3", vd: "0" }
            ]
        }
    },
    "FRANGO FIT": {
        ingredientes: "Alho, cebola, mostarda, cúrcuma, páprica, especiarias e cominho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "265", porcao: "13", vd: "1" },
                { nome: "Carboidratos (g)", cem: "42", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "3", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "12", porcao: "1", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "9", porcao: "1", vd: "1" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "1" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "21", porcao: "1", vd: "4" },
                { nome: "Sódio (mg)", cem: "24", porcao: "1", vd: "0" }
            ]
        }
    },
    "MOSTARDA EM PÓ": {
        ingredientes: "Mostarda",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "500", porcao: "25", vd: "1" },
                { nome: "Carboidratos (g)", cem: "32", porcao: "2", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "26", porcao: "1", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "34", porcao: "2", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "12", porcao: "0.5", vd: "2" },
                { nome: "Sódio (mg)", cem: "0", porcao: "0", vd: "0" }
            ]
        }
    },
    "LIMÃO E ORÉGANO": {
        ingredientes: "Sal, orégano, cebola granulada, salsa desidratada, tomilho, manjericão, salsa, cebolinha, aroma idêntico ao natural de limão, óleo de soja, acidulante ácido cítrico e antiumectante fosfato tricálcico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "80", porcao: "4", vd: "0" },
                { nome: "Carboidratos (g)", cem: "20", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "25.860", porcao: "1.293", vd: "64" }
            ]
        }
    },
    "MINEIRO": {
        ingredientes: "Farinha de mandioca, cúrcuma moída, óleo de soja, sal, alho, açúcar, cebola desidratada, pimenta do reino, cebolinha verde e salsa.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "367", porcao: "18", vd: "1" },
                { nome: "Carboidratos (g)", cem: "74", porcao: "4", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "8", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "8", porcao: "0", vd: "1" },
                { nome: "Sódio (mg)", cem: "1.330", porcao: "67", vd: "3" }
            ]
        }
    },
    "ORANGE PEPPER": {
        ingredientes: "Sal, pimenta do reino preta, cebola granulada, cúrcuma, óleo de soja, aroma idêntico ao natural de laranja, colorau, açúcar e acidulante ácido.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "89", porcao: "5", vd: "0" },
                { nome: "Carboidratos (g)", cem: "16", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "1", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "1", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "13.939", porcao: "697", vd: "35" }
            ]
        }
    },
    "PÁPRICA DOCE": {
        ingredientes: "Páprica, farinha de milho enriquecida com ferro e ácido fólico, corante natural de urucum e óleo de soja.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "229", porcao: "11", vd: "0" },
                { nome: "Carboidratos (g)", cem: "25", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "5", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "16", porcao: "1", vd: "1" },
                { nome: "Gord saturadas (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "12", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "27", porcao: "2", vd: "0" }
            ]
        }
    },
    "PÁPRICA PICANTE": {
        ingredientes: "Páprica picante, farinha de milho enriquecida com ferro e ácido fólico, óleo de soja e corante natural de urucum.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "287", porcao: "14", vd: "1" },
                { nome: "Carboidratos (g)", cem: "53", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "3", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "8", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "9", porcao: "0", vd: "1" },
                { nome: "Gord saturadas (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "13", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "40", porcao: "2", vd: "0" }
            ]
        }
    },
    "CHURRASCO": {
        ingredientes: "Sal, farinha de milho enriquecida com ferro e ácido fólico, alho desidratado, salsa, cebola, cebolinha e manjericão.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "Cerca de 5",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "70", porcao: "4", vd: "0" },
                { nome: "Carboidratos (g)", cem: "15", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "2", porcao: "3", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "6", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "1", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "4", vd: "0" },
                { nome: "Sódio (mg)", cem: "28.283", porcao: "1.414", vd: "70" }
            ]
        }
    },
    "PÁPRICA DEFUMADA PICANTE": {
        ingredientes: "Páprica, sal, farinha de milho enriquecida com ferro e ácido fólico, aroma idêntico ao natural de fumaça, corante natural de urucum e óleo de soja.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "267", porcao: "13", vd: "0" },
                { nome: "Carboidratos (g)", cem: "50", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "5", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "6", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "5", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "4.665", porcao: "233", vd: "11" }
            ]
        }
    },
    "PÁPRICA DEFUMADA": {
        ingredientes: "Páprica, sal refinado, farinha de milho enriquecida com ferro e ácido fólico, aroma idêntico ao natural de fumaça, corante natural de urucum e óleo de soja.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "267", porcao: "13", vd: "0" },
                { nome: "Carboidratos (g)", cem: "50", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "3", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "5", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "6", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "5", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "4.665", porcao: "233", vd: "11" }
            ]
        }
    },
    "SALSA, CEBOLA E BACON": {
        ingredientes: "Salsa, cebola e proteína texturizada de soja sabor bacon.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "6",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "84", porcao: "2", vd: "0" },
                { nome: "Carboidratos (g)", cem: "11", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "10", porcao: "1", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "11", porcao: "1", vd: "0" }
            ]
        }
    },
    "SABOR DO NORDESTE": {
        ingredientes: "Sal, colorau, farinha de milho enriquecida com ferro e ácido fólico, pimenta calabresa, cebola, alho, cominho, coentro, salsa, óleo de soja, acidulante ácido cítrico e antiumectante fosfato tricálcico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "12",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "280", porcao: "14", vd: "1" },
                { nome: "Carboidratos (g)", cem: "46", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "19.340", porcao: "967", vd: "48" }
            ]
        }
    },
    "SALSA, CEBOLA E ALHO": {
        ingredientes: "Cebola, salsa e alho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "6",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "43", porcao: "2", vd: "0" },
                { nome: "Carboidratos (g)", cem: "7", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "6", porcao: "1", vd: "0" }
            ]
        }
    },
    "PARA FEIJÃO": {
        ingredientes: "Cebola granulada, alho desidratado, proteína texturizada de soja sabor bacon, farinha de milho enriquecida com ferro e ácido fólico, corante natural de urucum e óleo de soja.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "134", porcao: "7", vd: "0" },
                { nome: "Carboidratos (g)", cem: "26", porcao: "2", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "1", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "9", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "3.894", porcao: "195", vd: "10" }
            ]
        }
    },
    "PEGA MARIDO": {
        ingredientes: "Cebola desidratada, alho desidratado, pimentão vermelho, tomate flocos, mostarda grão, cúrcuma moída, cebolinha, salsa desidratada, óleo de soja (Agrobacterium spp), farinha de milho enriquecida com ferro e ácido fólico (Agrobacterium tumefaciens, Streptomyces Viridochromogenes e Bacillus Thuringienses) e antiumectante fosfato tricálcico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "201", porcao: "10", vd: "1" },
                { nome: "Carboidratos (g)", cem: "37", porcao: "2", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "6", porcao: "1", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "1", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "6", porcao: "1", vd: "2" },
                { nome: "Sódio (mg)", cem: "23", porcao: "1", vd: "0" }
            ]
        }
    },
    "VINAGRETE": {
        ingredientes: "Cebola desidratada, alho desidratado, tomate flocos, pimentão desidratado e antiumectante fosfato tricálcico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "6",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "128", porcao: "6", vd: "0" },
                { nome: "Carboidratos (g)", cem: "25", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "2", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "5", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "3", porcao: "0", vd: "1" },
                { nome: "Sódio (mg)", cem: "30", porcao: "2", vd: "0" }
            ]
        }
    },
    "CALDO DE LEGUMES": {
        ingredientes: "Sal, amido de milho, açúcar, cenoura em flocos, aroma idêntico ao natural de legumes, óleo de soja, cebola em pó, cúrcuma, alho em pó, aipo, salsa, antiumectante fosfato tricálcico e conservante ácido cítrico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "16",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Carboidratos (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Sódio (mg)", cem: "380", porcao: "19", vd: "1" }
            ]
        }
    },
    "SÍRIO": {
        ingredientes: "Canela, erva doce, cravo da índia, gengibre, noz moscada, pimenta preta, pimenta síria, trigo para quibe e farinha de milho enriquecida com ferro e ácido fólico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "260", porcao: "13", vd: "0" },
                { nome: "Carboidratos (g)", cem: "62", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "22", porcao: "1", vd: "4" },
                { nome: "Sódio (mg)", cem: "0", porcao: "0", vd: "0" }
            ]
        }
    },
    "CAMOMILA": {
        ingredientes: "Camomila.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "TÁRTARO": {
        ingredientes: "Cebola desidratada, alho granulado, cenoura desidratada, tomate flocos, salsa desidratada, pimentão desidratado, sal e óleo de soja (Agrobacterium spp).",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "8",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "183", porcao: "9", vd: "0" },
                { nome: "Carboidratos (g)", cem: "38", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "4", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "8", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "2", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "7", porcao: "0", vd: "2" },
                { nome: "Sódio (mg)", cem: "1.710", porcao: "85", vd: "4" }
            ]
        }
    },
    "HIBISCO EM FLOR": {
        ingredientes: "Hibisco em flor.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "GENGIBRE EM PÓ": {
        ingredientes: "Gengibre raiz e amido de milho.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "LOURO": {
        ingredientes: "Louro.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "LIMÃO COM ERVAS": {
        ingredientes: "Sal, cebola granulada, cúrcuma, coentro, tomilho, cebolinha desidratada, manjericão, salsa desidratada, óleo de soja, aroma idêntico ao natural de limão, acidulante ácido cítrico e antiumectante fosfato tricálcico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "80", porcao: "4", vd: "0" },
                { nome: "Carboidratos (g)", cem: "10", porcao: "1", vd: "0" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "0", porcao: "1", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "0", porcao: "1", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "0", porcao: "1", vd: "0" },
                { nome: "Sódio (mg)", cem: "20.320", porcao: "1", vd: "42" }
            ]
        }
    },
    "CÚRCUMA": {
        ingredientes: "Cúrcuma raiz e farinha de milho enriquecida com ferro e ácido fólico.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "8",
            porcao: "5g (1 Colher de sopa)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "312", porcao: "16", vd: "1" },
                { nome: "Carboidratos (g)", cem: "67", porcao: "3", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "3", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "10", porcao: "0", vd: "1" },
                { nome: "Gorduras totais (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "2", porcao: "0", vd: "1" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "23", porcao: "1", vd: "4" },
                { nome: "Sódio (mg)", cem: "27", porcao: "2", vd: "0" }
            ]
        }
    },
    "PIMENTA ROSA EM GRÃOS": {
        ingredientes: "Pimenta rosa em grãos.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "PEGA ESPOSA": {
        ingredientes: "Cebola desidratada, alho desidratado, cenoura, tomate em flocos, pimentão vermelho em flocos, mostarda grão, colorau especial, óleo de soja, salsa desidratada, cebolinha, farinha de milho e antiumectante fosfato tricálcico.",
        alergicos: "CONTÉM DERIVADOS DE SOJA. PODE CONTER TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: {
            porcoes: "10",
            porcao: "5g (1 Colher de chá)",
            medida: "5 g",
            rows: [
                { nome: "Valor energético (kcal)", cem: "192", porcao: "10", vd: "1" },
                { nome: "Carboidratos (g)", cem: "35", porcao: "2", vd: "1" },
                { nome: "Açúcares totais (g)", cem: "0", porcao: "0", vd: "-" },
                { nome: "Açúcares adicionados (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Proteínas (g)", cem: "5", porcao: "0", vd: "0" },
                { nome: "Gorduras totais (g)", cem: "3", porcao: "0", vd: "0" },
                { nome: "Gord saturadas (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Gord trans (g)", cem: "0", porcao: "0", vd: "0" },
                { nome: "Fibras (g)", cem: "5", porcao: "0", vd: "1" },
                { nome: "Sódio (mg)", cem: "29", porcao: "1", vd: "0" }
            ]
        }
    },
    "ORÉGANO PERUANO": {
        ingredientes: "Orégano peruano.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "PIMENTA CALABRESA EM GRÃOS": {
        ingredientes: "Pimenta calabresa em grãos.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    },
    "PIMENTA PRETA EM GRÃOS": {
        ingredientes: "Pimenta preta em grãos.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    }
};

const defaultProductData = {
    ingredientes: "Ingredientes 100% naturais selecionados.",
    alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
    nutricional: null
};

const modalHTML = `
<div id="product-modal" class="fixed inset-0 z-[999] hidden items-center justify-center p-4 sm:p-6 opacity-0 transition-opacity duration-300">
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" id="modal-backdrop"></div>
    
    <div class="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#111111] border border-borderSubtle rounded-2xl shadow-2xl flex flex-col transform scale-95 transition-transform duration-300" id="modal-content">
        
        <!-- Header -->
        <div class="sticky top-0 bg-[#111111]/95 backdrop-blur-md border-b border-borderSubtle p-4 sm:p-6 flex items-center gap-3 z-10">
            <button id="prev-product" class="text-textSecondary hover:text-white transition-colors w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <h3 id="modal-title" class="text-lg sm:text-2xl font-bold text-white uppercase tracking-wider text-center flex-1 truncate">Nome do Produto</h3>
            <button id="next-product" class="text-textSecondary hover:text-white transition-colors w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
            <button id="close-modal" class="text-textSecondary hover:text-white transition-colors w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 sm:ml-2">
                <i class="fa-solid fa-xmark text-xl"></i>
            </button>
        </div>

        <!-- Body -->
        <div class="p-6 flex flex-col gap-8">
            
            <!-- Image Section -->
            <div class="w-full flex justify-center">
                <div class="w-full max-w-[280px] sm:max-w-sm aspect-[4/3] rounded-xl overflow-hidden bg-[#1A1A1A] border border-white/10 shadow-lg">
                    <img id="modal-image" src="" alt="Produto" class="w-full h-full object-cover">
                </div>
            </div>

            <!-- Content Section -->
            <div class="w-full flex flex-col gap-8">
                <!-- Info Boxes -->
                <div class="flex flex-col gap-4">
                    <div class="bg-white/5 border border-white/10 rounded-xl p-5">
                        <h4 class="text-primary-500 text-sm font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                            <i class="fa-solid fa-leaf"></i> Ingredientes
                        </h4>
                        <p id="modal-ingredientes" class="text-white font-light leading-relaxed">...</p>
                    </div>

                    <div class="bg-orange-500/10 border border-orange-500/20 rounded-xl p-5">
                        <h4 class="text-orange-500 text-sm font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                            <i class="fa-solid fa-triangle-exclamation"></i> Alérgicos
                        </h4>
                        <p id="modal-alergicos" class="text-white font-light leading-relaxed font-bold uppercase text-sm">...</p>
                    </div>
                </div>

                <!-- Nutritional Table -->
                <div id="modal-nutricional-container" class="hidden flex-col gap-4">
                    <h4 class="text-white text-lg font-bold uppercase tracking-wider text-center border-b border-white/10 pb-4">Informação Nutricional</h4>
                    
                    <div class="flex justify-between text-sm text-textSecondary font-light px-2">
                        <span id="modal-porcoes"></span>
                        <span id="modal-porcao"></span>
                    </div>

                    <div class="overflow-x-auto rounded-xl border border-white/10">
                        <table class="w-full text-left text-sm text-white">
                            <thead class="bg-white/5 text-xs uppercase font-bold text-textSecondary">
                                <tr>
                                    <th class="px-4 py-3"></th>
                                    <th class="px-4 py-3 text-center">100 g</th>
                                    <th id="modal-col-porcao" class="px-4 py-3 text-center">20 g</th>
                                    <th class="px-4 py-3 text-center">%VD*</th>
                                </tr>
                            </thead>
                            <tbody id="modal-nutricional-body" class="divide-y divide-white/10 font-light">
                                <!-- Rows injected here -->
                            </tbody>
                        </table>
                    </div>
                    <p class="text-xs text-textSecondary font-light text-center">*Percentual de valores diários fornecidos pela porção.</p>
                </div>
            </div>
            
        </div>
    </div>
</div>
`;

document.body.insertAdjacentHTML('beforeend', modalHTML);

const modal = document.getElementById('product-modal');
const modalContent = document.getElementById('modal-content');
const modalBackdrop = document.getElementById('modal-backdrop');
const closeModalBtn = document.getElementById('close-modal');
const prevBtn = document.getElementById('prev-product');
const nextBtn = document.getElementById('next-product');

const titleEl = document.getElementById('modal-title');
const modalImage = document.getElementById('modal-image');
const ingEl = document.getElementById('modal-ingredientes');
const aleEl = document.getElementById('modal-alergicos');
const nutContainer = document.getElementById('modal-nutricional-container');
const nutPorcoes = document.getElementById('modal-porcoes');
const nutPorcao = document.getElementById('modal-porcao');
const nutBody = document.getElementById('modal-nutricional-body');

let currentCard = null;

function getVisibleCards() {
    return Array.from(document.querySelectorAll('.surface-card')).filter(card => {
        return card.querySelector('h4') && card.style.display !== 'none';
    });
}

function updateNavigationButtons() {
    const visibleCards = getVisibleCards();
    const index = visibleCards.indexOf(currentCard);
    
    if (visibleCards.length <= 1) {
        prevBtn.style.visibility = 'hidden';
        nextBtn.style.visibility = 'hidden';
    } else {
        prevBtn.style.visibility = index > 0 ? 'visible' : 'hidden';
        nextBtn.style.visibility = index >= 0 && index < visibleCards.length - 1 ? 'visible' : 'hidden';
    }
}

function openModalFromCard(card) {
    currentCard = card;
    const nameEl = card.querySelector('h4');
    const imgEl = card.querySelector('img');
    
    if (!nameEl || !imgEl) return;
    
    // Normalize name to handle accents/case discrepancies
    let rawName = nameEl.textContent.trim().toUpperCase();
    
    // Try exact match first
    let data = productData[rawName];
    
    // If not found, try normalizing both
    if (!data) {
        const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        const normalizedTarget = normalize(rawName);
        for (const key in productData) {
            if (normalize(key) === normalizedTarget) {
                data = productData[key];
                rawName = key; // Use the real key for title
                break;
            }
        }
    }
    
    data = data || {
        ingredientes: "Informação não disponível.",
        alergicos: "PODE CONTER SOJA, TRIGO, AMÊNDOA E PISTACHE. CONTÉM GLÚTEN",
        nutricional: null
    };
    
    titleEl.textContent = rawName;
    modalImage.src = imgEl.src;
    ingEl.textContent = data.ingredientes;
    aleEl.textContent = data.alergicos;

    if (data.nutricional) {
        nutContainer.classList.remove('hidden');
        nutContainer.classList.add('flex');
        nutPorcoes.textContent = `Porções por embalagem: ${data.nutricional.porcoes || 'N/A'}`;
        nutPorcao.textContent = `Porção: ${data.nutricional.porcao}`;
        
        const colPorcaoEl = document.getElementById('modal-col-porcao');
        if (colPorcaoEl) colPorcaoEl.textContent = data.nutricional.medida || 'Porção';
        
        nutBody.innerHTML = '';
        data.nutricional.rows.forEach(row => {
            nutBody.innerHTML += `
                <tr class="hover:bg-white/5 transition-colors">
                    <td class="px-4 py-2 font-medium">${row.nome}</td>
                    <td class="px-4 py-2 text-center">${row.cem}</td>
                    <td class="px-4 py-2 text-center">${row.porcao}</td>
                    <td class="px-4 py-2 text-center">${row.vd}</td>
                </tr>
            `;
        });
    } else {
        nutContainer.classList.add('hidden');
        nutContainer.classList.remove('flex');
    }

    updateNavigationButtons();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    // Reinicia o scroll ao abrir ou trocar de produto
    modalContent.scrollTop = 0;
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95');
    }, 10);
    
    document.body.style.overflow = 'hidden'; 
}

function closeModal() {
    modal.classList.add('opacity-0');
    modalContent.classList.add('scale-95');
    
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }, 300);
}

closeModalBtn.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);

prevBtn.addEventListener('click', () => {
    const visibleCards = getVisibleCards();
    const index = visibleCards.indexOf(currentCard);
    if (index > 0) {
        openModalFromCard(visibleCards[index - 1]);
    }
});

nextBtn.addEventListener('click', () => {
    const visibleCards = getVisibleCards();
    const index = visibleCards.indexOf(currentCard);
    if (index >= 0 && index < visibleCards.length - 1) {
        openModalFromCard(visibleCards[index + 1]);
    }
});

window.setupModal = function() {
    const productCards = document.querySelectorAll('.surface-card');
    
    productCards.forEach(card => {
        // Clear old listeners if any by cloning (optional, but let's just bind to new cards)
        // Since we re-render entirely, we just bind
        const nameEl = card.querySelector('h4');
        if (nameEl && !card.classList.contains('modal-bound')) {
            card.classList.add('cursor-pointer', 'modal-bound');
            
            // On click anywhere on card (or the button), open modal
            card.addEventListener('click', () => {
                openModalFromCard(card);
            });
            
            // Add overlay only if not present (although dynamic render already has the button)
            // The dynamic render from content-loader.js already adds the overlay, so we don't need to add it here.
        }
    });
};

// Call once for static cards (if any)
window.setupModal();
