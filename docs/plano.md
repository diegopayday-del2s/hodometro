# Plano Diretor de Produto e Engenharia: Da Linha de Base ao Nível Strava

**Data:** 24 de outubro de 2026  
**Responsável Técnico e de Produto:** Antigravity (Liderança Autônoma)  
**Versão Base:** 1.3.0  
**ID do Aplicativo:** `io.github.diegopayday.hodometro` (preservado e imutável)

---

## 1. Linha de Base Imutável (Baseline)

### 1.1 Suíte de Testes Unitários (`npm test`)
Executada com Node.js v24.21.0. Todos os 42 testes passaram sem qualquer falha ou regressão:
- **Motor de cálculo (`rastreador.js`, `geo.js`, `simulador.js`):** 28 testes
- **Rotas e guia (`rotas.js`):** 6 testes
- **Progresso e metas (`progresso.js`):** 3 testes
- **Formatos, GPX e notificações (`formato.js`, `gpx.js`):** 5 testes
- **Total:** 42 testes passando (duração: ~550 ms).

### 1.2 Tabela Imutável de Precisão (`npm run precisao`)
Referência exata obtida antes de qualquer intervenção em código:

```
┌─────────┬─────────────────────────┬──────────────┬────────┬───────────────────┬──────────────────┬──────────────┐
│ (index) │ cenario                 │ velocidade   │ perdas │ distância média % │ distância pior % │ tempo pior s │
├─────────┼─────────────────────────┼──────────────┼────────┼───────────────────┼──────────────────┼──────────────┤
│ 0       │ 'reta 5 km a 20 km/h'   │ 'aparelho'   │ '0%'   │ '-0.15'           │ '0.28'           │ '1'          │
│ 1       │ 'reta 5 km a 20 km/h'   │ 'aparelho'   │ '20%'  │ '-0.22'           │ '0.48'           │ '3'          │
│ 2       │ 'reta 5 km a 20 km/h'   │ 'só posição' │ '0%'   │ '1.04'            │ '1.26'           │ '5'          │
│ 3       │ 'reta 5 km a 20 km/h'   │ 'só posição' │ '20%'  │ '0.79'            │ '1.06'           │ '5'          │
│ 4       │ 'semáforo de 2 min'     │ 'aparelho'   │ '0%'   │ '-0.37'           │ '0.85'           │ '2'          │
│ 5       │ 'semáforo de 2 min'     │ 'aparelho'   │ '20%'  │ '-0.38'           │ '0.90'           │ '3'          │
│ 6       │ 'semáforo de 2 min'     │ 'só posição' │ '0%'   │ '0.39'            │ '1.10'           │ '15'         │
│ 7       │ 'semáforo de 2 min'     │ 'só posição' │ '20%'  │ '0.28'            │ '0.95'           │ '16'         │
│ 8       │ 'devagar a 7 km/h'      │ 'aparelho'   │ '0%'   │ '-0.39'           │ '1.00'           │ '1'          │
│ 9       │ 'devagar a 7 km/h'      │ 'aparelho'   │ '20%'  │ '-0.67'           │ '2.10'           │ '3'          │
│ 10      │ 'devagar a 7 km/h'      │ 'só posição' │ '0%'   │ '0.86'            │ '1.80'           │ '10'         │
│ 11      │ 'devagar a 7 km/h'      │ 'só posição' │ '20%'  │ '0.73'            │ '1.90'           │ '13'         │
│ 12      │ 'círculo de 40 m'       │ 'aparelho'   │ '0%'   │ '-0.09'           │ '0.34'           │ '1'          │
│ 13      │ 'círculo de 40 m'       │ 'aparelho'   │ '20%'  │ '-0.14'           │ '0.59'           │ '3'          │
│ 14      │ 'círculo de 40 m'       │ 'só posição' │ '0%'   │ '-0.55'           │ '2.35'           │ '6'          │
│ 15      │ 'círculo de 40 m'       │ 'só posição' │ '20%'  │ '-1.16'           │ '2.75'           │ '6'          │
│ 16      │ 'esquinas de cidade'    │ 'aparelho'   │ '0%'   │ '-0.27'           │ '0.71'           │ '1'          │
│ 17      │ 'esquinas de cidade'    │ 'aparelho'   │ '20%'  │ '-0.37'           │ '1.22'           │ '2'          │
│ 18      │ 'esquinas de cidade'    │ 'só posição' │ '0%'   │ '-0.87'           │ '2.56'           │ '6'          │
│ 19      │ 'esquinas de cidade'    │ 'só posição' │ '20%'  │ '-1.20'           │ '2.86'           │ '6'          │
│ 20      │ 'pedal de demonstração' │ 'aparelho'   │ '0%'   │ '0.11'            │ '0.27'           │ '10'         │
│ 21      │ 'pedal de demonstração' │ 'aparelho'   │ '20%'  │ '0.17'            │ '0.49'           │ '11'         │
│ 22      │ 'pedal de demonstração' │ 'só posição' │ '0%'   │ '0.99'            │ '1.27'           │ '5'          │
│ 23      │ 'pedal de demonstração' │ 'só posição' │ '20%'  │ '0.84'            │ '1.17'           │ '11'         │
└─────────┴─────────────────────────┴──────────────┴────────┴───────────────────┴──────────────────┴──────────────┘
```

