# Só Mais Um KM

App de pedal no celular. Grava pelo GPS com a tela bloqueada e o celular no
bolso, sem internet e sem sinal de operadora. Mostra distância, velocidade atual,
média e máxima, tempo em movimento e tempo total, ritmo por km, pausas, parciais
e ganho de elevação. Tem rendimento desde o primeiro pedal, progresso com
comparação, metas, rotas que você repete (com seu melhor tempo), amigos com
ranking e imagem para os stories. Não tem servidor nem conta: os pedais ficam
guardados no próprio celular.

O nome do app é **Só Mais Um KM** (até a versão 1.3 era Hodômetro, que continua sendo o
nome do repositório, do pacote Android e do arquivo `Hodometro.apk`). A lista de
arquivos onde o nome aparece está em `docs/apresentacao.md`.

Existe em duas formas: o **app Android** (recomendado, grava com a tela apagada)
e a **versão web** (PWA), que precisa da tela ligada.

## App Android

**Instalar ou atualizar:**
1. No celular, abra https://github.com/diegopayday-del2s/hodometro/releases/latest
2. Toque em `Hodometro.apk`. Se o Chrome pedir, permita instalar apps desta fonte.
3. Abra o Só Mais Um KM. Permita a localização ("Durante o uso do app", com
   "Usar local exato" ligado) e as notificações.
4. Na tela inicial, o cartão **Pronto para o bolso** confere tudo. Se a bateria
   aparecer em amarelo, toque em **Liberar** e confirme: o Android deixa de cortar
   a gravação com a tela bloqueada.

Atualizações instalam por cima da versão anterior sem apagar os pedais, porque
todas saem com o mesmo `applicationId` e a mesma assinatura. O banco de dados
dos pedais não muda de formato. Na primeira vez que uma versão nova abre, o app
guarda uma **cópia automática** de todos os pedais antes de qualquer outra coisa
(em Ajustes, Seus dados, dá para restaurar; restaurar só devolve o que faltar).

**Como grava no bolso:**
- O GPS vem direto do chip do celular (satélites GPS, Galileo, GLONASS, BeiDou),
  sem Wi-Fi, sem rede e sem internet.
- Um serviço do Android em primeiro plano (tipo localização) segura o GPS e uma
  trava de CPU mantém o processador lendo com a tela apagada.
- A notificação na tela de bloqueio mostra distância, tempo em movimento e
  velocidade, atualizada a cada 2 segundos.
- Cada leitura também vai para um arquivo. Se o app for fechado no meio do pedal
  (ou tirado da lista de recentes), o serviço continua gravando e o app recupera
  as leituras ao abrir de novo.
- O botão Voltar do Android não fecha o app no meio do pedal: só manda para
  segundo plano.

**Como o APK é feito:** a cada mudança na branch `main`, o GitHub Actions
(`.github/workflows/android.yml`) roda os testes, monta o app e publica o APK na
página de versões. Para assinar, ele usa a chave `android/app/hodometro.keystore`
com a senha guardada no segredo `ANDROID_KEYSTORE_PASSWORD` do repositório.
Guarde essa senha num lugar seguro: sem ela, uma versão nova não instala por cima.

## Usar

O app tem cinco abas: **Início**, **Rotas**, **Gravar**, **Amigos** e **Você**. A
engrenagem no topo abre os Ajustes.

- **Início:** resumo da semana (distância, tempo e elevação), a meta da semana e
  as atividades em cartões com o mapa do trajeto, as suas e as dos amigos.
- **Gravar:** mapa com a sua posição (quando tem internet), o cartão **Sinal do
  GPS** (Buscando, Fraco, Bom ou Excelente, com a precisão em metros e os
  satélites em uso), o que falta liberar para gravar no bolso, a rota a seguir e
  os avisos. O botão redondo laranja começa o pedal.
- **Começar pedal:** pode bloquear a tela e guardar o celular. No topo do painel,
  o sol liga o **modo guidão** (tela sempre acesa, para usar no suporte da bike).
- **Painel:** distância e velocidade em destaque; embaixo, tempo em movimento,
  média, máxima e altimetria; na última linha, ritmo, tempo total e pausas.
- **Pausa automática:** abaixo de 3 km/h por 5 segundos o tempo em movimento para.
  Volta assim que você passa de 5 km/h. A média usa só o tempo em movimento, então
  o semáforo não derruba a média.
