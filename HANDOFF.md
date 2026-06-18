# Handoff: sub-projeto #3 (sync mobile) — Fase 3 concluída + Gap 1 do /sync/pull fechado

**Data:** 2026-06-18 (sessão 2)
**Status:** em andamento. Fases 0–3 prontas e revisadas. O lado de pull do backend tem 3 gaps (descobertos nesta sessão); **Gap 1 fechado**, faltam Gap 2 e Gap 3 antes de ligar o SyncEngine (Fase 4). Execução dividida em sessões a pedido do usuário.

## 1. Objetivo
Tornar o app multi-dispositivo para os 3 funcionários: login Firebase (e-mail/senha, sessão persistente) + sync offline-first (push/pull) contra o backend Go já no ar. Plano completo: `docs/superpowers/plans/2026-06-17-mobile-sync-integration.md` (Fases 0–7).

## 2. Contexto essencial
- **App:** Expo **SDK 54** (RN 0.81), expo-sqlite, zustand, NativeWind. `firebase@12.15.0` + `@react-native-async-storage/async-storage@2.2.0`. Testes: jest 29 + ts-jest + better-sqlite3 (harness Node).
- **Backend (no ar):** Go 1.25 + chi + pgx + sqlc, Cloud Run `gas-backend` (`southamerica-east1`, projeto GCP `gas-manager-499616`), Supabase Postgres. Padrão **ledger** (fatos append-only + agregados por incremento). URL: `https://gas-backend-750551393506.southamerica-east1.run.app`. Pull paginado por cursor `sequence` (base64).
- **Ambiente desta máquina:** Go 1.25.5, Docker 27.3.1, gcloud presentes → backend testa (testcontainers) e deploya daqui. `git` só via PowerShell (no Bash tool dá "command not found").
- **Convenções de dinheiro/sinal:**
  - Dinheiro trafega como **string** decimal (DTOs Go e app).
  - **Saldo:** servidor (Postgres) usa **positivo = dívida**; app (SQLite) usa **negativo = dívida**. `apply.ts` traduz: fiado→`balance-total`, quitação→`balance+amount`, void→`balance+total`.
- **Regras do usuário (MANDATÓRIO):** commits em PT **sem menção ao Claude/IA**; testar tudo + revisão TL/QA por subagentes a cada task; executar planos via subagent-driven-development. `AGENTS.md` está **desatualizado** (manda docs Expo v56; o projeto é SDK 54 — seguir v54).

## 3. O que já foi feito (nesta sessão, branch `feat/backend`)

### Fase 3 — Firebase + auth + cliente HTTP (CONCLUÍDA, revisada TL/QA)
- `f76bcb9`,`a07cfa7`,`27ea632` — `lib/firebase.ts` (app + `auth` singleton com persistência **AsyncStorage**, guard de env var, guard de Fast Refresh) + `lib/auth.ts` (signIn/signOutUser/onAuthChange/getIdToken, erros em PT).
- `50c38c4`,`36a4f92` — `lib/api.ts` (`request()` com bearer + classes `AuthError`/`NetworkError`/`ApiError` + 6 funções: pushEvents, pullPage, upsertCustomer, deleteCustomer, upsertCylinderType, voidSale; dinheiro string; parse seguro do body).
- `a6315c8` — `lib/sync/apply.ts` (**PROVISÓRIO** — ver §4/§6) + 30 testes.
- Validado: `npm test` 37/37 verde antes do apply.ts; `npx tsc --noEmit` só com os 6 erros pré-existentes em `components/`.

### Fase 4 — Gap 1 do /sync/pull (CONCLUÍDO, revisado TL/QA; SEM redeploy)
Ao ligar o `apply.ts` (1º consumidor real do pull) descobri que o pull nunca foi exercido por cliente. 3 gaps confirmados na fonte (memória `project_pull_gaps`):
- **Gap 1 — formato do wire** ✅ FECHADO. `pull.go` serializava struct cru do sqlc → PascalCase + `pgtype.Numeric`. Corrigido com DTO limpo (snake_case, dinheiro string, uuid string, RFC3339, nuláveis→null) para as 4 streams de ledger.
  - `bb2ec57` — `backend/internal/sync/pull_dto.go` (DTOs + mappers) + wiring no `pull.go`.
  - `3ffea39` — unifica conversores no `pgconv` (deleguei `uuidToWire`/`numericToWire`) + guard NaN/Inf + testes exatos de string.
  - Validado por mim: `go build`/`go vet` limpos; `go test ./internal/sync/ ./internal/pgconv/` **verde** (~40s, testcontainers). Revisão spec ✅ + qualidade ✅. (O code review apontou um "bug de padding" no `pgconv.UUIDToString` que **não existe** — `%x` sobre `[]byte` já zero-padeia cada byte; locked com teste.)
- **Gap 2 — void não propaga** ⏳ PENDENTE (decidido). `VoidSale` não muda `sequence` → cancelamento nunca chega nos outros aparelhos; não há kind `void_sale` no pull. **Decisão:** void = fato append-only com sequence própria, kind `void_sale`.
- **Gap 3 — catálogo sem pull** ⏳ PENDENTE (decidido). Não há `PullCustomers`/`PullCylinderTypes` → clientes/preços não descem. **Decisão:** pull de catálogo completo (change-feed customers + cylinder_types + tombstone de delete), emitindo `customer_upsert`/`customer_delete`/`cylinder_upsert`.