---

## 2. Diagnóstico Comparativo: O Aplicativo vs. Strava

### 2.1 O que já está no nível do Strava (ou supera)
1. **Gravação 100% offline e no bolso:** Serviço Android em primeiro plano com GPS nativo de chip (`GPS_PROVIDER`), trava de CPU, recuperação de leituras se o app fechar e notificação contínua na tela de bloqueio. Supera o Strava em confiabilidade em túneis/sem sinal de operadora e consumo consciente de bateria.
2. **Privacidade e soberania:** Zero contas, zero login, zero rastreamento em servidores na nuvem. Os pedais residem no IndexedDB local com backup completo em JSON.
3. **Feed e Ciclocomputador:** Interface visual inspirada com tipografia Barlow, números tabulares anti-vibração, modo guidão (tela sempre acesa), pausas automáticas inteligentes que não derrubam a média no semáforo e parciais por km.
4. **Rotas automáticas:** O app reconhece repetições de trajetos sem exigir desenho manual prévio, aponta o melhor tempo e fornece guia "à frente/atrás" em tempo real por voz e tela.
5. **Stories integrados:** Gerador de imagens de alta resolução (1080 x 1920) com modelos em laranja, foto e transparente para postagem direta no Instagram.

### 2.2 O que está inferior ao Strava
1. **Mapa durante o pedal:** Hoje, enquanto grava, o usuário só dispõe do painel numérico de ciclocomputador. Falta a alternância para mapa ao vivo mostrando a posição atual sobre o traçado da rota escolhida.
2. **Perfil altimétrico (Elevação):** Não há gráfico visual de elevação (altimetria acumulada / corte do relevo) no resumo da atividade ou nos detalhes da rota, exibindo apenas o ganho total em metros.
3. **Segmentos parciais:** As rotas só compreendem o pedal de ponta a ponta (85% de similaridade). Falta o suporte a segmentos específicos (subidas duras, sprints, trechos de ciclovia) dentro de um percurso maior com ranking pessoal.
4. **Melhores esforços (Best Efforts):** Ausência do cálculo dos trechos contínuos mais rápidos do ciclista para 5 km, 10 km, 20 km, 40 km e maior distância em 1 hora.
5. **Importação de histórico:** Quem migra do Strava não consegue trazer seu arquivo GPX exportado para compor o histórico local.

### 2.3 O que falta implementar
- Fluxo de primeira abertura (Onboarding educativo de 3 telas com solicitação de permissões).
- Sistema de conquistas e selos locais com aviso pós-pedal.
- Desafios automáticos do mês com anéis de progresso e contagem regressiva.
- Retrospectiva mensal e anual em story gerado.
- Compartilhamento e disputa de rotas P2P via QR Code / arquivo.
- Gestão de bicicletas e controle de desgaste de componentes (corrente, pneus, freios).

---

## 3. Problemas e Falhas Reais Encontrados na Inspeção (Prioridade Zero)