- **Avisos no bolso:** voz e vibração a cada 1 ou 5 km (distância, média e tempo
  do último km). Vibração diferente para cada caso: km, 2 toques; pausou, 1 toque
  longo; voltou, 3 toques curtos. Liga e desliga na tela inicial ou no topo do painel.
- **Pausar:** para quando você quer descer da bike e andar sem contar.
- **Finalizar:** segure o botão vermelho por 1,5 segundo, com a barra enchendo.
  Toque rápido não encerra, para não acabar o pedal sem querer no bolso.
- **Atividade:** tocando num cartão abre o resumo com o mapa, os números, as
  marcas (rota, melhor tempo, recordes), o gráfico de velocidade e as parciais.
  O lápis muda o nome do pedal. Dali dá para compartilhar nos stories, mandar o
  resumo em texto, exportar GPX (o Strava importa em "Enviar atividade"), salvar
  o caminho como rota ou excluir, com confirmação.
- **Stories:** imagem de 1080 x 1920 com distância, subida, tempo e o desenho do
  trajeto. Modelos: laranja, com uma foto da galeria ou transparente (para colar
  por cima de uma foto no Instagram).
- **Rotas:** quando você faz o mesmo caminho duas vezes, ele vira rota sozinho.
  Cada rota mostra quantas vezes você fez, melhor tempo, tempo médio, os horários
  em que costuma sair e todas as tentativas com medalha para as 3 melhores.
  **Pedalar esta rota** grava mostrando quanto falta, se você saiu do caminho e
  quantos segundos está à frente ou atrás do seu melhor tempo (também por voz).
