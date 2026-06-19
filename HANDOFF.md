# Handoff: sub-projeto #3 (sync mobile) — CONCLUÍDO (v0.6.0)

**Data:** 2026-06-19 (sessão 3)
**Status:** implementação completa. Backend deployado (v4 no Cloud Run). Mobile com SyncEngine, outbox e login. **Falta: testes backend com Docker + eas build + teste 2 celulares + trocar senhas Firebase.**

## 1. Objetivo
Tornar o app multi-dispositivo para os 3 funcionários: login Firebase (e-mail/senha, sessão persistente) + sync offline-first (push/pull) contra o backend Go. **Implementação concluída nesta sessão.**

## 2. Estado atual

### Backend (Cloud Run `gas-backend-00004-glp`, `southamerica-east1`)
- **Gap 1** ✅ DTO snake_case + dinheiro string no pull (sessão anterior)
- **Gap 2** ✅ `sale_voids` table + `void_sale` no pull stream (migration 0004)
- **Gap 3** ✅ `catalog_events` table + `customer_upsert`/`customer_delete`/`cylinder_upsert` no pull stream (migration 0005)
- URL: `https://gas-backend-750551393506.southamerica-east1.run.app`
- `/readyz` → 200 confirmado após deploy desta sessão

### Mobile (branch `feat/backend`, tag `v0.6.0`)
- **Schema v3** ✅ `applied_events` table (dedupe) + `cylinder_types.updated_at` (LWW)
- **apply.ts** ✅ fix dos smells (usa `applied_events` e `cylinder_types.updated_at` no lugar de `sync_outbox`)
- **SyncEngine** ✅ push loop (facts em batch, catalog/void individual, backoff, re-auth) + pull loop (cursor durável, duas passadas por página para evitar forward-reference)
- **Outbox wiring** ✅ todas as mutações locais geram eventos: sales, restocks, inventory, cylinder price, customers, debt settlement
- **`deleteSale` → `voidSale`** ✅ sem delete físico; listas filtram `voided_at IS NULL`
- **Login screen + auth gate** ✅ `app/login.tsx` + gate em `_layout.tsx` (Firebase Auth → engine start/stop)
- **SyncBadge + logout** ✅ header com status de sync e botão "Sair"
- **Testes**: 102/102 verde (`npm test`)
- **TypeScript**: só os 6 erros pré-existentes em `components/`

## 3. O que FALTA para uso em produção

1. **Testes do backend com Docker** (testcontainers — precisa Docker Desktop rodando):
   ```powershell
   cd backend
   go test ./internal/sync/ ./internal/catalog/ ./internal/pgconv/ -count=1 -v
   ```
   O código compilou limpo; os testes de Gap 2/3 foram escritos mas não rodaram com Docker nesta sessão.

2. **`eas build` para gerar o APK v0.6.0**:
   ```
   ! npx eas build -p android --profile preview
   ```

3. **Teste manual em 2 celulares** contra produção (Cloud Run):
   - Login em 2 contas diferentes
   - Venda no A → aparece no B após sync
   - Cancelar no A → refletido no B
   - Offline no A, 3 vendas, reconectar → sobe tudo

4. **Trocar senhas dos 3 usuários Firebase** (estão com `123456`) antes de distribuir.

5. **Merge `feat/backend` → `main`** quando validado.

## 4. Arquitetura final do sync

```
Outbox (sync_outbox) → pushOnce() → backend
                                         ↓
pull cursor (sync_state.pull_cursor) → pullAll() → applyEvent() → SQLite local
```

- Push: facts em batch (`POST /sync/push`), catalog/void individual por endpoint
- Pull: cursor por stream (sale/restock/adjust/settle/void/catalog), 2 passadas por página
- Dedupe: `INSERT OR IGNORE` por uuid (sales/restocks) ou `applied_events` (outros)
- LWW: `customer_upsert` via `updated_at`, `cylinder_upsert` via `cylinder_types.updated_at`
- Auth gate: Firebase persistente via AsyncStorage; `engine.start()` no login, `engine.stop()` no logout

## 5. Armadilhas conhecidas

- `git` só via PowerShell nesta máquina
- Testes do backend usam testcontainers (~40s/run, Docker Desktop deve estar rodando)
- `internal/auth` e `internal/db` têm falhas de infra pré-existentes no Docker rootless do Windows (ignorar)
- Health externo é `/readyz` (nunca `/healthz`)
- Expo Router tipo de `/login` só aparece depois do `eas build` ou dev server rodar — cast `as any` usado nos router.replace
- `settleCustomerDebt` aceita `paymentMethod` como 3º parâmetro opcional (default `"pix"`)

## 6. Comandos rápidos

```powershell
# Testes mobile
npm test

# Testes backend (com Docker)
cd backend; go test ./internal/sync/ ./internal/catalog/ -count=1 -v

# Deploy backend
gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet

# Build APK
npx eas build -p android --profile preview
```
