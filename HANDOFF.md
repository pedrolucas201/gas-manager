# Handoff: sessão 10 — sync reativo + compensação de eventos fantasmas

**Data:** 2026-06-24
**Status:** concluído. APK v0.12.1 gerado e disponível.

## 1. Objetivo
Tornar o sync do app 100% reativo (mudanças de qualquer celular refletem em todos em segundos), corrigir o pull-to-refresh que não funcionava, e implementar compensação automática de eventos fantasmas (evento rejeitado pelo servidor mas aplicado localmente).

## 2. Contexto essencial
- **Mobile:** Expo SDK 54 + SQLite + NativeWind. Offline-first: eventos em `sync_outbox` → `SyncEngine` push/pull.
- **Backend:** Go + Postgres (Supabase), Cloud Run `gas-backend`, `https://gas-backend-750551393506.southamerica-east1.run.app`. Revisão ativa: `gas-backend-00013-8qg` (não houve deploy de backend nesta sessão).
- **Web:** React+Vite+Tailwind+Recharts em `web/`, Firebase Hosting → **https://gas-manager-499616.web.app**.
- **Auth:** Firebase `gas-manager-499616`. **EAS:** `pedrogomesdev`/`gas-manager`, perfil `preview`.
- **Go só roda via PowerShell** neste ambiente (Bash não tem go no PATH).
- **Deploy Cloud Run:** SEMPRE `--update-env-vars` (NUNCA `--set-env-vars`).

## 3. O que foi feito

### Diagnóstico do banco (Supabase)
- Estoque estava em 37 cheios / 56 vazios no banco (o +23 de um `stock_adjustment` antigo que disparou com o novo sync).
- Corrigido diretamente via SQL: `UPDATE inventory SET full_qty=37, empty_qty=33, last_set_at=NOW()`.
- Inserido evento `stock_set` (seq 2, client_created_at=NOW()) direto em `stock_sets` para propagar correção via pull para os celulares.
- Removida entrada de restock de 26 unidades do dia 22/06 a pedido do dono: `DELETE FROM restocks WHERE id='40f999be-...'`. Não afetou estoque pois `stock_set` posterior é mais recente (LWW).
- 18 `stock_adjustments` (delta) antigos confirmados como resíduos — código atual já usa `stock_set` absoluto, não gera mais.

### Feat 1: sync reativo (commit `98ff070`)
**Problema:** poll de 60s + `syncNow()` retornava imediatamente se já estava rodando → pull-to-refresh não esperava o sync concluir.

**Fixes em `lib/sync/outbox.ts`:**
- Adicionado `setEnqueueHook(fn)`: hook que dispara `syncNow()` imediatamente após qualquer `enqueue()`.

**Fixes em `lib/sync/engine.ts`:**
- `_syncing: boolean` → `_syncPromise: Promise<void> | null`: quem chama `syncNow()` enquanto já está sincronizando recebe a mesma promise e aguarda o resultado real.
- Poll: 60s → **10s**.
- Retry em erro: 30s → **10s**.
- `start()`: registra `setEnqueueHook(() => this.syncNow())` → push imediato após qualquer evento.
- `stop()`: limpa o hook.
- Após `pullAll()`: chama `bumpSales()`, `bumpInventory()`, `bumpCustomers()`, `bumpExpenses()` → telas re-renderizam automaticamente sem precisar de pull-to-refresh.
- Importa `useAppStore` de `@/store`.

### Feat 2: compensação de eventos fantasmas (commit `1009352`)
**Problema:** quando o servidor rejeita um evento (`status:'error'`), o efeito local (venda inserida, saldo debitado, etc.) fica no SQLite — "fantasma". O evento no outbox fica com `status='error'`, `pendingCount=0`, app mostra "sincronizado" mas o dado local está errado.

**Novo arquivo `lib/sync/compensate.ts`:**
- `compensateError(db, event)`: switch por `event.kind`, desfaz o efeito local dentro de uma transação.
- `debt_settlement`: reverte `customers.balance -= amount`, deleta da tabela `debt_settlements`.
- `sale`: reverte inventory (+full, -empty), reverte balance fiado, soft-delete da venda (`voided_at`).
- `restock`: reverte `inventory.full_qty -= qty`, deleta da tabela `restocks`.
- `expense`: deleta da tabela `expenses`.
- `stock_adjustment`: aplica -delta no inventory, deleta da tabela `stock_adjustments`.
- Remove de `applied_events` para que um pull futuro possa re-aplicar a versão do servidor.
- Tipos sem compensação: `stock_set` (LWW do pull corrige), catálogo (LWW).

