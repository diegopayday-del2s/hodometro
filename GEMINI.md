# GEMINI.md: briefing para assumir a frente criativa e funcional

Você (Gemini, no Antigravity ou em qualquer agente) vai cuidar da próxima fase
deste app: nome, marca, visual e funções novas. Este arquivo explica o que existe,
o que não pode quebrar e por onde seguir. Leia também o `AGENTS.md` (regras
técnicas) e o `README.md` (uso e cálculos) antes de mexer no código.

## 1. O app em poucas linhas

App de bicicleta para Android (também roda no navegador), no estilo do Strava.
Grava o pedal pelo GPS do próprio celular, funciona sem internet e com a tela
bloqueada no bolso. Não tem conta nem servidor: tudo fica no celular.

- Nome provisório: **Hodômetro**. Escolher o nome é uma das suas tarefas.
- Público: brasileiros que pedalam por lazer e para se locomover, sozinhos ou
  com amigos. Textos em português do Brasil, diretos, sem travessão e sem
  palavras em inglês quando existe palavra nossa.
- Versão atual: 1.3 (APK publicado pelo GitHub Actions a cada push na `main`).

## 2. O que já existe (versão 1.3)

Abas: **Início**, **Rotas**, **Gravar**, **Amigos** e **Você**. Engrenagem no topo
para Ajustes. (Versão 1.4: aba Amigos e Rendimento em Você; veja o README.)

- **Início:** resumo da semana (distância, tempo, elevação), anel da meta da
  semana, atividades em cartões com o mapa do trajeto.
- **Gravar:** mapa com a posição (com internet), cartão de sinal do GPS (Buscando,
  Fraco, Bom, Excelente, precisão em metros, satélites), pendências para gravar no
  bolso (localização, notificação, bateria), escolher rota, avisos de voz e
  vibração, botão redondo laranja de iniciar.
- **Pedal em andamento:** distância e velocidade gigantes, grade com tempo em
  movimento, média, máxima e elevação; ritmo, tempo total e pausas; guia da rota
  (quanto falta, à frente ou atrás do melhor tempo); Pausar e Finalizar (só
  segurando 1,5 s); modo guidão (tela acesa).
- **No bolso (Android):** serviço em primeiro plano com GPS do chip, trava de CPU,
  notificação ao vivo na tela de bloqueio, arquivo de leituras para recuperar o
  pedal se o app fechar, avisos por voz e vibração com padrões diferentes.
- **Rotas:** caminhos repetidos viram rota sozinhos; melhor tempo, tempo médio,
  horas de atividade, tentativas com medalhas, Pedalar esta rota.
- **Você:** Progresso (distância, tempo ou elevação; 4 semanas, 3 meses, 12 meses;
  linha do período anterior; frase do resumo), Metas (semana, mês, ano), Recordes,
  totais e lista de Atividades com o lançamento de pedal sem GPS.
- **Atividade:** mapa, nome editável, números, marcas (rota, recorde), gráfico de
  velocidade, parciais, stories, texto, GPX, salvar como rota, excluir.
- **Stories:** imagem 1080 x 1920 nos modelos laranja, com foto e transparente.

## 3. O que não pode quebrar

1. **Atualizar por cima sem perder pedal.** Nunca mude o `applicationId`
   (`io.github.diegopayday.hodometro`), a chave `android/app/hodometro.keystore`,
   o nome do banco `hodometro` (`js/armazem.js`) nem as chaves `hodometro.*` do
   localStorage. A senha da chave fica só no segredo `ANDROID_KEYSTORE_PASSWORD`
   do GitHub; nunca escreva em arquivo.
2. **Formato salvo.** Pedais antigos precisam continuar abrindo. Campo novo é
   opcional. Ajustes têm `v` (hoje 3): se mudar, suba `v` e converta em `lerCfg`.
3. **Motor testado.** `js/rastreador.js`, `js/geo.js`, `js/simulador.js`,
   `js/rotas.js` e `js/progresso.js` não usam DOM e têm testes. Mudou? Rode
   `npm test` e, no motor, compare `npm run precisao` antes e depois.
4. **Offline primeiro.** Nada de CDN, fonte ou script externo. A única exceção são
   os blocos do mapa, e só como fundo: sem eles tudo funciona com o desenho.
5. **GPS do chip.** No Android o GPS é o `GPS_PROVIDER` (sem Wi-Fi nem rede). Não
   troque pelo provedor "fused" do Google.
6. **Finalizar só segurando.** Nunca troque por toque simples.
7. **Arquivo novo do app** entra na lista `ARQUIVOS` de `sw.js` (é ela que decide o
   que vai para dentro do APK). Ao mudar arquivos servidos, suba `VERSAO` em
   `sw.js` e em `js/app.js`.
8. **Sem dados pessoais no repositório:** nada de endereço, rota real, nome de
   pessoa ou backup de pedal.

## 4. Mapa do código

```
index.html            todas as telas (abas, sobrepostas, diálogos, ícones SVG)
css/app.css           visual; tokens de cor no topo
js/app.js             estado, telas, GPS, gravação, avisos, rotas, stories
js/ui.js              h(), aviso(), confirmar(), pedirTexto(), segurarPara()
js/graficos.js        gráfico de progresso, horas de atividade, anel de meta
js/progresso.js       progresso e metas (puro, testado)
js/rendimento.js      rendimento desde o primeiro pedal (puro, testado)
js/amigos.js          amigos sem servidor: arquivo, ranking, pedal junto (puro, testado)
js/rotas.js           rotas e GuiaRota (puro, testado)
js/rastreador.js      motor do pedal (puro, testado)
js/mapa.js            blocos do mapa OpenStreetMap atrás do trajeto
js/story.js           imagem dos stories
js/desenho.js         desenho do trajeto sem mapa e gráfico de velocidade
js/formato.js         números, datas e textos em português
js/fontes.js          GPS do navegador, do Android e simulado
js/marca.js           NOME_APP
android/.../hodometro GravadorPlugin, GravadorService, LeitorGnss, MainActivity
tests/                node --test
docs/apresentacao.md  apresentação curta e lista de onde o nome aparece
```

