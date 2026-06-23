# Features Urgentes — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três features funcionais sem tocar no backend: (1) busca de cliente no formulário de venda, (2) log de vales recebidos com forma de pagamento, (3) aba "Financeiro" mostrando vales do período.

**Architecture:** Migration v4 do SQLite local adiciona `debt_settlements`. `settleCustomerDebt` grava nessa tabela + eventos pullados do backend também. Formulário de settle-debt ganha seletor de forma de pagamento. Tela de Relatórios vira "Financeiro" e exibe seção de vales. Sale-form troca scroll horizontal por modal com busca.

**Tech Stack:** Expo SDK 54, expo-sqlite, NativeWind, Expo Router, TypeScript

> **Dark mode** e **Despesas** são planos separados: `2026-06-22-dark-mode.md` e `2026-06-22-despesas.md` (este último requer backend Go).

---

## File Map

| Arquivo | Ação | O que muda |
|---|---|---|
| `db/database.ts` | MODIFY | Migration v4: tabela `debt_settlements`; SCHEMA_VERSION → 4 |
| `types/index.ts` | MODIFY | Novo tipo `DebtSettlement` |
| `db/queries/settlements.ts` | CREATE | `getSettlements(db, from, to)` |
| `db/queries/customers.ts` | MODIFY | `settleCustomerDebt` grava log + aceita payment_method via param |
| `lib/sync/apply.ts` | MODIFY | `applySettlement` também insere em `debt_settlements` |
| `app/settle-debt.tsx` | MODIFY | Seletor de forma de pagamento (Dinheiro / PIX / Cartão) |
| `app/sale-form.tsx` | MODIFY | Modal de busca de cliente em vez de scroll horizontal |
| `app/(tabs)/reports.tsx` | MODIFY | Seção "Vales Recebidos"; carrega `getSettlements` |
| `app/(tabs)/_layout.tsx` | MODIFY | Tab "Relatórios" → "Financeiro"; ícone wallet |
| `db/__tests__/customers.sync.test.ts` | MODIFY | Testes para `settleCustomerDebt` com log + payment_method |
| `db/__tests__/sales.sync.test.ts` | VERIFY | Apenas verificar que ainda passa (sem mudança esperada) |
| `db/queries/sales.ts` | MODIFY | Adicionar `getSaleById` |
| `app/(tabs)/sales.tsx` | MODIFY | Ícone de edição no SaleCard + handler `onEdit` |
| `app/sale-edit.tsx` | CREATE | Formulário de edição: pré-carrega a venda, void + re-registro ao salvar |

---

## Task 1: Busca de cliente no formulário de venda

**Files:**
- Modify: `app/sale-form.tsx`

- [ ] **Step 1.1: Adicionar imports de Modal e FlatList**

Em `app/sale-form.tsx`, linha 1, substituir os imports do react-native:

```tsx
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, Alert, Switch, Modal, FlatList
} from "react-native";
```

- [ ] **Step 1.2: Adicionar estados do modal**

No componente `SaleFormScreen`, após `const [saving, setSaving] = useState(false);`:

```tsx
const [customerSearch, setCustomerSearch] = useState("");
const [customerModalVisible, setCustomerModalVisible] = useState(false);

const filteredCustomers = customers.filter((c) =>
  c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
  (c.phone ?? "").includes(customerSearch)
);
```

- [ ] **Step 1.3: Substituir bloco do cliente**

Localizar e substituir o bloco completo do cliente (atualmente usa `ScrollView horizontal`). Substituir do `<View>` que contém `Cliente {paymentMethod === "fiado" ? ...}` até o `</View>` que fecha esse bloco:

```tsx
{/* Customer */}
<View>
  <Text className="text-sm font-semibold text-gray-700 mb-2">
    Cliente {paymentMethod === "fiado" ? "(obrigatório)" : "(opcional)"}
  </Text>
  <TouchableOpacity
    className={`flex-row items-center justify-between bg-white border rounded-xl px-4 py-3.5 ${
      paymentMethod === "fiado" && !selectedCustomer
        ? "border-red-300"
        : "border-gray-200"
    }`}
    onPress={() => setCustomerModalVisible(true)}
  >
    <Text
      className={`text-base ${
        selectedCustomer ? "text-gray-900 font-medium" : "text-gray-400"
      }`}
    >
      {selectedCustomer?.name ?? "Sem cliente"}
    </Text>
    <Ionicons name="chevron-down" size={18} color="#9ca3af" />
  </TouchableOpacity>

  <Modal
    visible={customerModalVisible}
    animationType="slide"
    presentationStyle="pageSheet"
    onRequestClose={() => setCustomerModalVisible(false)}
  >
    <View className="flex-1 bg-gray-50">
      <View className="px-4 pt-6 pb-3 bg-white border-b border-gray-100">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-lg font-bold text-gray-900">
            Selecionar cliente
          </Text>
          <TouchableOpacity onPress={() => setCustomerModalVisible(false)}>
            <Ionicons name="close" size={24} color="#6b7280" />
          </TouchableOpacity>
        </View>
        <View className="bg-gray-100 border border-gray-200 rounded-xl flex-row items-center px-3">
          <Ionicons name="search" size={16} color="#9ca3af" />
          <TextInput
            className="flex-1 py-2.5 px-2 text-gray-900"
            placeholder="Buscar pelo nome ou telefone..."
            placeholderTextColor="#9ca3af"
            value={customerSearch}
            onChangeText={setCustomerSearch}
            autoFocus
          />
          {customerSearch.length > 0 && (
            <TouchableOpacity onPress={() => setCustomerSearch("")}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <FlatList
        data={filteredCustomers}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <TouchableOpacity
            className="mx-4 mt-3 mb-1 bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex-row items-center justify-between"
            onPress={() => {
              setSelectedCustomer(null);
              setCustomerSearch("");
              setCustomerModalVisible(false);
            }}
          >
            <Text
              className={`font-medium text-base ${
                !selectedCustomer ? "text-primary-500" : "text-gray-700"
              }`}
            >
              Sem cliente
            </Text>
            {!selectedCustomer && (
              <Ionicons name="checkmark" size={20} color="#f97316" />
            )}
          </TouchableOpacity>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            className="mx-4 mb-1 bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex-row items-center justify-between"
            onPress={() => {
              setSelectedCustomer(item);
              setCustomerSearch("");
              setCustomerModalVisible(false);
            }}
          >
            <View className="flex-1 mr-3">
              <Text
                className={`font-medium text-base ${
                  selectedCustomer?.id === item.id
                    ? "text-primary-500"
                    : "text-gray-900"
                }`}
              >
                {item.name}
              </Text>
              {item.phone && (
                <Text className="text-xs text-gray-400 mt-0.5">
                  {item.phone}
                </Text>
              )}
            </View>
            {selectedCustomer?.id === item.id && (
              <Ionicons name="checkmark" size={20} color="#f97316" />
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Ionicons name="people-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-2 font-medium">
              Nenhum cliente encontrado
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  </Modal>
</View>
```

