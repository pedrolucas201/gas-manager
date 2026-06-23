# Handoff: sessão 5 — features urgentes, dark mode, APK v0.7.0

**Data:** 2026-06-22
**Status:** concluído. APK em build.

## 1. Objetivo

Implementar features urgentes solicitadas pelo usuário:
1. Sync periódico (60s) para ver dados de outros usuários sem reiniciar o app
2. Dark mode automático (baseado no SO) em todas as telas
3. Busca de cliente no formulário de venda (substitui scroll horizontal)
4. Vales recebidos: log de quitações de fiado com forma de pagamento, visível na aba Financeiro
5. Aba "Relatórios" renomeada para "Financeiro"
6. Botão de editar venda (void + re-registro)

## 2. Contexto essencial

- **Stack:** Expo SDK 54 + SQLite + NativeWind (mobile) / Go + Postgres Supabase (backend)
- **Backend:** Cloud Run `gas-backend`, região `southamerica-east1`, URL `https://gas-backend-750551393506.southamerica-east1.run.app`
- **Banco:** Supabase `aealxmiyotyeoutlqljy`, região `sa-east-1`, session pooler porta 5432
- **Auth:** Firebase Authentication, projeto `gas-manager-499616`
- **EAS:** conta `pedrogomesdev`, projeto `gas-manager`, perfil `preview` → APK

## 3. O que foi feito

### Sync periódico
- `lib/sync/engine.ts`: `start()` agora chama `setInterval(() => syncNow(), 60_000)` e `stop()` faz `clearInterval`
- Guard `_syncing` já existia — chamadas sobrepostas são seguras

### Dark mode
- `tailwind.config.js`: `darkMode: "media"` adicionado
- `app/(tabs)/_layout.tsx`: tab bar e header usam `useColorScheme()` do react-native
- Todas as 13 telas (index, sales, customers, inventory, reports, sale-form, settle-debt, customer-form, customer-detail, login, restock-form) têm classes `dark:` aplicadas
- Header laranja permanece laranja em ambos os modos

### Busca de cliente no formulário de venda
- `app/sale-form.tsx`: campo de cliente substituído por botão que abre Modal com busca por nome/telefone + FlatList
- Incluso no commit do dark mode

### Vales recebidos
- **Migration v4** (`db/database.ts`): tabela `debt_settlements` (uuid, customer_id, customer_name, amount, payment_method, created_at)
- **`db/queries/settlements.ts`**: `getSettlements(db, from, to)` e `getSettlementsByCustomer`
- **`db/queries/customers.ts`**: `settleCustomerDebt` agora grava em `debt_settlements` + aceita `paymentMethod` (default: "pix")
- **`lib/sync/apply.ts`**: `applySettlement` também insere em `debt_settlements` ao receber evento pullado
- **`app/settle-debt.tsx`**: seletor de forma de pagamento (Dinheiro / PIX / Cartão)

### Aba Financeiro
- `app/(tabs)/_layout.tsx`: tab "Relatórios" → "Financeiro", ícone `wallet`
- `app/(tabs)/reports.tsx`: seção "Vales Recebidos" mostra total recebido + breakdown por método + lista de pagamentos do período. Recarrega ao mudar `customersVersion`

### Editar venda
- `db/queries/sales.ts`: nova função `getSaleById`
- `app/(tabs)/sales.tsx`: ícone de lápis em cada `SaleCard`
- `app/sale-edit.tsx`: formulário pré-preenchido com dados da venda original. Ao salvar: `voidSale(original)` + `registerSale(novos dados)`. Inclui modal de busca de cliente e dark mode

## 4. Estado atual

- 106 testes passando
- APK v0.7.0 em build (EAS)
- `main` está 65+ commits à frente de `origin/main` (push pendente)
- Backend **não foi alterado** nesta sessão

## 5. Próximos passos

1. **Confirmar APK funcionando** nos celulares
2. **Despesas com sync** (plano em `docs/superpowers/plans/2026-06-22-despesas.md` — ainda não escrito; requer backend Go: nova migration Postgres 0006, evento no push/pull)
3. **Push para origin/main** quando conveniente
4. **Trocar senhas** dos usuários Firebase (ainda `123456`)

## 6. Pendências técnicas

- Despesas com sync: precisa de backend (nova tabela + eventos push/pull) — plano não escrito ainda
- `origin/main` desatualizado (push pendente)
- Senhas Firebase dos usuários ainda são `123456`

## 7. Arquivos criados/modificados nesta sessão

**Novos:**
- `db/queries/settlements.ts`
- `app/sale-edit.tsx`
- `docs/superpowers/plans/2026-06-22-dark-mode.md`
- `docs/superpowers/plans/2026-06-22-features-urgentes.md`

**Modificados:**
- `tailwind.config.js`
- `lib/sync/engine.ts`
- `db/database.ts`
- `types/index.ts`
- `db/queries/customers.ts`
- `db/queries/sales.ts`
- `lib/sync/apply.ts`
- `app/(tabs)/_layout.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/sales.tsx`
- `app/(tabs)/customers.tsx`
- `app/(tabs)/inventory.tsx`
- `app/(tabs)/reports.tsx`
- `app/sale-form.tsx`
- `app/settle-debt.tsx`
- `app/customer-form.tsx`
- `app/customer-detail.tsx`
- `app/login.tsx`
- `app/restock-form.tsx`
- `db/__tests__/migration.test.ts`
- `db/__tests__/customers.sync.test.ts`
- `lib/sync/__tests__/apply.test.ts`

## 8. Comandos de manutenção

```powershell
# Build APK
npx eas-cli build -p android --profile preview --non-interactive

# Testes
npx jest --no-coverage

# Deploy backend (não foi alterado nesta sessão)
gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet

# Migrations Supabase (se necessário)
$env:PGPASSWORD = "..."; psql -h aws-1-sa-east-1.pooler.supabase.com -p 5432 -U postgres.aealxmiyotyeoutlqljy -d postgres -f backend/internal/db/migrations/XXXX.up.sql
```
