# Regras do projeto para agentes de IA

Leia o `README.md` primeiro. Este arquivo diz o que não pode quebrar.

## O que é

App de pedal: grava pelo GPS e funciona offline, com progresso, metas, rotas e
stories no estilo do Strava. HTML, CSS e JavaScript puro, sem build. Roda como
PWA e como app Android (Capacitor, com o plugin próprio `Gravador`). Os dados
ficam no IndexedDB do celular. O nome é provisório: veja `docs/apresentacao.md`.

## Regras

1. **O motor é a parte crítica.** `js/rastreador.js`, `js/geo.js` e `js/simulador.js`
   não usam DOM e são cobertos por `tests/`. `js/rotas.js` e `js/progresso.js`
   também não usam DOM e têm testes próprios. Qualquer mudança neles exige rodar
   `npm test` e `npm run precisao` antes e depois, e comparar as tabelas.
   Não mude limiares (`PADRAO` em `js/rastreador.js`) sem essa comparação.
2. **Teste novo para cada caso novo.** Se um pedal real der errado, recrie o caso
   no simulador (`gerarPercurso`) e escreva o teste antes de corrigir.
3. **Offline primeiro.** Nada de CDN, fonte externa ou script de terceiros. Arquivo
   novo do app entra na lista `ARQUIVOS` de `sw.js`. A única coisa da internet são
   os blocos do mapa (`js/mapa.js`), e só como fundo: se não carregarem, tudo
   continua funcionando com o desenho do trajeto.
4. **Versão.** Ao mudar qualquer arquivo servido, suba `VERSAO` em `sw.js` e em `js/app.js`.
5. **Unidades.** O motor trabalha em metros, segundos e m/s. Conversão para km,
   km/h e texto fica só em `js/formato.js`.
6. **Formato salvo.** O objeto do pedal (saída de `Rastreador.finalizar`) é gravado
   no IndexedDB e no backup. Se mudar campos, mantenha a leitura dos pedais antigos
   (campo `versao`).
7. **Textos em português do Brasil**, diretos, sem travessão. Erros dizem o que
   aconteceu e o que fazer.
8. **Visual.** Tema claro no estilo do Strava. Cores só pelos tokens do topo de
   `css/app.css`: `--laranja` para o principal (gravar, sua linha, o trajeto),
   `--azul` para comparar com o período anterior, `--verde` GPS bom e à frente do
   melhor, `--ambar` pausado e sinal fraco, `--vermelho` excluir e atrás do melhor.
   Títulos em Barlow 800, números em Barlow 700 com algarismos tabulares, para não
   dançarem. Botões grandes, de no mínimo 44 px.
9. **Sem dados pessoais no repositório.** Nada de endereço, rota real ou backup de pedal.
10. **Finalizar só segurando.** O botão Finalizar precisa ser segurado por 1,5 s
    (`segurarPara` em `js/app.js`). Não troque por toque simples.
11. **Ajustes salvos.** `hodometro.cfg` no localStorage tem o campo `v` (hoje 3).
    Se mudar o formato, suba `v` e converta o antigo em `lerCfg`.
12. **Nome do app.** Fica em `js/marca.js` e nos arquivos listados em
    `docs/apresentacao.md`. Nunca mude o `applicationId`, a chave de assinatura,
    o nome do banco `hodometro` nem as chaves `hodometro.*` do localStorage.
13. **Rotas salvas** ficam no IndexedDB, loja `estado`, chave `rotas`. Rota
    excluída fica com `oculta: true`, para os mesmos pedais não criarem a rota de novo.

## App Android (Capacitor 7)

- O app web fica na raiz. `npm run web` copia os arquivos listados em `sw.js`
  para `www/`, que vai dentro do APK. Arquivo novo do app entra nessa lista.
- `js/nativo.js` chama os plugins nativos. Use sempre `chamar(plugin, metodo, ...)`:
  nunca devolva o objeto do plugin numa Promise (ele responde a `then` e quebra).
- GPS: `FonteNativa` em `js/fontes.js` fala com o plugin `Gravador`
  (`android/app/src/main/java/io/github/diegopayday/hodometro/`). Sem `fundo`, só
  observa o sinal antes de sair. Com `fundo: true`, liga o `GravadorService`:
  serviço em primeiro plano do tipo localização, trava de CPU, notificação ao vivo
  e arquivo de leituras. O GPS é o do chip (`LocationManager.GPS_PROVIDER`), sem
  Wi-Fi nem rede. Não troque pelo provedor "fused" do Google.
- Se o app fechar no meio, `perdidas(desde)` devolve as leituras que o serviço
  gravou sozinho; `recuperarPerdidas` em `js/app.js` passa pelo motor em ordem.
  O arquivo só é apagado (`limpar`) depois do pedal salvo.
- O Java não usa AndroidX (só a API do Android e a do Capacitor). Mudou o Java?
  O GitHub Actions compila; veja o log da etapa "Gerar APK" se falhar.
- `android/` é gerado pelo Capacitor e versionado. Depois de mudar plugins:
  `npm run android:sync`.
- Nunca grave a senha da assinatura em arquivo. Ela fica só no segredo
  `ANDROID_KEYSTORE_PASSWORD` do GitHub.

## Comandos

```
npm test            testes
npm run precisao    relatório de precisão
npm start           servidor local em http://localhost:8080
npm run android:sync   copia o app para o projeto Android
npm run android:abrir  abre no Android Studio
```

## Mapa rápido do código

- `Rastreador.push(leitura)` processa cada leitura do GPS e devolve eventos
  (`km`, `parou`, `retomou`, `sinal`). `painel(agora)` dá os números ao vivo.
  `finalizar(agora)` devolve o pedal para salvar. `toJSON`/`deJSON` salvam o pedal
  em andamento a cada 5 s, para recuperar se o app fechar.
- Estados: `aguardando` (sem GPS bom), `movendo`, `parado` (pausa automática ou
  espera antes de sair), `pausado` (pausa manual).
- `js/app.js` liga o GPS (`js/fontes.js`) ao motor e às telas. Abas: Início,
  Rotas, Gravar e Você (Progresso e Atividades). Ajustes pela engrenagem. Por cima
  das abas abrem a atividade, a rota e os stories (`abrirSobreposta`); o Voltar do
  Android fecha uma de cada vez pelo histórico (`popstate`).
- `organizarRotas(salvas, pedais)` junta as rotas salvas com o histórico e cria as
  automáticas. `GuiaRota` acompanha o pedal em andamento numa rota.
- Avisos: `js/voz.js` (voz do sistema) e `js/vibra.js` (padrões de vibração).