- [ ] **Step 1.4: Testar manualmente no app**

Abrir o formulário de nova venda → tocar no campo "Cliente" → modal deve abrir com campo de busca → digitar parte do nome → lista filtra → selecionar → modal fecha, botão mostra o nome selecionado.

- [ ] **Step 1.5: Commit**

```bash
git add app/sale-form.tsx
git commit -m "feat(sale-form): substituir scroll horizontal de cliente por modal com busca"
```

---

## Task 2: Tipo DebtSettlement

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 2.1: Adicionar tipo ao final de `types/index.ts`**

```ts
export interface DebtSettlement {
  id: number;
  uuid: string;
  customer_id: number | null;
  customer_name: string;
  amount: number;
  payment_method: string;
  created_at: string;
}
```

---

## Task 3: Migration v4 — tabela debt_settlements

**Files:**
- Modify: `db/database.ts`

- [ ] **Step 3.1: Atualizar SCHEMA_VERSION**

```ts
export const SCHEMA_VERSION = 4;
```

- [ ] **Step 3.2: Adicionar bloco de migration v4 dentro de `migrate()`**

Após o bloco `if (current < 3) { ... }`, adicionar:

```ts
  if (current < 4) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS debt_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL UNIQUE,
          customer_id INTEGER,
          customer_name TEXT NOT NULL,
          amount REAL NOT NULL,
          payment_method TEXT NOT NULL DEFAULT 'cash',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
        );

        PRAGMA user_version = 4;
      `);
    });
  }
```

- [ ] **Step 3.3: Verificar que testes de migration passam**

```bash
npx jest db/__tests__/migration.test.ts --no-coverage
```

Expected: PASS (o teste de migration verifica que initDatabase roda sem erro).

- [ ] **Step 3.4: Commit**

```bash
git add db/database.ts types/index.ts
git commit -m "feat(db): migration v4 — tabela debt_settlements para log de vales recebidos"
```

---

## Task 4: Query getSettlements

**Files:**
- Create: `db/queries/settlements.ts`

- [ ] **Step 4.1: Criar arquivo**

```ts
import { SQLiteDatabase } from "expo-sqlite";
import { DebtSettlement } from "@/types";

export async function getSettlements(
  db: SQLiteDatabase,
  from: string,
  to: string
): Promise<DebtSettlement[]> {
  return db.getAllAsync<DebtSettlement>(
    `SELECT * FROM debt_settlements
     WHERE date(created_at) BETWEEN ? AND ?
     ORDER BY created_at DESC`,
    [from, to]
  );
}

export async function getSettlementsByCustomer(
  db: SQLiteDatabase,
  customerId: number
): Promise<DebtSettlement[]> {
  return db.getAllAsync<DebtSettlement>(
    `SELECT * FROM debt_settlements
     WHERE customer_id = ?
     ORDER BY created_at DESC`,
    [customerId]
  );
}
```

- [ ] **Step 4.2: Commit**

```bash
git add db/queries/settlements.ts
git commit -m "feat(db): query getSettlements para buscar vales recebidos por período"
```

---

## Task 5: settleCustomerDebt — log + payment_method no UI

**Files:**
- Modify: `db/queries/customers.ts`

- [ ] **Step 5.1: Escrever testes novos antes de implementar**

Em `db/__tests__/customers.sync.test.ts`, adicionar dentro do `describe("settleCustomerDebt")`:

```ts
  it("grava log em debt_settlements com payment_method", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Pagador" });
    await db.runAsync(`UPDATE customers SET balance = -300 WHERE id = ?`, [id]);

    await settleCustomerDebt(db, id, 150, "cash");

    const row = await db.getFirstAsync<{
      uuid: string;
      customer_name: string;
      amount: number;
      payment_method: string;
    }>(`SELECT * FROM debt_settlements LIMIT 1`);

    expect(row).toBeTruthy();
    expect(row!.customer_name).toBe("Pagador");
    expect(row!.amount).toBeCloseTo(150, 5);
    expect(row!.payment_method).toBe("cash");
    expect(row!.uuid).toHaveLength(36);
  });

  it("usa pix como método padrão se não especificado", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Padrão" });
    await db.runAsync(`UPDATE customers SET balance = -100 WHERE id = ?`, [id]);

    await settleCustomerDebt(db, id, 100);

    const row = await db.getFirstAsync<{ payment_method: string }>(
      `SELECT payment_method FROM debt_settlements LIMIT 1`
    );
    expect(row?.payment_method).toBe("pix");
  });