- **Você, Rendimento:** tudo desde o primeiro pedal, para quem começou há pouco
  também ter gráfico cheio. Total de km, tempo, média e elevação; o que mudou
  ("sua média subiu 12%", "seus pedais estão 30% mais longos", "na rota X você já
  está 1m 20s mais rápido"); distância somada dia a dia; velocidade média de cada
  pedal com a tendência; km por semana; começo e agora lado a lado; o próximo
  marco (25, 50, 100 km...) e quando você chega nele no seu ritmo; as rotas em que
  você melhorou; e a constância (dias pedalados, semanas seguidas). Dá para
  compartilhar nos stories ou mandar para um amigo.
- **Você, Progresso:** distância, tempo ou elevação nas últimas 4 semanas, 3
  meses ou 12 meses, com a linha do período anterior para comparar e a frase do
  resumo ("sua distância aumentou 12%"). Embaixo, metas de semana, mês e ano em
  km, horas ou subida (quanto falta, quanto precisa por semana e onde você chega
  no ritmo de agora) e recordes pessoais.
- **Amigos:** sem conta e sem servidor. **Mandar meu rendimento** gera um arquivo
  (com os mapas dos últimos 20 pedais, ou só os números) para mandar pelo
  WhatsApp. O amigo toca no arquivo, abre com o app e você entra nos amigos dele.
  Aparecem o ranking da semana, do mês e desde o começo, os pedais dos amigos no
  feed, e o ranking da rota (o melhor tempo de cada um no mesmo caminho). Quando
  vocês pedalam juntos, o resumo do pedal mostra os números dos dois celulares
  lado a lado e explica a diferença. Para atualizar, cada um manda de novo. Os
  pedais dos amigos ficam à parte e nunca entram no seu progresso.
- **Você, Atividades:** todos os pedais por mês e o **Lançar pedal sem GPS**, para
  um pedal que não foi gravado (o tempo é opcional).
- **Ajustes:** pausa automática, precisão do GPS, mapa de fundo, avisos, bateria,
  backup, cópia automática e demonstração.
- **Backup:** em Ajustes. Como tudo fica no celular, exporte de vez em quando. O
  backup leva os pedais, as rotas, os amigos e o seu nome no ranking.

## Como calcula

O motor fica em `js/rastreador.js` e não depende da tela. Os passos:

1. Descarta leituras com precisão pior que 15 m (ajustável para 20 ou 25 m).
2. Descarta saltos: acima de 85 km/h, Doppler acima de 85 km/h, ou posição que
   pulou mais do que a velocidade medida permite andar desde a última leitura.
3. Passa a posição por um filtro de Kalman. Quando o celular informa a velocidade
   do sensor (Doppler, todo GPS de celular informa), o filtro usa posição,
   velocidade e direção juntas.
4. Só soma distância em movimento, acima de 2 km/h e quando andou mais que a margem
   de erro da posição, para o tremido do GPS parado não virar quilômetro.
5. Com Doppler, a distância de cada trecho sai da velocidade integrada no tempo,
   desde que bata com o deslocamento do GPS.
6. Velocidade na tela: mediana das 3 últimas leituras (tira o pico) e média móvel,
   para o número não pular.
7. Parada: com Doppler, abaixo de 2,9 km/h por 5 s. Só com posição, ficar num raio
   de 8 m por 12 s. Nos dois casos o tempo é devolvido desde o momento em que você
   parou, então a média fica certa.
8. Túnel ou sinal perdido: quando o sinal volta, o trecho entra em linha reta e
   fica tracejado no desenho. O tempo em movimento do trecho sai da sua média.

**Rotas** (`js/rotas.js`): cada pedal vira uma linha com um ponto a cada 50 m.
Dois pedais são a mesma rota quando saem e chegam a menos de 200 m, têm distância
parecida (15%) e 85% de cada caminho fica a menos de 60 m do outro. Ida e volta
são rotas diferentes. Durante o pedal, a comparação com o melhor tempo usa o
tempo em movimento, sem as paradas.

**Mapa:** os blocos do mapa vêm do OpenStreetMap quando tem internet (o CARTO
passou a exigir chave e devolvia blocos com a marca "API KEY REQUIRED"). É só o
fundo: a gravação, as rotas e os números nunca dependem dele.
Sem internet aparece o desenho do trajeto, como antes.

Precisão nos testes com pedais simulados (tremido de 4 m, como um celular comum;
retas, semáforos, curvas, esquinas e um pedal de cidade de 6 km, 10 repetições
cada, com e sem perda de 20% das leituras). Para ver a tabela completa: `npm run precisao`.

| Situação | Erro de distância (pior caso) | Erro no tempo em movimento (pior caso) |
|---|---|---|
| Celular informa velocidade (todo celular com GPS) | 1% (2% abaixo de 10 km/h com sinal falhando) | 11 s num pedal de 18 min |
| Celular só informa posição | 3% | 25 s num pedal de 18 min |

## Limites que você precisa saber

- **Versão web:** o navegador para o GPS quando a tela apaga. Por isso ela mantém
  a tela ligada. Para o bolso, use o app Android.
- **Subida:** vem da altitude do GPS, que varia bastante. É estimativa.
- **Mapa:** precisa de internet. Sem ela, fica o desenho do trajeto.
- **Voz sem internet:** usa a voz do Android. Se ela não falar offline, abra
  Configurações > Gerenciamento geral > Conversão de texto em voz e baixe o
  português do Brasil.
- **Dados:** ficam só no celular. Desinstalar o app apaga os pedais. Use o backup.

## Versão web (PWA)

1. Abra o endereço do app no celular (o do GitHub Pages, veja "Publicar" abaixo).
2. **Android (Chrome):** toque em "Instalar app" no aviso do app ou no menu ⋮ do Chrome.
3. **iPhone (Safari):** toque em Compartilhar e depois em "Adicionar à Tela de Início".
4. Abra pelo ícone novo. Na primeira vez, permita a localização.

## Desenvolver e polir no Antigravity (Windows)

Programas: [Git](https://git-scm.com/download/win), [Node.js 22 LTS](https://nodejs.org)
e, só se quiser testar ligado no celular por cabo, o [Android Studio](https://developer.android.com/studio).

1. No terminal (PowerShell):
   `git clone https://github.com/diegopayday-del2s/hodometro.git C:\Projetos\hodometro`
2. No Antigravity: File > Open Folder > `C:\Projetos\hodometro`. Essa é a pasta raiz.
3. No terminal do Antigravity: `npm install` e `npm test`.
4. Peça as mudanças ao agente. Ele deve ler o `AGENTS.md` primeiro.
5. Para gerar um APK novo, basta enviar para o GitHub (`git push`): o Actions publica sozinho.

Testar no celular pelo cabo, com Android Studio:
1. No celular: Configurações > Sobre o telefone > toque 7 vezes em "Número da versão".
   Depois, em Opções do desenvolvedor, ligue "Depuração USB".
2. No Antigravity: `npm run android:abrir`. O Android Studio abre o projeto `android/`.
3. Espere o Gradle terminar, escolha o celular na barra de cima e toque em Run (▶).
4. O app instalado pelo Android Studio tem outra assinatura. Antes, faça backup
   no app e desinstale a versão do GitHub. Para voltar, faça o inverso.

O app é HTML, CSS e JavaScript puro (módulos ES), sem build. O Android usa o
Capacitor só como casca, mais o plugin `Gravador` escrito no próprio projeto.

```
index.html            telas
css/app.css           visual (tokens de cor no topo, tema claro e laranja)
js/app.js             controle das telas, GPS, gravação, avisos, exportação
js/marca.js           nome do app (um lugar só)
js/progresso.js       progresso por semana ou mês e metas (sem DOM, testado)
js/rendimento.js      rendimento desde o primeiro pedal (sem DOM, testado)
js/amigos.js          arquivo do amigo, ranking, pedal junto (sem DOM, testado)
js/rotas.js           rotas repetidas e guia durante o pedal (sem DOM, testado)
js/mapa.js            blocos de mapa atrás do trajeto, quando tem internet
js/story.js           imagem para os stories
js/graficos.js        progresso, rendimento, horas de atividade e anéis de meta
js/ui.js              peças de tela: avisos, diálogos, botão de segurar
js/rastreador.js      motor de cálculo (sem DOM, testado)
js/geo.js             distância (haversine), projeção e filtros de Kalman
js/simulador.js       gera leituras falsas de GPS para testes e demonstração
js/formato.js         números e datas em português, totais, recordes
js/armazem.js         IndexedDB (pedais e pedal em andamento)
js/desenho.js         desenho do trajeto (canvas) e gráfico de velocidade (SVG)
js/fontes.js          leitura do GPS (navegador, Android) e fonte simulada
js/nativo.js          ponte para os plugins do Android
js/voz.js             avisos falados
js/vibra.js           avisos por vibração
js/gpx.js             exportação e importação GPX
sw.js                 service worker (offline)
manifest.webmanifest  instalação
tests/                testes (node --test)
ferramentas/          precisão, cópia do app para o Android e ícone (icone.py)
android/              projeto Android (Capacitor)
  app/src/main/java/io/github/diegopayday/hodometro/
    GravadorPlugin.java   ponte JS: GPS, notificação, bateria, vibração, tela,
                          arquivo aberto com o app (amigo, backup, GPX)
    GravadorService.java  serviço em primeiro plano: GPS, trava de CPU, arquivo
    LeitorGnss.java       GPS direto do chip e contagem de satélites
    MainActivity.java     registra o plugin e trata o botão Voltar
```

Comandos (precisa de Node 20 ou mais novo):

```
npm test              roda os testes do motor e dos formatos
npm run precisao      tabela de precisão com pedais simulados
npm start             serve o app em http://localhost:8080
```

Para testar o GPS no computador, use o modo demonstração ou as ferramentas do
Chrome (Sensores > Localização). O service worker só funciona em `localhost` ou HTTPS.

**Ao mudar qualquer arquivo do app**, suba `VERSAO` em `sw.js` (e em `js/app.js`).
Sem isso o celular continua com a versão guardada.

O arquivo `AGENTS.md` explica as regras do projeto para agentes de IA
(Antigravity, Claude Code e outros). Se o agente não ler sozinho, peça para ele
ler o `AGENTS.md` antes de começar.

## Publicar (GitHub Pages)

1. No GitHub, abra o repositório > Settings > Pages.
2. Em "Build and deployment", escolha "Deploy from a branch", branch `main`, pasta `/ (root)`.
3. Salve. Em um ou dois minutos o app fica em `https://<seu-usuario>.github.io/<repositorio>/`.

## Ideias dos apps pagos

Já está no app (inspirado em Strava, Ride with GPS, Cyclemeter, MapMyRide e nos
ciclocomputadores Garmin e Wahoo): feed de atividades com mapa, progresso com
comparação ao período anterior, metas de semana, mês e ano, rotas reconhecidas
sozinhas com melhor tempo e horários, pedalar contra o seu melhor tempo, imagem
para os stories, pausa automática com tempo em movimento separado do total,
parciais por km, aviso por voz e por vibração, notificação ao vivo na tela de
bloqueio, modo guidão, recordes pessoais, exportação GPX e recuperação do pedal
se o app fechar no meio.

Próximos passos possíveis:

- **Sensor de cadência ou de batimento por Bluetooth** (Web Bluetooth no Chrome
  do Android): contaria as pedaladas por minuto.
- **Mapa com fundo offline** (tiles baixados antes) e navegação por rota.
- **Segmentos**: trechos favoritos com tempo melhor de cada vez.
- **Compartilhar localização ao vivo** com alguém durante o pedal.

**Trocar o ícone:** `python ferramentas/icone.py caminho/da/logo.png` gera todos
os tamanhos do Android (ícone adaptativo, redondo e a abertura) e da versão web.
Precisa do Python com Pillow (`pip install pillow`).