### Problema 1: Marca d'água "API KEY REQUIRED" nos blocos de mapa do CARTO (Crítico)
- **Passo a passo para reproduzir:** Iniciar o app conectado à internet (`npm start`), ir em Ajustes > Simular um pedal, finalizar o pedal e inspecionar o canvas do resumo ou o feed.
- **Causa raiz:** O endpoint `basemaps.cartocdn.com` da CARTO passou a exigir chave de API. Sem chave, o servidor responde com código HTTP 200 contendo imagens PNG carimbadas com o texto diagonal "API KEY REQUIRED carto.com/basemaps/apikey". Como o código HTTP é 200, o evento `onerror` em `js/mapa.js` não é disparado, manchando todo o mapa da atividade.
- **Solução técnica:** Adotar o servidor de blocos raster padrão do OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`), que é 100% livre, público e gratuito, ajustando a atribuição para `© OpenStreetMap contributors` e mantendo a resiliência offline.

### Problema 2: Transbordamento (Overflow) vertical de diálogos modais (`.dialogo`) em 360 x 660 (Médio)
- **Passo a passo para reproduzir:** Emular resolução mobile compacta (360 x 660). Abrir `#dlgLancar` (diálogo de lançamento retroativo) ou `#dlgMetas`.
- **Causa raiz:** `.dialogo` em `css/app.css` possui `max-height: calc(100dvh - 32px)`, mas carece de `overflow-y: auto`. O conteúdo interno excede a altura útil do viewport compacto e empurra o botão de ação principal ("Salvar") para fora da tela.
- **Solução técnica:** Adicionar `overflow-y: auto; overscroll-behavior: contain;` à classe `.dialogo` e garantir rolagem interna fluida.

### Problema 3: Colisão visual entre o botão "INICIAR" e a legenda de avisos em 360 x 660 (Médio)
- **Passo a passo para reproduzir:** Acessar a aba "Gravar" em tela de 360 x 660 px antes de iniciar a pedalada.
- **Causa raiz:** `.iniciar-area` tem posicionamento fixo/sticky com gradiente superior transparente (`linear-gradient(to bottom, rgba(255, 255, 255, 0), #fff 28%)`). Na altura de 660px, o botão circular de 96px sobrepõe exatamente o texto do parágrafo `#qTxt` ("Aviso por voz e vibração...").
- **Solução técnica:** Ajustar a altura mínima e espaçamento vertical do bloco de opções ou tornar a rolagem do container mais espaçosa com padding inferior adequado.

### Problema 4: Redundância de texto na aba Rotas vazia (Baixo)
- **Passo a passo para reproduzir:** Navegar até a aba "Rotas" com o banco limpo.
- **Causa raiz:** O parágrafo introdutório no topo e o parágrafo no cartão tracejado vazio dizem exatamente a mesma coisa em frases quase idênticas.
- **Solução técnica:** Unificar em uma única apresentação limpa e agradável no estado vazio.

### Problema 5: Alvos de toque (touch targets) inferiores a 44px em links (Baixo)
- **Passo a passo para reproduzir:** Inspecionar botões com classe `.link` como "Ver todas" e "Definir metas".
- **Causa raiz:** Possuem altura calculada de ~35px, desrespeitando o limite ergonômico de 44px definido em `AGENTS.md` (Regra 8).
- **Solução técnica:** Definir `min-height: 44px; display: inline-flex; align-items: center;` para `.link`.

---

## 4. Estudo de Marca: 10 Propostas de Nomes

Critérios adotados: curto, sonoro, em português (ou natural na língua), remetendo a bike/pedal/trajeto/estrada, sem conflito com marcas registradas globais (Strava, Garmin, Wahoo, Komoot, Giro) e de fácil legibilidade no topo do aplicativo.

1. **VELO**
   - *Conceito:* Raiz etimológica universal da bicicleta (*vélocipède / vélo*) e de velocidade. Apenas 4 letras, elegante, moderno e internacionalmente compreendido.
   - *Frase de apresentação:* "Velo: seu pedal gravado no bolso, 100% offline."
   - *Visual no topo:* `VELO`
2. **CADÊNCIA**
   - *Conceito:* O ritmo contínuo das pedaladas. Termo técnico amado por ciclistas que reflete constância e evolução.
   - *Frase de apresentação:* "Cadência: o ritmo do seu pedal, direto no celular."
   - *Visual no topo:* `CADÊNCIA`
3. **ROLÊ**
   - *Conceito:* A forma mais genuína e popular do brasileiro se referir a sair de bicicleta ("vamos dar um rolê"). Descontraído, acolhedor e próximo.
   - *Frase de apresentação:* "Rolê: grave seu pedal sem conta, sem complicação."
   - *Visual no topo:* `ROLÊ`
4. **TRAÇO**
   - *Conceito:* A linha do percurso no mapa, a marca deixada na estrada e a simplicidade gráfica do aplicativo.
   - *Frase de apresentação:* "Traço: cada curva do seu pedal desenhada no bolso."
   - *Visual no topo:* `TRAÇO`
