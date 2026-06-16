# Handoff — Gas Manager

**Última atualização:** 2026-06-15

## Status

Todas as 9 tarefas do plano `docs/superpowers/plans/2026-06-15-gas-manager-gaps.md` foram implementadas, revisadas (spec + qualidade) e commitadas. App funcionalmente completo para uso local:

- Zustand version-counter store para invalidação de cache entre telas
- Edição de cliente, detalhe de cliente com histórico de compras e quitação de dívida
- Cancelamento de venda com rollback de estoque/saldo
- Edição de preço de botijão + histórico de reposições (restocks) na tela de estoque
- Lucro e margem nos relatórios

Commits relevantes: `f8f6920` até `1339d24` (10 commits acima de `origin/main`, branch local ainda não tem remote configurado/push feito).

## Bloqueio atual: não foi possível rodar o app no celular

**Causa raiz identificada:** `package.json` tem `"expo": "~52.0.0"` mas todos os subpacotes (`expo-router`, `expo-sqlite`, `expo-constants` etc.) estão fixados em `~56.x`. Isso é uma incompatibilidade de versões — o app deveria estar inteiramente em Expo SDK 56.

**Sintoma:** `npx expo start` falha com Node.js v22 (versão atual da máquina):
```
ERR_PACKAGE_PATH_NOT_EXPORTED ... metro/src/lib/TerminalReporter
```
Causa: `metro@0.84.4` (trazido pelo `expo@52`) não exporta esse subpath sob as regras estritas de `exports` do Node 22.

**Tentativa em andamento (não concluída):** instalar Node 20 LTS via nvm-windows para contornar o problema do metro, em vez de corrigir a versão do Expo.
- `winget install CoreyButler.NVMforWindows` → instalado com sucesso (nvm 1.2.2)
- `NVM_HOME=C:\Users\PC\AppData\Local\nvm`, `NVM_SYMLINK=C:\nvm4w\nodejs` (registradas em User e Machine)
- `nvm install 20` falha com `ERROR open \settings.txt: The system cannot find the file specified.` mesmo executando de dentro do diretório do nvm, e mesmo com `C:\Users\PC\AppData\Local\nvm\settings.txt` existindo e com conteúdo válido (`root:` e `path:` corretos). Causa exata não identificada — parece um bug de resolução de path do nvm-windows 1.2.2 nesta máquina (tenta abrir `\settings.txt` na raiz do drive, não relativo ao NVM_HOME).

## Próximos passos sugeridos (em ordem de prioridade)

1. **Recomendado: corrigir a incompatibilidade de versão do Expo em vez de downgrade de Node.**
   Atualizar `package.json` para `"expo": "~56.0.0"` e rodar `npm install` (ou `npx expo install --fix`). Isso deve trazer uma versão mais nova do `metro` compatível com Node 22, eliminando a necessidade de instalar Node 20. Ler antes a doc obrigatória do AGENTS.md: https://docs.expo.dev/versions/v56.0.0/
2. Se a opção 1 não resolver, retomar o debug do nvm-windows (reinstalar, ou tentar a versão portátil/zip em vez do instalador winget, ou usar `fnm` como alternativa ao nvm-windows).
3. Depois que `npx expo start` funcionar, abrir o QR code com o app Expo Go no celular (mesma rede Wi-Fi) para testar.
4. Considerar dar `git push` dos 10 commits locais para `origin/main` (ainda não foi pedido pelo usuário — perguntar antes).

## Arquivos-chave para retomar contexto

- `docs/superpowers/plans/2026-06-15-gas-manager-gaps.md` — plano completo das 9 tarefas já implementadas
- `package.json` — ponto de partida do bloqueio atual
- `store/index.ts` — padrão de invalidação de cache (version counters) usado em todas as telas