## 4. Estado atual
- Branch `feat/backend`, **8 commits novos** desde `v0.4.0` (`f76bcb9`→`3ffea39`). Tag desta sessão: **v0.5.0**. NÃO mergeado na main.
- Backend: pull das 4 streams de ledger agora emite contrato limpo, **mas ainda não foi feito redeploy** (combinado: deploy só quando os 3 gaps estiverem prontos).
- App: camadas firebase/auth/api prontas e testadas; `apply.ts` existe mas é **provisório/bloqueado** (escrito para o contrato pretendido; depende dos eventos que Gap 2/3 vão passar a emitir).
- Validado: ver §3. `npx tsc --noEmit` nos arquivos novos sem erros novos.

## 5. Próximos passos (ordem)
1. **Gap 2 (backend):** migration (tabela/feed append-only de void com `sequence`) + insert no `VoidSale` (mesma tx) + `PullSaleVoids` + campo `Void` no `Cursor` + DTO + wiring no `pull.go` + testes. Kind emitido: `void_sale` com `data={id: <sale_uuid>}`.
2. **Gap 3 (backend):** migration com `sequence` monotônico (trigger) em `customers`+`cylinder_types` + soft-delete/tombstone em `customers`; `PullCustomers`/`PullCylinderTypes`; campos `Customer`/`Cylinder` no `Cursor`; DTOs; ajustar `DeleteCustomer` (soft-delete) e os GETs de catálogo (filtrar deletados); testes.
3. **B4 (backend):** `go test ./...` (Docker) + **redeploy** (`gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet`) + verificar `/readyz` 200 e shapes do pull.
4. **Sessão B (mobile):** schema v3 (`applied_events` p/ dedupe de kinds sem tabela-fato + coluna `cylinder_types.updated_at` p/ LWW) + **reescrever `apply.ts`** no contrato final (remover overload de `sync_outbox`) + Tasks 4.2 (push loop + `store/sync.ts`) / 4.3 (pull loop cursor durável) / 4.4 (orquestração + netinfo).
5. **Sessão C:** Fase 5 (ligar mutações locais ao outbox) + Fase 6 (login UI + gate + SyncBadge).
6. **Sessão D:** Fase 7 (APK EAS + teste 2 celulares contra produção).

## 6. Perguntas em aberto / itens deferidos
- `apply.ts` (`a6315c8`) tem 2 smells a resolver na Sessão B: (a) usa `sync_outbox` (fila de saída) como registro de dedupe de `stock_adjustment`/`debt_settlement` e como âncora LWW de `cylinder_upsert` → substituir por `applied_events` + `cylinder_types.updated_at`; (b) realinhar shapes de `void_sale`/catálogo ao DTO final do backend (Gap 2/3).
- Decisão de mecanismo de cursor monotônico do catálogo (trigger de `sequence` vs `updated_at`+id) — recomendado `sequence` por trigger, mas a decidir na implementação do Gap 3.
- Trocar as senhas `123456` das 3 contas Firebase antes de distribuir.
- Higiene: merge `feat/backend`→`main` quando o #3 estiver utilizável.

## 7. Artefatos relevantes
- **Backend novo:** `backend/internal/sync/pull_dto.go` (+ `pull_dto_test.go`, `pull_dto_sample_test.go`), `backend/internal/sync/pull.go` (wiring), `backend/internal/pgconv/pgconv.go` (guard NaN/Inf + teste de UUID).
- **App novo (Fase 3):** `lib/firebase.ts`, `lib/auth.ts`, `lib/api.ts` (+ `lib/__tests__/api.test.ts`), `lib/sync/apply.ts` (provisório, + `lib/sync/__tests__/apply.test.ts`). `tsconfig.json` ganhou `paths` para `firebase/auth`→RN types.
- **Comandos-chave:** backend `cd backend; go test ./internal/sync/ ./internal/pgconv/ -count=1` (Docker on); app `npm test` / `npx tsc --noEmit`. Deploy: ver §5 passo 3.
- **Plano:** `docs/superpowers/plans/2026-06-17-mobile-sync-integration.md`. **Memória:** `project_pull_gaps`, `project_firebase_auth`, `project_backend_design`, `feedback_*`.

## 8. Instruções pra próxima sessão
- Rodar `/iniciar`; ler este HANDOFF + memória `project_pull_gaps` + o plano.
- **Não re-investigar os gaps nem re-fazer Fase 3/Gap 1** — estão prontos e verificados. Começar direto no **Gap 2** (backend, TDD), seguindo subagent-driven + revisão TL/QA; commits PT sem menção ao Claude.
- **Armadilhas:** health externo é `/readyz` (nunca `/healthz`); UUID malformado → 404; Supabase só via Session pooler IPv4 5432; `import type` nos arquivos da camada de dados (import runtime do expo-sqlite quebra o harness Node); migração v2 do app roda dentro de `withTransactionAsync`; no Firebase RN, `getAuth()` NÃO lança se Auth não foi inicializado (usar `initializeAuth` primeiro); testes do backend usam testcontainers (~40s/rodada — paciência); `git` só via PowerShell nesta máquina; `internal/auth` e `internal/db` têm falhas de infra pré-existentes no Docker rootless do Windows (ignorar).
- **Melhor primeiro passo:** desenhar a migration do feed append-only de void (Gap 2) e a query `PullSaleVoids`, depois ligar no `Cursor` e no `pull.go`.