5. **RUMO**
   - *Conceito:* 4 letras fortes. Significa direção, objetivo, estrada à frente e autonomia sem precisar de sinal de operadora.
   - *Frase de apresentação:* "Rumo: sua rota e seu progresso na bicicleta."
   - *Visual no topo:* `RUMO`
6. **CATRACA**
   - *Conceito:* A engrenagem mecânica do ciclismo. Transmite robustez, energia e movimento puramente ciclístico.
   - *Frase de apresentação:* "Catraca: força no pedal e controle total na sua mão."
   - *Visual no topo:* `CATRACA`
7. **PEDAL**
   - *Conceito:* O nome mais direto e natural possível. É o substantivo exato da atividade ("fiz um pedal de 30 km").
   - *Frase de apresentação:* "Pedal: o app de bicicleta que funciona sem internet."
   - *Visual no topo:* `PEDAL`
8. **RODADO**
   - *Conceito:* Experiência, quilometragem acumulada, asfalto e terra percorridos sem perder nenhum registro.
   - *Frase de apresentação:* "Rodado: seu histórico na bike sem sair do celular."
   - *Visual no topo:* `RODADO`
9. **CATAVENTO**
   - *Conceito:* O movimento das rodas impulsionadas pelo vento e pelas pernas; sensação de ar livre e liberdade.
   - *Frase de apresentação:* "Catavento: pedale livre com sua rota no bolso."
   - *Visual no topo:* `CATAVENTO`
10. **GUIDÃO**
    - *Conceito:* O elemento onde o ciclista apoia as mãos e conduz o trajeto; alusão direta ao modo guidão (tela acesa).
    - *Frase de apresentação:* "Guidão: o controle completo do seu pedal na tela."
    - *Visual no topo:* `GUIDÃO`

### Recomendação Final
**Recomendação de Marca:** **VELO**  
*Justificativa:* Extremamente curto (4 letras), memorável, soa esportivo e sofisticado, tem encaixe tipográfico perfeito no cabeçalho superior (`VELO`) e não colide com marcas comerciais do setor ciclístico no Brasil.  
*(Nota: Conforme a diretriz, nenhuma alteração de nome foi feita no código; o nome provisório `Hodômetro` permanece intacto até decisão expressa do usuário).*

---

## 5. Frentes de Trabalho Ordenadas por Impacto para o Ciclista

### Fase 1.1: Resolução de Prioridade Zero (Correção Imediata dos 5 Problemas)
- Troca dos blocos CARTO com marca d'água por OpenStreetMap nativo em `js/mapa.js`.
- Correção de overflow com barra de rolagem em `.dialogo` em `css/app.css`.
- Ajuste de espaçamento da `.iniciar-area` para não atropelar textos em 360x660.
- Remoção de redundância no texto de rotas vazias.
- Elevação do touch target de botões `.link` para o padrão de 44px.

### Fase 2: Perfil de Elevação (Altimetria Interativa)
- Gráfico de perfil de elevação acumulada no resumo da atividade e na visualização da rota.
- Exibição de ganho acumulado, inclinação máxima e correspondência gráfica com o trajeto.

### Fase 3: Alternância para Mapa ao Vivo Durante o Pedal
- Botão de alternância no cabeçalho do pedal em andamento entre "Números" e "Mapa ao Vivo".
- Desenho dinâmico da rota escolhida com a posição atual e ponto do melhor tempo.

### Fase 4: Melhores Esforços e Segmentos
- Cálculo dos melhores tempos nos trechos contínuos de 5 km, 10 km, 20 km, 40 km e 1 hora.
- Segmentos dentro de trajetos maiores com detecção de recordes pessoais (PRs).

### Fase 5: Migração e Importação de GPX
- Leitor nativo de GPX para importar pedais antigos gravados em outros aplicativos ou no Strava.

### Fase 6: Gerenciamento de Bicicletas e Desgaste de Peças
- Cadastro de bicicletas (Estrada, MTB, Urbana).
- Alertas configuráveis de quilometragem para troca de corrente, pneus e revisão geral.

### Fase 7: Engajamento, Conquistas e Onboarding
- Sistema de conquistas e selos locais.
- Desafios automáticos do mês com contagem regressiva.
- Onboarding em 3 telas explicando o bolso, rotas e permissões.

### Fase 8: Disputa P2P e Sensores
- Compartilhamento de rotas por QR Code / JSON.
- Sensores Bluetooth (cadência / FC) via Web Bluetooth / plugin nativo.