**Integração em `lib/sync/engine.ts` (`_pushFacts`):**
```ts
} else {
  await markError(this.db, r.id, r.error ?? "server_error");
  const failed = facts.find((e) => e.event_uuid === r.id);
  if (failed) {
    await compensateError(this.db, failed);
    bumpSales(); bumpInventory(); bumpCustomers(); bumpExpenses();
  }
}
```

### APKs gerados
- **v0.12.0** (só sync reativo): https://expo.dev/artifacts/eas/FczwVGkiZ1byq9l0wWk67jGQnUqdriTkY197m_ZftJk.apk
- **v0.12.1** (sync reativo + compensação): https://expo.dev/artifacts/eas/NhlGarKu1zLBPc2fr2PzWKnEm3SW0c02Ay_n7zrM54w.apk

## 4. Estado atual
- **125 testes mobile passando.** Backend Go não foi tocado.
- Sync reativo funcionando: mudanças chegam em <1s (push imediato) e outros celulares recebem em até 10s (poll).
- Pull-to-refresh: corrigido — agora espera o sync terminar antes de re-renderizar.
- Compensação: implementada para `sale`, `debt_settlement`, `restock`, `expense`, `stock_adjustment`.
- Estoque no banco: 32 cheios / 38 vazios (correto após 5 trocas pós-correção).
- **Vale fantasma no Beto:** ainda existe no SQLite local dele (v0.12.1 previne recorrência, mas não limpa o passado). Reinstalar o app resolve.

## 5. Próximos passos
1. **Beto reinstalar o app** para limpar o vale fantasma existente (opcional — só visual, não afeta servidor).
2. **Retry automático com cap** — `markError` ainda é terminal para eventos de rede. Classificar: transitório (retry com backoff) vs. permanente (park). Pré-condição: limpar 2 vendas presas antigas (ver sessão 9).
3. **Erro engolido no pull** — `applyEventSafe` avança cursor mesmo quando evento falha. Revisar para não pular eventos permanentemente.
4. **created_at de restocks/expenses** — réplicas ainda usam `server_received_at` (baixa prioridade, dono não reclamou).

## 6. Perguntas em aberto
- Senhas Firebase permanecem `123456` (pedro/maria/beto) — decisão do dono, não mudar.
- 2 vendas presas antigas (sessão 7) ainda no outbox do celular-fonte com `status='error'` — limpeza manual pendente.

## 7. Artefatos relevantes
Arquivos modificados nesta sessão:
- `lib/sync/outbox.ts` — `setEnqueueHook` + chamada no `enqueue()`
- `lib/sync/engine.ts` — `_syncPromise`, poll 10s, bump store após pull, compensação no `_pushFacts`
- `lib/sync/compensate.ts` — novo, compensação por tipo de evento

Comandos úteis:
```powershell
npx jest --no-coverage                                                 # testes mobile
npx eas-cli build --platform android --profile preview --non-interactive  # build APK
npx eas-cli build:list --platform android --limit 1 --json             # último link APK
```

Queries úteis (Supabase):
```sql
-- Estado do inventário
SELECT ct.name, i.full_qty, i.empty_qty, i.last_set_at
FROM inventory i JOIN cylinder_types ct ON ct.id = i.cylinder_type_id;

-- Últimos stock_sets
SELECT full_qty, empty_qty, client_created_at FROM stock_sets ORDER BY sequence DESC LIMIT 5;

-- Vales recentes
SELECT ds.amount, c.name, ds.client_created_at
FROM debt_settlements ds JOIN customers c ON c.id = ds.customer_id
ORDER BY ds.server_received_at DESC LIMIT 10;
```

Conexão Supabase (via psql):
```
--host=aws-1-sa-east-1.pooler.supabase.com --port=5432
--username="postgres.aealxmiyotyeoutlqljy" --dbname=postgres
PGPASSWORD do Secret Manager: gcloud secrets versions access latest --secret=DATABASE_URL --project=gas-manager-499616
```

## 8. Instruções pra próxima sessão
- v0.12.1 é o APK mais recente — link acima.
- Backend não foi alterado, revisão ativa continua `gas-backend-00013-8qg`.
- Migration 0007 já aplicada — não reaplicar.
- O vale fantasma do Beto some com reinstalação do app (SQLite limpo).
- Execução inline (não subagentes); commits sem menção ao Claude.
- Tom direto; ir à implementação completa, sem versões minimalistas.
- Próxima feature sugerida: retry automático com cap (pré-condição: limpar vendas presas da sessão 7).
