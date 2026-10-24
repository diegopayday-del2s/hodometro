# Hodômetro

Ciclocomputador no celular. Grava o pedal pelo GPS com a tela bloqueada e o
celular no bolso, sem internet e sem sinal de operadora. Mostra distância,
velocidade atual, média e máxima, tempo em movimento e tempo total, ritmo por km,
pausas, parciais e ganho de elevação. Não tem servidor nem conta: os pedais
ficam guardados no próprio celular.

Existe em duas formas: o **app Android** (recomendado, grava com a tela apagada)
e a **versão web** (PWA), que precisa da tela ligada.

## App Android

**Instalar ou atualizar:**
1. No celular, abra https://github.com/diegopayday-del2s/hodometro/releases/latest
2. Toque em `Hodometro.apk`. Se o Chrome pedir, permita instalar apps desta fonte.
3. Abra o Hodômetro. Permita a localização ("Durante o uso do app", com
   "Usar local exato" ligado) e as notificações.
4. Na tela inicial, o cartão **Pronto para o bolso** confere tudo. Se a bateria
   aparecer em amarelo, toque em **Liberar** e confirme: o Android deixa de cortar
   a gravação com a tela bloqueada.

Atualizações instalam por cima da versão anterior sem apagar os pedais, porque
todas saem com o mesmo `applicationId` e a mesma assinatura. O banco de dados
dos pedais não muda de formato.

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

- **Antes de sair:** o cartão **Sinal do GPS** mostra Buscando, Fraco, Bom ou
  Excelente, a precisão em metros e os satélites em uso. Num lugar aberto leva de
  10 segundos a 1 minuto.
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
- **Histórico:** cada pedal num cartão com data, hora, distância, tempo em
  movimento, média, máxima e subida. Tocando, abre o resumo completo (bom para
  print), com desenho do trajeto, gráfico de velocidade e parciais. Dali dá para
  compartilhar o resumo em texto, exportar GPX (o Strava importa em "Enviar
  atividade") ou excluir, com confirmação.
- **Estatísticas:** km no total, no mês e na semana, horas pedaladas, gráfico da
  semana, meta e recordes pessoais (maior pedal, maior velocidade, maior média,
  melhor km e maior subida).
- **Ajustes** (engrenagem na tela inicial): pausa automática, precisão do GPS,
  avisos, bateria, meta, backup e demonstração.
- **Lançar pedal sem GPS:** no fim do Histórico, para um pedal que não foi
  gravado. O tempo é opcional.
- **Backup:** em Ajustes. Como tudo fica no celular, exporte de vez em quando.

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
css/app.css           visual (tokens de cor no topo, tema escuro OLED)
js/app.js             controle das telas, GPS, gravação, avisos, exportação
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
js/gpx.js             exportação GPX
sw.js                 service worker (offline)
manifest.webmanifest  instalação
tests/                testes (node --test)
ferramentas/          relatório de precisão e cópia do app para o Android
android/              projeto Android (Capacitor)
  app/src/main/java/io/github/diegopayday/hodometro/
    GravadorPlugin.java   ponte JS: GPS, notificação, bateria, vibração, tela
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
ciclocomputadores Garmin e Wahoo): pausa automática com tempo em movimento
separado do total, parciais por km, aviso por voz e por vibração, notificação ao
vivo na tela de bloqueio, modo guidão, velocidade máxima, subida, recordes
pessoais, meta semanal, exportação GPX e recuperação do pedal se o app fechar no meio.

Próximos passos possíveis:

- **Sensor de cadência ou de batimento por Bluetooth** (Web Bluetooth no Chrome
  do Android): contaria as pedaladas por minuto.
- **Mapa com fundo offline** (tiles baixados antes) e navegação por rota.
- **Segmentos**: trechos favoritos com tempo melhor de cada vez.
- **Compartilhar localização ao vivo** com alguém durante o pedal.
