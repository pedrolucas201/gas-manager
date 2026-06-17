# Handoff: Implementação do backend gas-manager (em andamento)

**Data:** 2026-06-17
**Status:** em andamento — Phases 0–9.1 concluídas. Próximas: Tasks 8.2/8.3 (Opus) → Task 9.2 (com usuário no GCP).

## 1. Objetivo
Construir o backend na nuvem do gas-manager (sub-projeto #2 de 4): API Go + Postgres no Cloud Run (projeto GCP `gas-manager-499616`) com sync offline-first, pra permitir multi-dispositivo (3 funcionários), proteção contra perda de dados e acesso web/PC.

## 2. Contexto essencial
- **Stack do backend:** Go 1.25, chi (router), pgx v5, sqlc (queries type-safe), golang-migrate, Firebase Admin SDK (auth), testcontainers-go (testes de integração). Módulo `github.com/pedrogomesdev/gas-manager-backend`, código em `backend/`.
- **Arquitetura (ledger pattern):** tabelas de fato append-only (`sales`, `restocks`, `stock_adjustments`, `debt_settlements`) com UUID gerado no cliente + agregados mutáveis (`inventory.full_qty`/`empty_qty`, `customers.balance`) atualizados por incremento atômico na mesma transação. Paginação do pull por `BIGSERIAL sequence` (não wall-clock). `payload_hash` guarda contra colisão de UUID. Auth Firebase com janela de carência de 14d.
- **Decisões fechadas relevantes:** `GET /sync/errors` = log server-side best-effort (tabela `sync_errors`, Task 7.2); alerta `over-limit-balance` adicionado; catálogo = CRUD last-write-wins por `updated_at`, fora do ledger.
- **Método de execução:** tasks verbatim implementadas inline (Sonnet); tasks autorais (push, pull, catálogo) com revisão — tudo feito diretamente no contexto principal.
- **Convenção de commit:** mensagens em PT, terminam com `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` ou `Opus 4.8` conforme modelo.

## 3. O que já foi feito (todos os commits em `feat/backend`)

| Commit | Task | Descrição |
|--------|------|-----------|
| `fb76371` | 0.1 | go mod + chi + pgx |
| `97b2559` | 0.2 | docker-compose Postgres |
| `189dc45` | 0.3 | config loader |
| `777927b` | 1.1 | schema inicial (8 tabelas) |
| `ce37f7f` | 2.1 | pgx pool + sqlc.yaml |
| `26a0e55` | 2.2 | events.sql + 16 métodos gen |
| `b10085d` | 3.1 | auth Firebase + janela 14d |
| `3c260c3` | 4.1 | DTOs sync + payload hash |
| `0f096b7` | 4.3 | adapters DTO→pgx |
| `55b6a94` | 4.4-prep | httpx JSON helper + auth.WithUserID |
| `3a55f84` | 6.1 | queries catálogo (LWW) |
| `8a6bb1b` | 7.1-prep | queries alertas |
| `e409658` | fix | sqlc types corretos (is_exchange bool, Field string) via named args |
| `5bd3701` | 4.2 | push idempotente + tx por evento + bump atômico |
| `e47accf` | 4.4 | endpoint POST /sync/push |
| `efff5bf` | 5.1 | GET /sync/pull stream unificado paginado |
| `4e0f275` | 5.2 | teste concorrência sem lost update |
| `adb6c27` | 6.2 | CRUD catálogo + delete transacional + pgconv |
| `23d7e27` | 7.1 | handlers de alertas (estoque negativo + saldo acima do limite) |
| `584dbbb` | 7.2 | log de erros de sync (sync_errors + GET /sync/errors) |
| `427cedc` | 8.1 | wiring main.go + GetUser query + verifier ADC |
| `aa80d11` | 9.1 | Dockerfile multi-stage (alpine builder + distroless runtime) |

## 4. Estado atual
- **Branch `feat/backend`**, working tree limpo (tudo commitado). 22 commits à frente da main.
- **Suíte inteira verde:** `cmd/server`, `alerts`, `auth`, `catalog`, `config`, `db`, `sync` — todos `ok`.
- **Funcionalidades completas:** handlers de alertas, sync_errors logging, wiring main.go, Dockerfile.
- **Nada quebrado.** Backend pronto para rodar, faltam apenas tools de migração (8.2/8.3) e deploy (9.2).
- **Pré-requisito:** Docker Desktop rodando para testes com testcontainers.

## 5. Próximos passos (ordenados)

1. **Tasks 8.2/8.3 — tools snapshot/reconciliação** — autorais, **usar Opus**.
   - **8.2 — snapshot:** script Go `backend/tools/snapshot/main.go` que lê o banco SQLite do app (`gas_manager.db`) e gera um JSON com eventos de "saldo inicial" pra importar no backend (um `restock` ou `stock_adjustment` por tipo de cilindro, um `customers` upsert por cliente com balance atual).
   - **8.3 — reconciliação:** script Go `backend/tools/reconcile/main.go` que compara totais do SQLite local vs. backend Postgres (contagens de vendas/reposições, somas de saldo de clientes, quantidades de estoque). Exige 100% match. Suporta `--dry-run` (só reporta diferenças, não altera nada).
   - Decisão de arquitetura da migração (do HANDOFF original): corte em 2 fases (snapshot + captura do delta criado localmente até cada celular trocar de versão).

2. **Task 9.2 — provisionar Cloud SQL + Cloud Run + deploy** — **PARAR e fazer COM O USUÁRIO**. Requer ações reais no GCP, custo e credenciais. NÃO executar via subagente.

## 6. Artefatos relevantes
- Spec: `docs/superpowers/specs/2026-06-16-backend-design.md`
- Plano: `docs/superpowers/plans/2026-06-16-backend-implementation.md`
- Código: `backend/` (go.mod, sqlc.yaml, docker-compose.yml, `internal/{config,auth,sync,catalog,catalog,alerts queries,pgconv,httpx,db}`)
- Comandos-chave: `docker compose up -d` · `migrate -path internal/db/migrations -database "postgres://gas:gas@localhost:5433/gas?sslmode=disable" up` · `sqlc generate` · `go test ./...`

## 7. Instruções pra próxima sessão
- Rodar `/iniciar` ou ler este HANDOFF + o plano (seção Phase 7 em diante).
- Não repetir design/spec — está tudo fechado.
- Garantir Docker Desktop rodando antes das tasks 7.1+ (testcontainers).
- Modelo: Sonnet pra 7.1→7.2→8.1→9.1; trocar pra Opus para 8.2/8.3.
- **Parar na Task 9.2** e envolver o usuário (ações no GCP).
