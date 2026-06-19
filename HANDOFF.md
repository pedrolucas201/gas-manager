# Handoff: sub-projeto #3 (sync mobile) — VALIDADO (v0.6.0)

**Data:** 2026-06-19 (sessão 4)
**Status:** todas as pendências resolvidas. Backend testado, APK gerado, branch mergeada. **Falta apenas: teste manual em 2 celulares.**

## 1. O que foi feito nesta sessão

- ✅ `voidSale` na tela de vendas (fix `app/(tabs)/sales.tsx`)
- ✅ Testes backend com Docker — `internal/sync`, `internal/catalog`, `internal/pgconv` todos verdes
  - Fix: `testutil_test.go` do pacote sync faltava a migration `0005_catalog_events`
- ✅ APK v0.6.0 gerado via EAS Build
- ✅ Merge `feat/backend` → `main` (commit `9662e32`)

## 2. APK

**Link de instalação:**
```
https://expo.dev/accounts/pedrogomesdev/projects/gas-manager/builds/1e141942-479d-4fb3-8825-570473b11d91
```

## 3. O que AINDA FALTA

1. **Teste manual em 2 celulares** (único item pendente):
   - Login em 2 contas diferentes
   - Venda no A → aparece no B após sync
   - Cancelar no A → refletido no B
   - Offline no A, 3 vendas, reconectar → sobe tudo

2. **Trocar senhas dos 3 usuários Firebase** (decidido manter `123456` por ora)

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
- Testes backend: rodar um pacote por vez (ryuk reaper conflita ao rodar sync+catalog em paralelo)
  ```powershell
  cd backend
  go test ./internal/sync/ -count=1 -v
  go test ./internal/catalog/ -count=1 -v
  ```
- Health externo é `/readyz` (nunca `/healthz`)
- `settleCustomerDebt` aceita `paymentMethod` como 3º parâmetro opcional (default `"pix"`)

## 6. Comandos rápidos

```powershell
# Testes mobile
npm test

# Testes backend (um pacote por vez — ryuk conflita em paralelo)
cd backend
go test ./internal/sync/ -count=1 -v
go test ./internal/catalog/ -count=1 -v
go test ./internal/pgconv/ -count=1

# Deploy backend
gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet

# Build APK
npx eas-cli build -p android --profile preview --non-interactive
```
