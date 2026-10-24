# Regras do projeto para agentes de IA

Leia o `README.md` primeiro. Este arquivo diz o que não pode quebrar.

## O que é

PWA de bike: grava o pedal pelo GPS e funciona offline. HTML, CSS e JavaScript
puro, sem build e sem dependências. Os dados ficam no IndexedDB do celular.

## Regras

1. **O motor é a parte crítica.** `js/rastreador.js`, `js/geo.js` e `js/simulador.js`
   não usam DOM e são cobertos por `tests/`. Qualquer mudança neles exige rodar
   `npm test` e `npm run precisao` antes e depois, e comparar as tabelas.
   Não mude limiares (`PADRAO` em `js/rastreador.js`) sem essa comparação.
2. **Teste novo para cada caso novo.** Se um pedal real der errado, recrie o caso
   no simulador (`gerarPercurso`) e escreva o teste antes de corrigir.
3. **Offline primeiro.** Nada de CDN, fonte externa ou script de terceiros. Arquivo
   novo do app entra na lista `ARQUIVOS` de `sw.js`.
4. **Versão.** Ao mudar qualquer arquivo servido, suba `VERSAO` em `sw.js` e em `js/app.js`.
5. **Unidades.** O motor trabalha em metros, segundos e m/s. Conversão para km,
   km/h e texto fica só em `js/formato.js`.
6. **Formato salvo.** O objeto do pedal (saída de `Rastreador.finalizar`) é gravado
   no IndexedDB e no backup. Se mudar campos, mantenha a leitura dos pedais antigos
   (campo `versao`).
7. **Textos em português do Brasil**, diretos, sem travessão. Erros dizem o que
   aconteceu e o que fazer.
8. **Visual.** Cores só pelos tokens do topo de `css/app.css`, com valores para o
   tema claro e o escuro. Números com a fonte do LCD (`--f-lcd`).
9. **Sem dados pessoais no repositório.** Nada de endereço, rota real ou backup de pedal.

## App Android (Capacitor 7)

- O app web fica na raiz. `npm run web` copia os arquivos listados em `sw.js`
  para `www/`, que vai dentro do APK. Arquivo novo do app entra nessa lista.
- `js/nativo.js` chama os plugins nativos. Use sempre `chamar(plugin, metodo, ...)`:
  nunca devolva o objeto do plugin numa Promise (ele responde a `then` e quebra).
- GPS com a tela apagada: `FonteNativa` em `js/fontes.js`, plugin
  `@capacitor-community/background-geolocation`. `fundo: true` liga a notificação.
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
- `js/app.js` liga o GPS (`js/fontes.js`) ao motor e às telas.
