# Handoff: sessão 6 — despesas com sync, APK v0.8.0 em build

**Data:** 2026-06-22
**Status:** concluído. APK em build.

## 1. Objetivo

Implementar despesas operacionais (gasolina, pneu, manutenção...) com sincronização entre todos os dispositivos.

## 2. Contexto essencial

- **Stack:** Expo SDK 54 + SQLite + NativeWind (mobile) / Go + Postgres Supabase (backend)
- **Backend:** Cloud Run `gas-backend`, região `southamerica-east1`, URL `https://gas-backend-750551393506.southamerica-east1.run.app`
- **Banco:** Supabase `aealxmiyotyeoutlqljy`, região `sa-east-1`, session pooler porta 5432
- **Auth:** Firebase Authentication, projeto `gas-manager-499616`
- **EAS:** conta `pedrogomesdev`, projeto `gas-manager`, perfil `preview` → APK

## 3. O que foi feito nesta sessão

### Sync periódico 60s (sessão 5, commit do início desta sessão)
- `lib/sync/engine.ts`: polling a cada 60s via `setInterval`

### Dark mode (sessão 5)
- NativeWind `darkMode: "media"`, tab bar via `useColorScheme`, todas as 13 telas

### Features urgentes (sessão 5)
- Modal de busca de cliente no formulário de venda
- Vales recebidos: tabela `debt_settlements`, seletor de pagamento, seção na aba Financeiro
- Aba "Financeiro" (era "Relatórios")
- Editar venda (void + re-registro)

### Despesas com sync (sessão 6)
**Backend:**
- Migration `0006_expenses.up.sql` criada e aplicada no Supabase
- Queries sqlc: `GetExpenseByID`, `InsertExpense`, `PullExpenses`
- `ExpensePayload` em `types.go`, `ExpenseDTO` em `pull_dto.go`
- push.go: `existingHash` + `applyEvent` para "expense"
- pull.go: `Cursor.Expense`, stream de expenses, avanço de cursor
- Deploy: revisão `gas-backend-00006-xxh` no Cloud Run

**Frontend:**
- Migration v5: tabela `expenses` no SQLite
- `db/queries/expenses.ts`: `addExpense`, `getExpenses`
- `store/index.ts`: `expensesVersion` + `bumpExpenses`
- `lib/sync/outbox.ts`: `OutboxKind` inclui "expense"
- `lib/sync/engine.ts`: "expense" em `FACT_KINDS`
- `lib/sync/apply.ts`: `applyExpense` para eventos pullados
- `app/add-expense.tsx`: formulário com categorias (Gasolina, Manutenção, Pneu, Outros)
- `app/(tabs)/reports.tsx`: seção "Despesas" + botão rápido no header

## 4. Estado atual

- **110 testes passando**
- **APK v0.8.0 em build** (EAS)
- Backend deployado com suporte a expenses
- Migration 0006 aplicada no Supabase de produção
- `main` sincronizado com `origin/main`
- Backend testes de Docker não rodaram nesta sessão (Docker Desktop estava desligado)

## 5. Próximos passos

1. **Instalar APK** quando o build terminar
2. **Trocar senhas** dos usuários Firebase (`pedro@gmail.com`, `maria@gmail.com`, `beto@gmail.com` — ainda `123456`)
3. **Testar despesas** em 2 celulares: registrar no A → aparece no B em até 60s
4. **Rodar testes backend** com Docker Desktop ativo: `cd backend && go test ./internal/sync/ -count=1 -timeout 120s`

## 6. Pendências técnicas

- Senhas Firebase ainda são `123456`
- Testes backend com Docker não validados (código compila, padrão idêntico ao debt_settlement)

## 7. Comandos de manutenção

```powershell
# Build APK
npx eas-cli build -p android --profile preview --non-interactive

# Testes mobile
npx jest --no-coverage

# Testes backend (Docker Desktop deve estar rodando)
cd backend
go test ./internal/sync/ -count=1 -timeout 120s

# Deploy backend
gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet

# Migration Supabase (nova)
[System.Environment]::SetEnvironmentVariable('PGPASSWORD', '<senha>', 'Process'); psql -h aws-1-sa-east-1.pooler.supabase.com -p 5432 -U "postgres.aealxmiyotyeoutlqljy" -d postgres -f "backend/internal/db/migrations/XXXX.up.sql"

# Buscar senha do banco
gcloud secrets versions access latest --secret="DATABASE_URL" --project="gas-manager-499616"
```

## 8. Arquivos criados/modificados nesta sessão

**Novos:**
- `backend/internal/db/migrations/0006_expenses.up.sql`
- `backend/internal/db/migrations/0006_expenses.down.sql`
- `backend/internal/sync/expense_test.go`
- `db/queries/expenses.ts`
- `db/__tests__/expenses.test.ts`
- `app/add-expense.tsx`
- `docs/superpowers/plans/2026-06-22-despesas.md`

**Modificados:**
- `backend/internal/db/queries/events.sql`
- `backend/internal/db/gen/events.sql.go` (sqlc)
- `backend/internal/sync/types.go`
- `backend/internal/sync/pull_dto.go`
- `backend/internal/sync/push.go`
- `backend/internal/sync/pull.go`
- `backend/internal/sync/testutil_test.go`
- `lib/api.ts`
- `types/index.ts`
- `db/database.ts`
- `db/__tests__/migration.test.ts`
- `store/index.ts`
- `lib/sync/outbox.ts`
- `lib/sync/engine.ts`
- `lib/sync/apply.ts`
- `lib/sync/__tests__/apply.test.ts`
- `app/(tabs)/reports.tsx`