## 5. Visual (o ponto de partida)

Estilo do Strava: fundo branco, cinza claro para separar, laranja forte para o
principal, azul-petróleo para comparação. Fonte Barlow (400 a 800) embutida em
`fonts/`. Números em Barlow 700 com algarismos tabulares.

Tokens principais (`css/app.css`): `--laranja #fc5200`, `--laranja-texto #c24000`
(texto pequeno em laranja), `--laranja-suave`, `--azul #138a94`, `--verde`,
`--ambar`, `--vermelho`, `--ink`, `--muted`, `--line`, `--bg-2`.

Componentes: `.btn-pilula` (botão laranja), `.btn2` (contorno), `.chip`, `.chip-o`
(filtro), `.card` (cartão do feed com `.card-mapa`), `.numeros`, `.meta-item`,
`.tentativa`, `.dialogo`, `.sobreposta`, `.barra` (topo com título central).

O que dá para melhorar no visual: ícone e splash com a marca nova, ilustração no
estado vazio, transições entre telas, cartão do feed com avatar e frase do pedal,
modelos novos de stories (com o mapa de fundo, com o gráfico de velocidade).

## 6. Frente criativa: o que eu espero de você

Faça nesta ordem, cada item com uma proposta curta antes de codar:

1. **Nome e marca.** 10 nomes (curtos, que soem bem em português, que lembrem
   bike, pedal, rolê, estrada ou trilha, e que não sejam marca conhecida como
   Strava, Giro, Garmin, Wahoo, Komoot ou Relive), com o motivo de cada um e uma
   recomendação. Depois do nome escolhido: frase de apresentação, ícone, splash e a
   troca nos arquivos listados em `docs/apresentacao.md`.
2. **Primeira abertura.** Três telas curtas explicando gravar no bolso, rotas e
   stories, terminando na liberação de localização, notificação e bateria.
3. **Conquistas.** Selos locais (primeiro pedal, 100 km no mês, 5 dias seguidos,
   novo recorde numa rota), com tela própria e aviso no fim do pedal.
4. **Desafios do mês.** Desafio automático (por exemplo, 150 km em outubro) com
   anel e contagem regressiva, calculado com `js/progresso.js`.
5. **Retrospectiva.** Resumo do mês e do ano em imagem de stories (km, horas,
   rota favorita, maior pedal, horário preferido).

## 7. Frente funcional: o que eu espero de você

1. **Conferir o mapa de verdade.** No ambiente do Claude os servidores de mapa eram
   bloqueados, então os blocos do CARTO só foram testados com imagens falsas.
   Abra no celular ou no navegador do PC (`npm start`) e confira que o mapa
   aparece, que a atribuição "© OpenStreetMap © CARTO" está visível e que sem
   internet volta para o desenho.
2. **Segmentos.** Trechos dentro de pedais maiores (hoje a rota só reconhece o
   pedal inteiro). Ranking por trecho, como no Strava.
3. **Mapa durante o pedal.** Botão para alternar entre os números e o mapa ao vivo,
   com a rota escolhida desenhada.
4. **Perfil de elevação** no resumo do pedal e da rota.
5. **Pedal com amigos sem servidor.** Compartilhar uma rota por arquivo ou QR code
   para outra pessoa importar e correr contra o tempo dela.
6. **Sensores Bluetooth** (cadência e batimento) num plugin nativo, se fizer sentido.

Critério para cada função: funciona sem internet (o mapa é a única exceção), não
gasta bateria à toa com a tela apagada, tem teste quando tiver cálculo, e as telas
ficam boas em 360 x 660 e em 412 x 915.

## 8. Como rodar, testar e publicar

```
npm install           uma vez
npm test              testes (motor, rotas, progresso, formatos)
npm run precisao      tabela de precisão do motor
npm start             app em http://localhost:8080 (o GPS funciona no Chrome)
```

- Para testar sem sair de casa: Ajustes, "Simular um pedal".
- Para ver no celular: `git push` na `main`. O GitHub Actions roda os testes, gera
  o APK assinado e publica em
  https://github.com/diegopayday-del2s/hodometro/releases/latest/download/Hodometro.apk
- Mudança só em arquivo `.md` não gera APK.
- O Java não usa AndroidX. Se o build falhar, o erro está no log da etapa
  "Gerar APK" do Actions.

## 9. Pendências conhecidas

- O teste com a tela bloqueada num pedal de verdade ainda não foi feito: confira a
  notificação ao vivo, a voz e a vibração no bolso.
- O mapa real nunca foi visto (item 1 da seção 7).
- A voz sem internet depende da voz em português baixada no Android.
- A rota só reconhece pedal inteiro, não trecho dentro de pedal maior.

## 10. Jeito de entregar

Commits pequenos e com mensagem em português dizendo o que muda para quem usa.
Rode `npm test` antes de cada push. Ao terminar uma função, descreva em duas ou
três linhas o que mudou na tela e como testar.
