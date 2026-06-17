# Handoff: Backend gas-manager DEPLOYADO em produção (Cloud Run + Supabase)

**Data:** 2026-06-17
**Status:** concluído (sub-projeto #2 — backend) — em produção e verificado. Próximo: sub-projeto #3 (integração mobile + Firebase Auth), em outra sessão.

## 1. Objetivo
Concluir e **fazer o deploy** do backend na nuvem do gas-manager (sub-projeto #2 de 4): API Go + Postgres, para destravar multi-dispositivo (3 funcionários), proteção contra perda de dados e acesso web/PC. Nesta sessão: fechar o bootstrap, decidir/provisionar a infra de banco e nuvem, e subir o serviço.

## 2. Contexto essencial
- **Stack backend:** Go 1.25, chi, pgx v5, sqlc, golang-migrate, Firebase Admin SDK (auth), testcontainers-go. Módulo `github.com/pedrogomesdev/gas-manager-backend`, código em `backend/`.
- **Arquitetura (ledger pattern):** tabelas de fato append-only (`sales`, `restocks`, `stock_adjustments`, `debt_settlements`) com UUID do cliente + agregados mutáveis (`inventory.full_qty/empty_qty`, `customers.balance`) por incremento atômico na mesma tx. Pull paginado por `BIGSERIAL sequence`. `payload_hash` contra colisão de UUID. Auth Firebase com janela de carência 14d.
- **Decisões de infra fechadas nesta sessão (debate TL + QA via subagentes):**
  - **Banco = Supabase Postgres (free)**, NÃO Cloud SQL (~US$8-10/mês, descartado — usuário não paga). NÃO Neon (usuário não quis). NÃO Firestore/RTDB (reescreveria o backend, ruim p/ relatórios, riscos de integridade no hot-doc/cursor). Combo final: **Firebase Auth (login) + Firebase FCM (tempo real futuro) + Supabase (Postgres) + Cloud Run (Go)** — zero reescrita.
  - **Tempo real "ver venda do colega"** = futuro, via **FCM** (sub-projeto #3); Postgres continua fonte de verdade.
- **Convenção de commit:** PT, sem `Co-Authored-By` e sem menção ao Claude.
- **Regra do usuário (importante):** "sempre teste tudo e debata com TL + QA" — toda tarefa de código: rodar `go test ./...` (com Docker p/ testcontainers) + revisar o diff com 2 subagentes (TL + QA) antes de fechar.

## 3. O que já foi feito (nesta sessão, branch `feat/backend`)
1. **Bootstrap** (commit `26f227a`): migration `0003_seed_p13` (seed P13 + linha de inventory, idempotente) + `DBUserLoader` que auto-provisiona UID Firebase desconhecido como usuário ativo (sem RBAC) via query `EnsureUser` idempotente que não ressuscita desativado. Troca o `pgUserLoader` inline do `main.go` por `auth.NewDBUserLoader(pool)`.
2. **Cobertura de testes do bootstrap** (commit `48c8016`, vinda da revisão TL+QA): `migrations_test.go` (seed aplica / idempotente em re-run / down reverte) + `dbloader_test.go` (idempotência, não-ressurreição no próprio `ON CONFLICT`, concorrência com 8 goroutines → 1 linha).
3. **Provisionamento da infra:**
   - **Supabase** (projeto `gas-manager`, ref `aealxmiyotyeoutlqljy`, região São Paulo). Migrations 0001→0003 aplicadas via `psql` (o `migrate` CLI quebra com path no Windows). `schema_migrations` criado manualmente na v3. Seed P13 verificado. Data API REST do Supabase desligada.
   - **GCP `gas-manager-499616`:** billing vinculado (account `01A494-ADB080-78A0CB`; desvinculei 2 projetos de teste `centered-center-441514-v3` e `vibrant-tiger-441616-i5` p/ liberar cota — mantido `maps-route-495614`). APIs habilitadas: run, cloudbuild, artifactregistry, secretmanager, billingbudgets. Secret `DATABASE_URL` criado, acesso dado à SA `750551393506-compute@`.
4. **Deploy** no Cloud Run (`gcloud run deploy gas-backend --source backend ...`). Smoke test revelou que o **Google Frontend engole `/healthz`** → adicionei **`/readyz`** (commit `1516b0d`) com `pool.Ping`, testes (200/503/público/deadline), redeploy. `/readyz` live = **200** → conexão Cloud Run→Supabase **verificada**.
5. **Alerta de orçamento** GCP criado (R$5, avisos em R$1/2,50/4,50/5) escopado ao projeto.

## 4. Estado atual
- **Serviço no ar:** `https://gas-backend-750551393506.southamerica-east1.run.app` (revisão `gas-backend-00002-qhx`), região `southamerica-east1`, `--allow-unauthenticated`, min=0/max=4, `FIREBASE_PROJECT_ID=gas-manager-499616`.
- **Verificado:** `listening on :8080`; `/readyz` → 200 (DB OK); `/sync/pull` sem token → 401 (auth OK); rotas desconhecidas → 404 do chi. Suíte inteira verde (`go test ./...`, Docker ligado).
- **Banco:** Supabase Postgres com 10 tabelas + seed P13. Conexão do Cloud Run = **Session pooler IPv4 grátis porta 5432** (`postgres.aealxmiyotyeoutlqljy@aws-1-sa-east-1.pooler.supabase.com:5432`, `sslmode=require`). **NÃO usar Transaction pooler 6543** (IPv6/add-on pago).
- **Working tree limpo**, 3 commits novos da sessão em `feat/backend` (ainda não mergeado na main).
- **O app mobile NÃO fala com o backend ainda** (segue 100% local). Firebase Auth ainda não existe. Logo, multi-dispositivo/nuvem/web ainda NÃO funcionam para o usuário final.

## 5. Próximos passos (ordenados — sub-projeto #3)
1. **Configurar Firebase Auth** no projeto `gas-manager-499616` (habilitar método de login; o app Firebase ainda não existe).
2. **Integrar o app Expo ao backend** (sub-projeto #3): fila offline + push/pull contra os endpoints + tela de login Firebase. É a peça que falta para o usuário final.
3. **Gerar novo APK** (EAS) com a integração.
4. **Testar fluxo real:** venda no celular A aparecendo no B.
5. Depois: **FCM** (tempo real), e sub-projetos #4 (painel web) e #1 (página de APKs).
6. Higiene: rate-limit no `/readyz` (TL sugeriu, opcional), merge `feat/backend`→`main`.

## 6. Perguntas em aberto
- **Não liberar o app para o pessoal ainda:** se cada celular acumular dado local antes do sync, vira problema de merge de 3 bancos. (incerto se algum funcionário já usa — usuário disse que não está em produção.)
- Qual método de login Firebase usar (email/senha? Google?) — decidir no início do #3.
- `migrate` CLI não funciona com path absoluto no Windows; para migrations futuras no Supabase, usar `psql -d <url> -f arquivo.sql` (e manter `schema_migrations` coerente) ou rodar `migrate` de dentro da pasta de migrations.

## 7. Artefatos relevantes
- **Serviço:** `https://gas-backend-750551393506.southamerica-east1.run.app` (health externo = `/readyz`).
- **Commits da sessão:** `26f227a`, `48c8016`, `1516b0d` (branch `feat/backend`).
- **Código novo:** `backend/cmd/server/main.go` (+`/readyz`, `newRouter` recebe `ready func(ctx) error`), `backend/cmd/server/main_test.go`, `backend/internal/auth/dbloader{,_test}.go`, `backend/internal/auth/testutil_test.go`, `backend/internal/db/migrations/0003_seed_p13.{up,down}.sql`, `backend/internal/db/migrations_test.go`, `backend/internal/db/queries/users.sql` (+`EnsureUser`).
- **Comandos-chave:**
  - Migrations Supabase: `psql -d "postgres://postgres.aealxmiyotyeoutlqljy:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require" -v ON_ERROR_STOP=1 -f <arquivo>.up.sql`
  - Deploy: `gcloud run deploy gas-backend --source "C:/Users/PC/Documents/gas-manager/backend" --region southamerica-east1 --project gas-manager-499616 --quiet`
  - Logs: `gcloud run services logs read gas-backend --region southamerica-east1 --project gas-manager-499616 --limit 20`
- **Secrets/credenciais (NÃO versionar):** senha do DB Supabase está no secret `DATABASE_URL` do GCP (e foi compartilhada no chat — usuário pode rotacionar via "Reset password" no Supabase + atualizar o secret se quiser).

## 8. Instruções pra próxima sessão
- Rodar `/iniciar`; ler este HANDOFF + a memória `project_backend_design` (decisões de infra fechadas — não re-perguntar).
- **Backend está pronto e em produção — não re-fazer.** A sessão #3 é sobre o **app mobile** (Expo SDK 54): ler os docs versionados do Expo antes de codar (AGENTS.md).
- Armadilha: health check externo é `/readyz`, nunca `/healthz` (Google Frontend engole). Banco só conecta pela Session pooler IPv4 (5432).
- Manter a regra do usuário: testar tudo + revisão TL/QA via subagentes em cada tarefa de código.
- Melhor primeiro passo do #3: decidir o método de login Firebase e habilitar o Firebase Auth no projeto, depois a tela de login no app.
