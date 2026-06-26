# Handoff: sessão 12 — proteção contra cancelamento em massa

**Data:** 2026-06-26
**Status:** implementação concluída e testada (147 testes mobile + backend verde). **Falta: aplicar migration 0008 em produção + deploy do backend + APK.** Branch `feat/protecao-cancelamento-massa` (NÃO mergeado ainda).

## 1. O que motivou a sessão
O dono notou que vendas/estoque "sumiram" no app e no web. **Diagnóstico:** não houve perda de dados — houve **anulação em massa**. 16 eventos `void_sale` ficaram presos no outbox de um aparelho (sync travado) e drenaram todos de uma vez em 26/06 22:08, anulando quase todas as vendas no servidor (28 vendas, 0 ativas; `sale_voids` com 28 linhas). Confirmado via Postgres + logs do Cloud Run. **Decisão do dono:** NÃO desanular os dados antigos; em vez disso, blindar para nunca mais acontecer.

## 2. O que foi implementado (2 features)

### #1 Disjuntor no push (cliente)
- `lib/sync/engine.ts`: antes de enviar o lote de `void_sale`, se houver `>= VOID_CONFIRM_THRESHOLD` (3, em `lib/sync/constants.ts`) e o lote não tiver sido aprovado, **pausa** e seta `voidConfirmNeeded` no `store/sync.ts`. Catálogo e fatos continuam fluindo; voids/unvoids ficam represados. `approveVoidBatch()` (também export estático) libera o lote. Aprovação é **one-shot** (reseta após enviar; reiniciar o app re-pede).
- UI: banner no `app/_layout.tsx` (AuthGate) quando `voidConfirmNeeded > 0` → abre `app/pending-voids.tsx` (tela de revisão). "Manter venda" = `discardPendingVoid` (descarta o void pendente e restaura a venda localmente, sem gerar evento, pois o servidor nunca soube). "Enviar N cancelamentos" = `approveVoidBatch`.

### #3 Cancelamento reversível (un-void)
- Novo evento `unvoid_sale`. Backend: `POST /sync/unvoid-sale` (`backend/internal/sync/unvoid.go`) limpa `voided_at`/`voided_by`, **re-aplica** estoque/saldo (espelho de `applySale`) e grava em `sale_voids` com `kind='unvoid'`.
- **Decisão de arquitetura (após revisão TL/QA):** void e unvoid compartilham o stream `sale_voids` (coluna `kind`, migration **0008_sale_void_kind**), com **sequência única (BIGSERIAL)** → ordem causal garantida na convergência entre devices. (A 1ª versão usava `catalog_events`, mas isso quebrava o avanço do cursor e não garantia ordem void-vs-unvoid — descartado.)
- `backend/internal/sync/pull.go`: emite kind `void_sale`/`unvoid_sale` conforme `sale_voids.kind`; cursor `Void` avança para ambos.
- Mobile: `applyUnvoidSale` em `lib/sync/apply.ts` (idempotente por `voided_at`), `unvoidSale` local + `getVoidedSales`/`restoreSaleAggregates` em `db/queries/sales.ts`, envio individual em `engine.ts`, `unvoidSale` em `lib/api.ts`. Tela `app/voided-sales.tsx` (lista canceladas + "Restaurar") com atalho na aba de vendas.

## 3. PENDÊNCIAS CRÍTICAS antes de usar em produção
1. **Aplicar migration 0008 no Postgres de produção** (ANTES do deploy; é backward-compatible — `ALTER TABLE sale_voids ADD COLUMN kind TEXT NOT NULL DEFAULT 'void'`, o backend antigo continua funcionando):
   ```sql
   ALTER TABLE sale_voids ADD COLUMN kind TEXT NOT NULL DEFAULT 'void'
     CHECK (kind IN ('void','unvoid'));
   ```
2. **Deploy do backend** (skill `backend` ou):
   ```powershell
   gcloud run deploy gas-backend --source ./backend --region southamerica-east1 --project gas-manager-499616 --update-env-vars FIREBASE_PROJECT_ID=gas-manager-499616
   ```
3. **Merge do branch** `feat/protecao-cancelamento-massa` → `main`.
4. **Gerar APK** (limite EAS reseta 01/07, ou build local Linux — ver sessão 11).

## 4. Estado dos testes
- **Mobile: 147 testes passando** (`npx jest --no-coverage`).
- **Backend: verde** (`go test ./...` — atenção: testcontainers/Docker pode dar flake `unexpected EOF` em paralelo sob carga; re-rodar o pacote isolado confirma). Os testes do pacote `sync`, `catalog` e `reports` passam.
- Plano completo: `docs/superpowers/plans/2026-06-26-protecao-cancelamento-em-massa.md`.

## 5. Notas / limitações conhecidas
- **Propagação do un-void:** um device que já tinha a venda anulada localmente reverte no próximo pull (evento `unvoid_sale`). Reinstalação (cursor 0) recebe void+unvoid em ordem e converge para o estado final correto.
- **Disjuntor não persiste** entre reinícios do app (em memória) — proposital (mais seguro).
- **#2 (limite server-side)** ficou de fora — complemento de defesa-em-profundidade para uma sessão futura.

## 6. Contexto herdado (sessões anteriores)
- Mobile Expo SDK 54 + SQLite + NativeWind, offline-first (`sync_outbox` → SyncEngine push/pull).
- Backend Go + Postgres (Supabase) em Cloud Run `gas-backend`. Migrations aplicadas **manualmente** (sem runner no startup). **Go só roda via PowerShell** neste ambiente. Deploy: SEMPRE `--update-env-vars`.
- Web: `web/` React+Vite, Firebase Hosting → https://gas-manager-499616.web.app.
- Conexão Supabase / segredo: `gcloud secrets versions access latest --secret=DATABASE_URL --project=gas-manager-499616`.
- Commits sem menção ao Claude. Suíte inteira + revisão TL/QA antes de fechar.
