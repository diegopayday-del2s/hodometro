# Apresentação do app (para o Gemini e para quem for dar nome e cuidar da marca)

## O que é

Um app de celular para quem anda de bicicleta, feito para Android (também roda
no navegador). Grava o pedal pelo GPS do próprio celular e mostra os números de
um ciclocomputador. Funciona sem internet e com a tela bloqueada, com o celular
no bolso. Não tem conta nem servidor: os dados ficam no celular.

O nome é **Só Mais Um KM**, escolhido em 28/10/2026 (antes era Hodômetro). O dono do
app usa a bike no dia a dia e para passear com amigos.

## O que ele faz

- **Gravar:** distância, velocidade atual, média e máxima, tempo em movimento e
  tempo total, ritmo por km, pausas e subida. Pausa sozinho no semáforo e volta
  quando você sai. Botão de finalizar que precisa ser segurado, para não
  encerrar sem querer no bolso.
- **No bolso:** notificação na tela de bloqueio com os números ao vivo, aviso
  por voz e por vibração a cada 1 ou 5 km, vibração diferente quando pausa e
  quando volta. Modo guidão para deixar a tela acesa no suporte da bike.
- **Início:** resumo da semana, meta da semana e as atividades em cartões com o
  mapa do trajeto, como um feed.
- **Rotas:** reconhece sozinho os caminhos que a pessoa repete (a ida para o
  trabalho, o passeio de sábado). Mostra quantas vezes fez, o melhor tempo, o
  tempo médio e os horários em que costuma ir. Dá para seguir uma rota e correr
  contra o próprio melhor tempo, com aviso de "à frente" ou "atrás".
- **Você:** progresso em distância, tempo ou subida, nas últimas 4 semanas, 3
  meses ou 12 meses, comparado com o período anterior ("sua distância aumentou
  12%"). Metas de semana, mês e ano com anéis de progresso. Recordes pessoais.
- **Stories:** gera a imagem do pedal para o Instagram (distância, subida, tempo
  e o desenho do trajeto), com fundo laranja, com uma foto ou transparente.

## Visual

Inspirado no Strava: fundo branco, laranja forte (#FC5200) para o que importa,
azul-petróleo para comparação, títulos em Barlow ExtraBold e números grandes. A
logo é uma ilustração de duas pessoas pedalando numa trilha na mata, em verdes e
amarelo, com a linha do trajeto e o marcador do GPS (`icons/logo-original.png`).
O fundo do ícone do Android é verde-escuro (#1F5040).

## Público e tom

Brasileiro, quem pedala por lazer e para se locomover, sozinho ou com amigos.
Textos em português do Brasil, diretos, sem termos em inglês quando existe
palavra nossa.

## O que preciso do nome

- Curto (de preferência até 8 letras), fácil de falar e de lembrar.
- Em português, ou que soe bem em português.
- Que lembre bicicleta, pedal, rolê, estrada ou trilha.
- Que não seja marca conhecida de bike ou de app (Strava, Giro, Garmin, Wahoo,
  Komoot, Relive e parecidos).
- Que funcione como nome de app no Android e como palavra no topo do app, em
  letras maiúsculas.

Peça ao Gemini: 10 opções de nome com o motivo de cada uma, uma frase curta de
apresentação para cada, e a recomendação final.

## Onde trocar o nome no código (depois de escolher)

- `js/marca.js`: `NOME_APP` (aparece no topo do app, nos stories e no texto compartilhado)
- `index.html`: `<title>` e `apple-mobile-web-app-title`
- `manifest.webmanifest`: `name` e `short_name`
- `capacitor.config.json`: `appName`
- `android/app/src/main/res/values/strings.xml`: `app_name` e `title_activity_main`
- `js/story.js`, `js/formato.js` e `js/gpx.js`: o nome padrão (o app passa `NOME_APP`,
  mas o padrão aparece se alguém chamar sem ele)
- `package.json`: `description`
- `.github/workflows/android.yml`: o título da versão (`--title`). O arquivo
  `Hodometro.apk` pode ficar com o nome antigo: é o link que já está nos celulares.
- `README.md`, `GEMINI.md`, `AGENTS.md`

Ícone: `python ferramentas/icone.py caminho/da/logo.png` troca todos os tamanhos.

**Não mude** o `applicationId` (`io.github.diegopayday.hodometro`), a chave de
assinatura (`android/app/hodometro.keystore`), o nome do banco (`hodometro` em
`js/armazem.js`) nem as chaves `hodometro.*` do localStorage. Mudar qualquer um
deles faz o app novo não instalar por cima do antigo ou apaga os pedais salvos.