```

- [ ] **Step 5.2: Rodar testes — esperar FAIL**

```bash
npx jest db/__tests__/customers.sync.test.ts --no-coverage
```

Expected: FAIL — "no such table: debt_settlements" (a migration v4 precisa ter sido aplicada no DB de teste, o que acontecerá quando `initDatabase` rodar em um DB fresco na v4).

Na verdade o erro esperado aqui vai aparecer porque `debt_settlements` não existe no customers.ts ainda. Confirmar que o erro é sobre `debt_settlements` e não algo diferente.

- [ ] **Step 5.3: Implementar settleCustomerDebt atualizado**

Substituir a função `settleCustomerDebt` inteira em `db/queries/customers.ts`:

```ts
export async function settleCustomerDebt(
  db: SQLiteDatabase,
  id: number,
  amount: number,
  paymentMethod: string = "pix"
) {
  const now = new Date().toISOString();
  const uuid = randomUUID();

  await db.withTransactionAsync(async () => {
    const customer = await db.getFirstAsync<{ uuid: string; name: string }>(
      `SELECT uuid, name FROM customers WHERE id = ?`,
      [id]
    );
    if (!customer) throw new Error("Cliente não encontrado");

    await db.runAsync(
      `UPDATE customers SET balance = balance + ? WHERE id = ?`,
      [amount, id]
    );

    await db.runAsync(
      `INSERT INTO debt_settlements (uuid, customer_id, customer_name, amount, payment_method)
       VALUES (?, ?, ?, ?, ?)`,
      [uuid, id, customer.name, amount, paymentMethod]
    );

    await enqueue(db, {
      event_uuid: uuid,
      kind: "debt_settlement",
      payload: JSON.stringify({
        kind: "debt_settlement",
        id: uuid,
        client_created_at: now,
        debt_settlement: {
          customer_id: customer.uuid,
          amount: amount.toFixed(2),
          payment_method: paymentMethod,
        },
      }),
      client_created_at: now,
    });
  });
}
```

- [ ] **Step 5.4: Rodar todos os testes**

```bash
npx jest --no-coverage
```

Expected: todos passando (102+ testes).

- [ ] **Step 5.5: Commit**

```bash
git add db/queries/customers.ts db/__tests__/customers.sync.test.ts
git commit -m "feat(customers): settleCustomerDebt grava log em debt_settlements + aceita payment_method"
```

---

## Task 6: applySettlement — inserir no log local

**Files:**
- Modify: `lib/sync/apply.ts`

- [ ] **Step 6.1: Escrever teste para applySettlement com log**

Em `lib/sync/__tests__/apply.test.ts`, adicionar um teste que verifica que após `applyEvent` com kind `debt_settlement`, a tabela `debt_settlements` tem uma entrada:

```ts
it("applySettlement grava em debt_settlements", async () => {
  const db = createTestDb();
  await initDatabase(db);
  const customerId = await addCustomer(db, { name: "Cliente Sync" });
  const customer = await db.getFirstAsync<{ uuid: string }>(
    `SELECT uuid FROM customers WHERE id = ?`, [customerId]
  );

  await applyEvent(db, {
    kind: "debt_settlement",
    sequence: 1,
    server_received_at: new Date().toISOString(),
    data: {
      id: "aaa-bbb-ccc",
      customer_id: customer!.uuid,
      amount: "75.00",
      payment_method: "pix",
    },
  });

  const settlement = await db.getFirstAsync<{
    uuid: string;
    amount: number;
    payment_method: string;
  }>(`SELECT * FROM debt_settlements WHERE uuid = 'aaa-bbb-ccc'`);

  expect(settlement).toBeTruthy();
  expect(settlement!.amount).toBeCloseTo(75, 5);
  expect(settlement!.payment_method).toBe("pix");
});
```

Verificar que o arquivo de teste já importa `applyEvent`, `initDatabase`, `addCustomer`. Adicionar imports que faltarem.

- [ ] **Step 6.2: Rodar o teste — esperar FAIL**

```bash
npx jest lib/sync/__tests__/apply.test.ts --no-coverage
```

Expected: FAIL — settlement existe em applied_events mas não em debt_settlements.

- [ ] **Step 6.3: Implementar `applySettlement` atualizado em `lib/sync/apply.ts`**

Substituir a função `applySettlement` inteira:

```ts
async function applySettlement(db: SQLiteDatabase, d: PulledSettlement): Promise<void> {
  const dedup = await db.runAsync(
    `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
    [d.id]
  );

  if (dedup.changes === 0) return;

  const customerId = await resolveOrCreateCustomer(db, d.customer_id);
  const amount = parseFloat(d.amount);

  await db.runAsync(
    `UPDATE customers SET balance = balance + ? WHERE id = ?`,
    [amount, customerId]
  );

  const customer = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM customers WHERE id = ?`,
    [customerId]
  );

  await db.runAsync(
    `INSERT OR IGNORE INTO debt_settlements
       (uuid, customer_id, customer_name, amount, payment_method)
     VALUES (?, ?, ?, ?, ?)`,
    [d.id, customerId, customer?.name ?? "(sincronizando)", amount, d.payment_method]
  );
}
```

- [ ] **Step 6.4: Rodar todos os testes**

```bash
npx jest --no-coverage
```

Expected: todos passando.

- [ ] **Step 6.5: Commit**

```bash
git add lib/sync/apply.ts lib/sync/__tests__/apply.test.ts
git commit -m "feat(sync): applySettlement grava em debt_settlements para histórico local"
```

---

## Task 7: settle-debt.tsx — seletor de forma de pagamento

**Files:**
- Modify: `app/settle-debt.tsx`

- [ ] **Step 7.1: Implementar tela atualizada**

Substituir o conteúdo completo de `app/settle-debt.tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { settleCustomerDebt } from "@/db/queries/customers";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type SettlePaymentMethod = "cash" | "pix" | "card";

