# Hodômetro

App de celular para gravar pedal de bike pelo GPS. Mostra distância, velocidade
atual, média e máxima, ritmo por km, tempo em movimento, tempo total, pausas,
parciais por km e subida. Funciona sem internet depois de instalado.

É um app web instalável (PWA): abre pelo navegador uma vez, instala na tela
inicial e depois roda como app, offline. Não tem servidor nem conta: os pedais
ficam guardados no próprio celular.

## Instalar no celular

1. Abra o endereço do app no celular (o do GitHub Pages, veja "Publicar" abaixo).
2. **Android (Chrome):** toque em "Instalar app" no aviso do app ou no menu ⋮ do Chrome.
3. **iPhone (Safari):** toque em Compartilhar e depois em "Adicionar à Tela de Início".
4. Abra pelo ícone novo. Na primeira vez, permita a localização.

## Usar

- **Antes de sair:** abra o app e espere o cartão do GPS ficar verde ("GPS pronto").
  Num lugar aberto leva de 5 a 30 segundos.
- **Começar pedal:** a tela fica ligada sozinha enquanto grava. Prenda o celular
  no guidão. O status no topo mostra Gravando, Pausa automática, Pausado ou Sinal fraco.
- **Pausa automática:** abaixo de 3 km/h por 5 segundos o tempo para de contar.
  Volta sozinho quando você sai. O tempo parado não entra na média.
- **Pausar:** para quando você quer descer da bike e andar sem contar.
- **Finalizar:** toque duas vezes (para não encerrar sem querer). Abre o resumo
  com desenho do trajeto, gráfico de velocidade e parciais por km.
- **Voz:** em Ajustes, aviso falado a cada 1, 2 ou 5 km com o tempo do último km e a média.
- **Exportar GPX:** no resumo do pedal. O Strava importa em "Enviar atividade".
- **Backup:** em Ajustes. Como tudo fica no celular, exporte de vez em quando.
- **Demonstração:** em Ajustes, "Simular um pedal" grava um pedal falso de uns
  6 km em menos de um minuto, para testar sem sair de casa.

## Como calcula

O motor fica em `js/rastreador.js` e não depende da tela. Os passos:

1. Descarta leituras com precisão pior que 25 m (ajustável) e saltos impossíveis
   (acima de 90 km/h).
2. Passa a posição por um filtro de Kalman. Quando o celular informa a velocidade
   do sensor (Doppler, quase todo celular com GPS informa), o filtro usa
   posição, velocidade e direção juntas.
3. Só soma distância em movimento e acima de um passo mínimo, para o tremido
   do GPS parado não virar quilômetro.
4. Com Doppler, a distância de cada trecho sai da velocidade integrada no tempo,
   desde que bata com o deslocamento do GPS.
5. Parada: com Doppler, velocidade abaixo de 2,9 km/h por 5 s. Só com posição,
   ficar num raio de 8 m por 12 s. Nos dois casos o tempo é devolvido desde o
   momento em que você parou, então a média fica certa.
6. Tela bloqueada ou túnel: quando o sinal volta, o trecho entra em linha reta
   e fica tracejado no desenho. O tempo em movimento do trecho sai da sua média.

Precisão nos testes com pedais simulados (tremido de 4 m, como um celular comum;
retas, semáforos, curvas, esquinas e um pedal de cidade de 6 km, 10 repetições
cada, com e sem perda de 20% das leituras). Para ver a tabela completa: `npm run precisao`.

| Situação | Erro de distância (pior caso) | Erro no tempo em movimento (pior caso) |
|---|---|---|
| Celular informa velocidade (a maioria) | 1% (2% abaixo de 10 km/h com sinal falhando) | 11 s num pedal de 18 min |
| Celular só informa posição | 3% | 25 s num pedal de 18 min |

## Limites que você precisa saber

- **Tela apagada:** o navegador para o GPS quando a tela apaga ou o app vai para
  segundo plano. Por isso o app mantém a tela ligada. Se ela apagar, o trecho
  entra em linha reta, o que pode encurtar um caminho cheio de curvas.
  Gravar com o celular no bolso e a tela apagada só com app nativo (veja "Próximos passos").
- **Subida:** vem da altitude do GPS, que varia bastante. É estimativa.
- **Dados:** ficam só no navegador do celular. Desinstalar o app ou limpar os
  dados do site apaga os pedais. Use o backup.

## Desenvolver e polir no Antigravity

Não tem build nem dependência: é HTML, CSS e JavaScript puro (módulos ES).

```
index.html            telas
css/app.css           visual (tokens de cor no topo, tema claro e escuro)
js/app.js             controle das telas, GPS, gravação, voz, exportação
js/rastreador.js      motor de cálculo (sem DOM, testado)
js/geo.js             distância (haversine), projeção e filtros de Kalman
js/simulador.js       gera leituras falsas de GPS para testes e demonstração
js/formato.js         números e datas em português, totais, recordes
js/armazem.js         IndexedDB (pedais e pedal em andamento)
js/desenho.js         desenho do trajeto (canvas) e gráfico de velocidade (SVG)
js/fontes.js          leitura do GPS e fonte simulada
js/voz.js             avisos falados
js/gpx.js             exportação GPX
sw.js                 service worker (offline)
manifest.webmanifest  instalação
tests/                testes (node --test)
ferramentas/          relatório de precisão
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

Já está no app (inspirado em Strava, Ride with GPS, Cyclemeter e MapMyRide):
pausa automática com tempo em movimento separado do total, parciais por km,
aviso por voz, velocidade máxima, subida, recordes pessoais, meta semanal,
exportação GPX e recuperação do pedal se o app fechar no meio.

Próximos passos possíveis:

- **App nativo com GPS em segundo plano** (Capacitor + plugin de geolocalização
  em background): grava com a tela apagada, como Strava. O motor `js/rastreador.js`
  pode ser reaproveitado sem mudança.
- **Sensor de cadência ou de batimento por Bluetooth** (Web Bluetooth no Chrome
  do Android): contaria as pedaladas por minuto.
- **Mapa com fundo offline** (tiles baixados antes) e navegação por rota.
- **Segmentos**: trechos favoritos com tempo melhor de cada vez.
- **Compartilhar localização ao vivo** com alguém durante o pedal.