const SETTLE_METHODS: { key: SettlePaymentMethod; label: string; icon: string }[] = [
  { key: "cash", label: "Dinheiro", icon: "cash-outline" },
  { key: "pix", label: "PIX", icon: "phone-portrait-outline" },
  { key: "card", label: "Cartão", icon: "card-outline" },
];

export default function SettleDebtScreen() {
  const db = useSQLiteContext();
  const { id, name, balance } = useLocalSearchParams<{
    id: string;
    name: string;
    balance: string;
  }>();
  const debt = Math.abs(parseFloat(balance ?? "0"));

  const [amount, setAmount] = useState(String(debt));
  const [paymentMethod, setPaymentMethod] = useState<SettlePaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const handleSettle = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return Alert.alert("Erro", "Valor inválido");
    if (value > debt)
      return Alert.alert(
        "Erro",
        `O valor não pode ser maior que a dívida (${formatCurrency(debt)})`
      );

    setSaving(true);
    try {
      await settleCustomerDebt(db, parseInt(id!), value, paymentMethod);
      bumpCustomers();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao registrar pagamento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        <View className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <Text className="text-sm text-red-600 font-medium">{name}</Text>
          <Text className="text-2xl font-bold text-red-700 mt-1">
            {formatCurrency(debt)}
          </Text>
          <Text className="text-xs text-red-400 mt-0.5">Dívida total</Text>
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">
            Valor recebido (R$)
          </Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-xl font-bold"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            autoFocus
          />
        </View>

        <View className="flex-row gap-2">
          {[debt * 0.5, debt].map((preset, idx) => (
            <TouchableOpacity
              key={idx}
              className="flex-1 bg-white border border-gray-200 rounded-xl py-2.5 items-center"
              onPress={() => setAmount(String(preset.toFixed(2)))}
            >
              <Text className="text-sm font-semibold text-gray-700">
                {idx === 0 ? "Metade" : "Total"}
              </Text>
              <Text className="text-xs text-gray-400">{formatCurrency(preset)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">
            Como o cliente pagou?
          </Text>
          <View className="flex-row gap-2">
            {SETTLE_METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                className={`flex-1 rounded-xl py-3 border items-center gap-1 ${
                  paymentMethod === m.key
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white border-gray-200"
                }`}
                onPress={() => setPaymentMethod(m.key)}
              >
                <Ionicons
                  name={m.icon as any}
                  size={20}
                  color={paymentMethod === m.key ? "#ffffff" : "#6b7280"}
                />
                <Text
                  className={`text-xs font-semibold ${
                    paymentMethod === m.key ? "text-white" : "text-gray-700"
                  }`}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${
            saving ? "bg-gray-300" : "bg-primary-500"
          }`}
          onPress={handleSettle}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">
            {saving ? "Registrando..." : "Confirmar Pagamento"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 7.2: Testar manualmente**

Abrir um cliente com dívida → tocar em "Pagar" → selecionar "Cartão" → confirmar → verificar que o app volta para a lista de clientes sem erro.

- [ ] **Step 7.3: Commit**

```bash
git add app/settle-debt.tsx
git commit -m "feat(settle-debt): seletor de forma de pagamento (Dinheiro / PIX / Cartão)"
```

---

## Task 8: Aba Financeiro — vales recebidos na tela de relatórios

**Files:**
- Modify: `app/(tabs)/reports.tsx`
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 8.1: Atualizar `app/(tabs)/_layout.tsx` — renomear tab**

Localizar o bloco da tab `reports` e alterar `title` e ícone:

```tsx
<Tabs.Screen
  name="reports"
  options={{
    title: "Financeiro",
    tabBarIcon: ({ color, size }) => (
      <TabIcon name="wallet" color={color} size={size} />
    ),
  }}
/>
```

- [ ] **Step 8.2: Atualizar `app/(tabs)/reports.tsx` — adicionar vales recebidos**

Substituir o conteúdo completo de `app/(tabs)/reports.tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { getReportByPeriod, getDashboardStats } from "@/db/queries/sales";
import { getSettlements } from "@/db/queries/settlements";
import { DashboardStats, DebtSettlement } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getDateRange(period: "today" | "week" | "month") {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { from: fmt(start), to: today };
  }
  return {
    from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    to: today,
  };
}

type Period = "today" | "week" | "month";

const periodLabels: Record<Period, string> = {
  today: "Hoje",
  week: "7 dias",
  month: "Este mês",
};

const paymentLabels: Record<string, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  fiado: "Fiado",
};

export default function FinanceiroScreen() {
  const db = useSQLiteContext();
  const [period, setPeriod] = useState<Period>("today");
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [settlements, setSettlements] = useState<DebtSettlement[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const salesVersion = useAppStore((s) => s.salesVersion);
  const customersVersion = useAppStore((s) => s.customersVersion);

  const load = useCallback(async () => {
    const { from, to } = getDateRange(period);
    const [reportRows, dashStats, settleRows] = await Promise.all([
      getReportByPeriod(db, from, to),
      getDashboardStats(db),
      getSettlements(db, from, to),
    ]);
    setRows(reportRows as any[]);
    setStats(dashStats);
    setSettlements(settleRows);
  }, [db, period]);

  useEffect(() => {
    load();
  }, [load, salesVersion, customersVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const currentRevenue =
    period === "today"
      ? stats?.today_revenue
      : period === "week"
      ? stats?.week_revenue
      : stats?.month_revenue;

  const currentSales =
    period === "today"
      ? stats?.today_sales
      : period === "week"
      ? stats?.week_sales
      : stats?.month_sales;

  const paymentTotals: Record<string, number> = {};
  rows.forEach((r: any) => {
    paymentTotals[r.payment_method] =
      (paymentTotals[r.payment_method] ?? 0) + r.total_revenue;
  });

  const totalRevenue = rows.reduce((acc: number, r: any) => acc + r.total_revenue, 0);
  const totalCost = rows.reduce((acc: number, r: any) => acc + r.total_cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const totalSettled = settlements.reduce((acc, s) => acc + s.amount, 0);

  const settlementByMethod: Record<string, number> = {};
  settlements.forEach((s) => {
    settlementByMethod[s.payment_method] =
      (settlementByMethod[s.payment_method] ?? 0) + s.amount;
  });

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#f97316"
        />
      }
    >
      <View className="px-4 pt-4 pb-3">
        <Text className="text-lg font-bold text-gray-900 mb-3">Financeiro</Text>

        {/* Period selector */}
        <View className="bg-gray-200 rounded-xl p-1 flex-row mb-4">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              className={`flex-1 py-2 rounded-lg items-center ${
                period === p ? "bg-white shadow" : ""
              }`}
              onPress={() => setPeriod(p)}
            >
              <Text
                className={`text-sm font-semibold ${
                  period === p ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {periodLabels[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary card — Vendas */}
        <View className="bg-primary-500 rounded-2xl p-5 mb-4">
          <Text className="text-white opacity-80 text-sm font-medium mb-1">
            Faturamento
          </Text>
          <Text className="text-white text-3xl font-bold">
            {formatCurrency(currentRevenue ?? 0)}
          </Text>
          <Text className="text-white opacity-70 text-sm mt-1">
            {currentSales ?? 0} botijões vendidos
          </Text>
        </View>

        {rows.length > 0 && (
          <View className="flex-row gap-3 mb-4">
            <View className="flex-1 bg-white rounded-2xl border border-gray-100 p-4">
              <Text className="text-xs text-gray-500 font-medium mb-1">Lucro</Text>
              <Text
                className={`text-xl font-bold ${
                  totalProfit >= 0 ? "text-green-700" : "text-red-600"
                }`}
              >
                {formatCurrency(totalProfit)}
              </Text>
            </View>
            <View className="flex-1 bg-white rounded-2xl border border-gray-100 p-4">
              <Text className="text-xs text-gray-500 font-medium mb-1">Margem</Text>
              <Text
                className={`text-xl font-bold ${
                  margin >= 0 ? "text-green-700" : "text-red-600"
                }`}
              >
                {margin.toFixed(1)}%
              </Text>
            </View>
          </View>
        )}

        {/* By payment method — vendas */}
        {Object.keys(paymentTotals).length > 0 && (
          <>
            <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
              Vendas por pagamento
            </Text>
            <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
              {Object.entries(paymentTotals).map(([method, total], idx, arr) => (
                <View
                  key={method}
                  className={`px-4 py-3 flex-row items-center justify-between ${
                    idx < arr.length - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  <Text className="text-gray-700 font-medium">
                    {paymentLabels[method] ?? method}
                  </Text>
                  <Text className="font-bold text-gray-900">
                    {formatCurrency(total)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* By cylinder */}
        {rows.length > 0 && (
          <>
            <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
              Por Botijão
            </Text>
            <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
              {Object.entries(
                rows.reduce(
                  (
                    acc: Record<
                      string,
                      { qty: number; revenue: number; profit: number }
                    >,
                    r: any
                  ) => {
                    acc[r.cylinder_name] = acc[r.cylinder_name] ?? {
                      qty: 0,
                      revenue: 0,
                      profit: 0,
                    };
                    acc[r.cylinder_name].qty += r.total_qty;
                    acc[r.cylinder_name].revenue += r.total_revenue;
                    acc[r.cylinder_name].profit += r.total_profit;
                    return acc;
                  },
                  {}
                )
              ).map(([name, { qty, revenue, profit }], idx, arr) => (
                <View
                  key={name}
                  className={`px-4 py-3 flex-row items-center justify-between ${
                    idx < arr.length - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  <View>
                    <Text className="text-gray-700 font-medium">{name}</Text>
                    <Text className="text-xs text-gray-400">
                      {qty} un · lucro {formatCurrency(profit)}
                    </Text>
                  </View>
                  <Text className="font-bold text-gray-900">
                    {formatCurrency(revenue)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Vales recebidos */}
        <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
          Vales recebidos
        </Text>
        {settlements.length > 0 ? (
          <>
            <View className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-3 flex-row items-center justify-between">
              <View>
                <Text className="text-green-700 font-bold text-xl">
                  {formatCurrency(totalSettled)}
                </Text>
                <Text className="text-green-600 text-xs mt-0.5">
                  {settlements.length} pagamento(s) de fiado recebido(s)
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={32} color="#16a34a" />
            </View>

            {Object.keys(settlementByMethod).length > 1 && (
              <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-3">
                {Object.entries(settlementByMethod).map(
                  ([method, total], idx, arr) => (
                    <View
                      key={method}
                      className={`px-4 py-3 flex-row items-center justify-between ${
                        idx < arr.length - 1 ? "border-b border-gray-100" : ""
                      }`}
                    >
                      <Text className="text-gray-700 font-medium">
                        {paymentLabels[method] ?? method}
                      </Text>
                      <Text className="font-bold text-gray-900">
                        {formatCurrency(total)}
                      </Text>
                    </View>
                  )
                )}
              </View>
            )}

            <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
              {settlements.map((s, idx) => (
                <View
                  key={s.uuid}
                  className={`px-4 py-3 flex-row items-center justify-between ${
                    idx < settlements.length - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  <View className="flex-1 mr-3">
                    <Text className="font-medium text-gray-900 text-sm">
                      {s.customer_name}
                    </Text>
                    <Text className="text-xs text-gray-400">
                      {paymentLabels[s.payment_method] ?? s.payment_method} ·{" "}
                      {new Date(s.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Text className="font-bold text-green-700">
                    +{formatCurrency(s.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View className="bg-white rounded-2xl border border-gray-100 p-6 items-center mb-4">
            <Ionicons name="wallet-outline" size={36} color="#d1d5db" />
            <Text className="text-gray-400 mt-2 font-medium text-sm">
              Nenhum vale recebido {periodLabels[period].toLowerCase()}
            </Text>
          </View>
        )}

        {rows.length === 0 && settlements.length === 0 && (
          <View className="items-center py-6">
            <Text className="text-gray-300 text-sm">
              Sem movimentação no período
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 8.3: Rodar os testes**

```bash
npx jest --no-coverage
```

Expected: todos passando.

- [ ] **Step 8.4: Testar manualmente**

1. Quitar parte do fiado de um cliente (usar o botão vermelho em Clientes)
2. Ir na aba Financeiro → seção "Vales recebidos" deve mostrar o pagamento com valor e forma de pagamento
3. Trocar período (Hoje / 7 dias / Mês) — a seção deve filtrar corretamente

- [ ] **Step 8.5: Commit**

```bash
git add app/(tabs)/reports.tsx app/(tabs)/_layout.tsx db/queries/settlements.ts
git commit -m "feat(financeiro): aba Financeiro com seção de vales recebidos por período"
```

---

## Task 9: Editar venda na aba de Vendas

**Abordagem:** void + re-registro. A venda original é anulada via `voidSale` e uma nova é criada com `registerSale`. Sem novas colunas no banco nem novos tipos de evento no backend — funciona com a infraestrutura existente. O timestamp da venda editada muda para o momento da edição (comportamento esperado para um app offline-first sem suporte a update de fatos).

**Files:**
- Modify: `db/queries/sales.ts`
- Modify: `app/(tabs)/sales.tsx`
- Create: `app/sale-edit.tsx`

---

- [ ] **Step 9.1: Adicionar `getSaleById` em `db/queries/sales.ts`**

Adicionar após a função `getSales`:

```ts
export async function getSaleById(
  db: SQLiteDatabase,
  id: number
): Promise<Sale | null> {
  return db.getFirstAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.id = ?`,
    [id]
  );
}
```

---

- [ ] **Step 9.2: Adicionar botão de edição no `SaleCard` em `app/(tabs)/sales.tsx`**

Localizar o tipo de `SaleCard` e adicionar `onEdit`:

```tsx
function SaleCard({
  item,
  onDelete,
  onEdit,
}: {
  item: Sale;
  onDelete: (id: number) => void;
  onEdit: (id: number) => void;
}) {
```

Dentro do card, na `View` que contém o total e o lixo, adicionar o ícone de lápis antes do lixo:

```tsx
<View className="flex-row items-center gap-3">
  <Text className="font-bold text-gray-900 dark:text-gray-50 text-base">
    {formatCurrency(item.total)}
  </Text>
  <TouchableOpacity onPress={() => onEdit(item.id)} className="p-1">
    <Ionicons name="pencil-outline" size={16} color="#9ca3af" />
  </TouchableOpacity>
  <TouchableOpacity onPress={() => onDelete(item.id)} className="p-1">
    <Ionicons name="trash-outline" size={16} color="#ef4444" />
  </TouchableOpacity>
</View>
```

Na renderização do `FlatList`, passar o novo handler:

```tsx
renderItem={({ item }) => (
  <SaleCard
    item={item}
    onDelete={handleDelete}
    onEdit={(id) => router.push({ pathname: "/sale-edit", params: { saleId: id } })}
  />
)}
```

---

- [ ] **Step 9.3: Criar `app/sale-edit.tsx`**

```tsx
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, Alert, Switch, Modal, FlatList
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getCylinderTypes } from "@/db/queries/inventory";
import { getCustomers } from "@/db/queries/customers";
import { getSaleById, voidSale, registerSale } from "@/db/queries/sales";
import { CylinderType, Customer, PaymentMethod, Sale } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Dinheiro" },
  { key: "pix", label: "PIX" },
  { key: "card", label: "Cartão" },
  { key: "fiado", label: "Fiado" },
];

export default function SaleEditScreen() {
  const db = useSQLiteContext();
  const { saleId } = useLocalSearchParams<{ saleId: string }>();

  const [original, setOriginal] = useState<Sale | null>(null);
  const [cylinders, setCylinders] = useState<CylinderType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCylinder, setSelectedCylinder] = useState<CylinderType | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [isExchange, setIsExchange] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerModalVisible, setCustomerModalVisible] = useState(false);

  const bumpSales = useAppStore((s) => s.bumpSales);
  const bumpInventory = useAppStore((s) => s.bumpInventory);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone ?? "").includes(customerSearch)
  );

  const load = useCallback(async () => {
    const [sale, cyl, cust] = await Promise.all([
      getSaleById(db, parseInt(saleId!)),
      getCylinderTypes(db),
      getCustomers(db),
    ]);

    if (!sale) {
      Alert.alert("Erro", "Venda não encontrada");
      router.back();
      return;
    }

    setOriginal(sale);
    setCylinders(cyl);
    setCustomers(cust);
    setQuantity(String(sale.quantity));
    setUnitPrice(String(sale.unit_price));
    setPaymentMethod(sale.payment_method);
    setIsExchange(Boolean(sale.is_exchange));

    const cyl0 = cyl.find((c) => c.id === sale.cylinder_type_id) ?? cyl[0] ?? null;
    setSelectedCylinder(cyl0);

    if (sale.customer_id) {
      const c = cust.find((c) => c.id === sale.customer_id) ?? null;
      setSelectedCustomer(c);
    }
  }, [db, saleId]);

  useEffect(() => { load(); }, [load]);

  const total = (parseInt(quantity) || 0) * (parseFloat(unitPrice) || 0);

  const handleSave = async () => {
    if (!selectedCylinder || !original) return;
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) return Alert.alert("Erro", "Quantidade inválida");
    const price = parseFloat(unitPrice);
    if (!price || price <= 0) return Alert.alert("Erro", "Preço de venda inválido");
    if (paymentMethod === "fiado" && !selectedCustomer) {
      return Alert.alert("Erro", "Selecione um cliente para venda no fiado");
    }

    Alert.alert(
      "Editar venda",
      "A venda original será cancelada e uma nova será criada com os dados atualizados.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            setSaving(true);
            try {
              await voidSale(db, original.id);
              await registerSale(db, {
                customer_id: selectedCustomer?.id ?? null,
                cylinder_type_id: selectedCylinder.id,
                quantity: qty,
                unit_price: price,
                cost_price: selectedCylinder.cost_price,
                payment_method: paymentMethod,
                is_exchange: isExchange,
              });
              bumpSales();
              bumpInventory();
              bumpCustomers();
              router.back();
            } catch (e: any) {
              Alert.alert("Erro", e.message ?? "Falha ao editar venda");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (!original) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Text className="text-gray-400 dark:text-gray-500">Carregando...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">

        {/* Aviso de edição */}
        <View className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-xl px-4 py-3 flex-row items-center gap-2">
          <Ionicons name="information-circle-outline" size={18} color="#d97706" />
          <Text className="text-yellow-700 dark:text-yellow-400 text-sm flex-1">
            A venda original será anulada e uma nova será gerada com as alterações.
          </Text>
        </View>

        {/* Cylinder type */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Botijão</Text>
          <View className="flex-row gap-2 flex-wrap">
            {cylinders.map((c) => (
              <TouchableOpacity
                key={c.id}
                className={`flex-1 min-w-[80px] rounded-xl p-3 border items-center ${
                  selectedCylinder?.id === c.id
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => setSelectedCylinder(c)}
              >
                <Text className={`font-bold text-base ${selectedCylinder?.id === c.id ? "text-white" : "text-gray-900 dark:text-gray-50"}`}>
                  {c.name}
                </Text>
                <Text className={`text-xs mt-0.5 ${selectedCylinder?.id === c.id ? "text-white opacity-80" : "text-gray-400 dark:text-gray-500"}`}>
                  {formatCurrency(c.sale_price)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quantity */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Quantidade</Text>
          <View className="flex-row items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <TouchableOpacity
              className="w-12 h-12 items-center justify-center border-r border-gray-200 dark:border-gray-700"
              onPress={() => setQuantity((prev) => String(Math.max(1, (parseInt(prev) || 1) - 1)))}
            >
              <Text className="text-xl font-bold text-gray-600 dark:text-gray-300">−</Text>
            </TouchableOpacity>
            <TextInput
              className="flex-1 text-center text-xl font-bold text-gray-900 dark:text-gray-50 py-2"
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
            />
            <TouchableOpacity
              className="w-12 h-12 items-center justify-center border-l border-gray-200 dark:border-gray-700"
              onPress={() => setQuantity((prev) => String((parseInt(prev) || 0) + 1))}
            >
              <Text className="text-xl font-bold text-gray-600 dark:text-gray-300">+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Price */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Preço de Venda (R$)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-3 text-gray-900 dark:text-gray-50 font-semibold"
            keyboardType="decimal-pad"
            value={unitPrice}
            onChangeText={setUnitPrice}
          />
        </View>

        {/* Payment method */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Pagamento</Text>
          <View className="flex-row gap-2 flex-wrap">
            {PAYMENT_METHODS.map((pm) => (
              <TouchableOpacity
                key={pm.key}
                className={`flex-1 min-w-[70px] rounded-xl py-2.5 border items-center ${
                  paymentMethod === pm.key
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => setPaymentMethod(pm.key)}
              >
                <Text className={`font-semibold text-sm ${paymentMethod === pm.key ? "text-white" : "text-gray-700 dark:text-gray-300"}`}>
                  {pm.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Exchange toggle */}
        <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex-row items-center justify-between">
          <View>
            <Text className="font-semibold text-gray-900 dark:text-gray-50">Troca de botijão</Text>
            <Text className="text-xs text-gray-400 dark:text-gray-500">Cliente devolveu botijão vazio</Text>
          </View>
          <Switch
            value={isExchange}
            onValueChange={setIsExchange}
            trackColor={{ true: "#f97316" }}
          />
        </View>

        {/* Customer */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Cliente {paymentMethod === "fiado" ? "(obrigatório)" : "(opcional)"}
          </Text>
          <TouchableOpacity
            className={`flex-row items-center justify-between bg-white dark:bg-gray-900 border rounded-xl px-4 py-3.5 ${
              paymentMethod === "fiado" && !selectedCustomer
                ? "border-red-300 dark:border-red-700"
                : "border-gray-200 dark:border-gray-700"
            }`}
            onPress={() => setCustomerModalVisible(true)}
          >
            <Text
              className={`text-base ${
                selectedCustomer ? "text-gray-900 dark:text-gray-50 font-medium" : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {selectedCustomer?.name ?? "Sem cliente"}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#9ca3af" />
          </TouchableOpacity>

          <Modal
            visible={customerModalVisible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setCustomerModalVisible(false)}
          >
            <View className="flex-1 bg-gray-50 dark:bg-gray-950">
              <View className="px-4 pt-6 pb-3 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-lg font-bold text-gray-900 dark:text-gray-50">
                    Selecionar cliente
                  </Text>
                  <TouchableOpacity onPress={() => setCustomerModalVisible(false)}>
                    <Ionicons name="close" size={24} color="#6b7280" />
                  </TouchableOpacity>
                </View>
                <View className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex-row items-center px-3">
                  <Ionicons name="search" size={16} color="#9ca3af" />
                  <TextInput
                    className="flex-1 py-2.5 px-2 text-gray-900 dark:text-gray-50"
                    placeholder="Buscar pelo nome ou telefone..."
                    placeholderTextColor="#9ca3af"
                    value={customerSearch}
                    onChangeText={setCustomerSearch}
                    autoFocus
                  />
                  {customerSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setCustomerSearch("")}>
                      <Ionicons name="close-circle" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <FlatList
                data={filteredCustomers}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <TouchableOpacity
                    className="mx-4 mt-3 mb-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3.5 flex-row items-center justify-between"
                    onPress={() => {
                      setSelectedCustomer(null);
                      setCustomerSearch("");
                      setCustomerModalVisible(false);
                    }}
                  >
                    <Text
                      className={`font-medium text-base ${
                        !selectedCustomer ? "text-primary-500" : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      Sem cliente
                    </Text>
                    {!selectedCustomer && (
                      <Ionicons name="checkmark" size={20} color="#f97316" />
                    )}
                  </TouchableOpacity>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    className="mx-4 mb-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3.5 flex-row items-center justify-between"
                    onPress={() => {
                      setSelectedCustomer(item);
                      setCustomerSearch("");
                      setCustomerModalVisible(false);
                    }}
                  >
                    <View className="flex-1 mr-3">
                      <Text
                        className={`font-medium text-base ${
                          selectedCustomer?.id === item.id
                            ? "text-primary-500"
                            : "text-gray-900 dark:text-gray-50"
                        }`}
                      >
                        {item.name}
                      </Text>
                      {item.phone && (
                        <Text className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {item.phone}
                        </Text>
                      )}
                    </View>
                    {selectedCustomer?.id === item.id && (
                      <Ionicons name="checkmark" size={20} color="#f97316" />
                    )}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View className="items-center py-12">
                    <Ionicons name="people-outline" size={40} color="#d1d5db" />
                    <Text className="text-gray-400 dark:text-gray-500 mt-2 font-medium">
                      Nenhum cliente encontrado
                    </Text>
                  </View>
                }
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            </View>
          </Modal>
        </View>

        {/* Total */}
        <View className="bg-primary-50 border border-primary-200 rounded-xl p-4 flex-row items-center justify-between">
          <Text className="text-gray-700 font-semibold">Total</Text>
          <Text className="text-primary-600 font-bold text-xl">{formatCurrency(total)}</Text>
        </View>

        {/* Save button */}
        <TouchableOpacity
          className={`rounded-xl py-4 items-center mb-8 ${saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">
            {saving ? "Salvando..." : "Salvar Alterações"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

---

- [ ] **Step 9.4: Rodar os testes**

```bash
npx jest --no-coverage
```

Expected: todos passando (nenhuma lógica de DB foi alterada, apenas UI + nova query).

- [ ] **Step 9.5: Testar manualmente**

1. Registrar uma venda na aba Vendas
2. Tocar no ícone de lápis → tela de edição abre pré-preenchida
3. Alterar a quantidade ou o preço → tocar "Salvar Alterações" → confirmar no Alert
4. A aba de Vendas deve mostrar a venda atualizada (venda original some, nova aparece)
5. Verificar que o estoque foi revertido + recalculado corretamente

- [ ] **Step 9.6: Commit**

```bash
git add db/queries/sales.ts app/(tabs)/sales.tsx app/sale-edit.tsx
git commit -m "feat(sales): botao de editar venda — void + re-registro com formulario pre-preenchido"
```

---

## Self-Review

**Spec coverage:**
- ✅ Busca de cliente no formulário de venda (Task 1)
- ✅ Vales recebidos com forma de pagamento + visível no relatório (Tasks 5–8)
- ✅ Aba Financeiro sem adicionar 6ª tab (Task 8.1)
- ✅ Migration idempotente (IF NOT EXISTS + user_version check)
- ✅ Eventos pullados do backend também gravam no log local (Task 6)
- ✅ TDD em cada task com mudança de lógica
- ✅ Botão de editar venda (Task 9) — void + re-registro, sem backend

**Não coberto neste plano (planos separados):**
- Dark mode → `2026-06-22-dark-mode.md`
- Despesas com sync → plano futuro (requer backend Go)

**Type consistency:**
- `DebtSettlement` definido em `types/index.ts` (Task 2) e usado em `settlements.ts` (Task 4) e `reports.tsx` (Task 8) — consistente.
- `settleCustomerDebt(db, id, amount, paymentMethod)` — assinatura consistente entre Task 5 (implementação) e Task 7 (caller em settle-debt.tsx).
