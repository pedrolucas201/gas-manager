# Vale Mobile — Bug Fix + Feature Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir double-apply de quitação de vale + permitir registrar recebimento de vale mesmo sem venda anterior no app.

**Architecture:** Duas mudanças independentes: (1) bug fix de dedup no `settleCustomerDebt` — falta inserir na `applied_events`, fazendo o pull re-aplicar o balance bump; (2) feature — remover a restrição `balance < 0` para mostrar o botão de receber vale no customer-detail.

**Tech Stack:** Expo SQLite + Zustand (mobile), TypeScript, Jest (testes).

---

## Diagnóstico do bug

`applySettlement` (pull path) usa `applied_events` para dedup:
```sql
INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)
-- se changes === 0 → já aplicado → return
```

Mas `settleCustomerDebt` (write path local) **não insere** em `applied_events`.
Resultado: quando o evento de quitação volta via pull (pull periódico de 60s),
`applySettlement` encontra o uuid ausente em `applied_events`, aplica `balance + amount`
uma segunda vez — zerando ou invertendo a dívida nova.

**Exemplo:**
- balance = -200 → quita 200 → balance = 0 (OK)
- Pull traz o mesmo evento → balance = 0 + 200 = **+200** (bug)
- Nova venda fiado de 150 → balance = +200 - 150 = **+50**
- `hasDebt = 50 < 0 = false` → botão "Quitar" não aparece

---

## File Map

**Modified:**
- `db/queries/customers.ts` — `settleCustomerDebt`: adicionar uuid em `applied_events` + permitir amount sem cap quando balance >= 0
- `app/customer-detail.tsx` — botão "Receber Vale" sempre visível
- `app/settle-debt.tsx` — remover cap de amount quando balance=0; label contextual
- `db/__tests__/customers.sync.test.ts` — testes novos para o fix e a feature

---

## Task 1: Bug fix — dedup do settleCustomerDebt

**Files:**
- Modify: `db/queries/customers.ts`
- Modify: `db/__tests__/customers.sync.test.ts`

- [ ] **Step 1: Escrever teste que expõe o bug**

Em `db/__tests__/customers.sync.test.ts`, adicionar dentro do `describe("settleCustomerDebt", ...)`:

```typescript
it("inserir em applied_events para que pull não re-aplique o balance", async () => {
  const db = await freshDb();
  const id = await addCustomer(db, { name: "Duplo" });
  await db.runAsync(`UPDATE customers SET balance = -200 WHERE id = ?`, [id]);

  await settleCustomerDebt(db, id, 200, "pix");

  // Simula o pull re-enviando o mesmo evento (como acontece no pull periódico)
  const settlement = await db.getFirstAsync<{ uuid: string }>(
    `SELECT uuid FROM debt_settlements LIMIT 1`
  );
  // applyEvent com o mesmo uuid NÃO deve re-aplicar o balance
  const { applyEvent } = await import("@/lib/sync/apply");
  await applyEvent(db, {
    kind: "debt_settlement",
    data: {
      id: settlement!.uuid,
      customer_id: (await db.getFirstAsync<{ uuid: string }>(
        `SELECT uuid FROM customers WHERE id = ?`, [id]
      ))!.uuid,
      amount: "200",
      payment_method: "pix",
    },
  });

  const c = await db.getFirstAsync<{ balance: number }>(
    `SELECT balance FROM customers WHERE id = ?`, [id]
  );
  // balance deve ser 0 (quitado), não +200 (re-aplicado)
  expect(c?.balance).toBeCloseTo(0, 5);
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```
npx jest db/__tests__/customers.sync.test.ts --no-coverage -t "applied_events"
```

Esperado: FAIL — balance = 200 (o bug acontece).

- [ ] **Step 3: Aplicar o fix em `db/queries/customers.ts`**

Dentro de `settleCustomerDebt`, dentro do `withTransactionAsync`, após o `INSERT INTO debt_settlements`:

```typescript
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

    // Marca em applied_events para que applySettlement (pull path)
    // não re-aplique o mesmo balance bump quando o evento voltar do servidor.
    await db.runAsync(
      `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
      [uuid]
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

- [ ] **Step 4: Rodar o teste corrigido + suite completa**

```
npx jest db/__tests__/customers.sync.test.ts --no-coverage
```

Esperado: todos os testes passando, incluindo o novo.

```
npx jest --no-coverage
```

Esperado: 110+ testes passando (sem regressões).

- [ ] **Step 5: Commit**

```
git add db/queries/customers.ts db/__tests__/customers.sync.test.ts
git commit -m "fix(sync): settleCustomerDebt insere em applied_events para evitar double-apply no pull"
```

---

## Task 2: Feature — Vale recebido sem venda prévia

**Files:**
- Modify: `app/customer-detail.tsx`
- Modify: `app/settle-debt.tsx`

Esta feature não precisa mudar `settleCustomerDebt` — o fix da Task 1 já torna
o fluxo correto para qualquer balance. Aqui só mudamos a UI para permitir o
acesso ao formulário mesmo quando `balance >= 0`.

- [ ] **Step 1: Modificar `app/customer-detail.tsx`**

Encontrar o bloco do botão "Quitar" (linha ~136):

```tsx
{hasDebt && (
  <TouchableOpacity
    className="mt-3 bg-red-500 rounded-xl py-3 flex-row items-center justify-center gap-2"
    onPress={() =>
      router.push({
        pathname: "/settle-debt",
        params: { id: customer.id, name: customer.name, balance: customer.balance },
      })
    }
  >
    <Ionicons name="cash" size={18} color="white" />
    <Text className="text-white font-bold">
      Quitar {formatCurrency(Math.abs(customer.balance))}
    </Text>
  </TouchableOpacity>
)}
```

Substituir por:

```tsx
<TouchableOpacity
  className={`mt-3 rounded-xl py-3 flex-row items-center justify-center gap-2 ${
    hasDebt ? "bg-red-500" : "bg-orange-400"
  }`}
  onPress={() =>
    router.push({
      pathname: "/settle-debt",
      params: { id: customer.id, name: customer.name, balance: customer.balance },
    })
  }
>
  <Ionicons name="cash" size={18} color="white" />
  <Text className="text-white font-bold">
    {hasDebt
      ? `Quitar ${formatCurrency(Math.abs(customer.balance))}`
      : "Receber Vale"}
  </Text>
</TouchableOpacity>
```

- [ ] **Step 2: Modificar `app/settle-debt.tsx`**

O arquivo atual bloqueia amount > debt. Quando `debt === 0` (balance era 0 ou positivo),
isso bloqueia qualquer entrada. A correção: só aplicar o cap quando a dívida é > 0.

Substituir o conteúdo completo de `settle-debt.tsx`:

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
  const { id, name, balance } = useLocalSearchParams<{ id: string; name: string; balance: string }>();
  const balanceNum = parseFloat(balance ?? "0");
  const debt = balanceNum < 0 ? Math.abs(balanceNum) : 0;
  const hasDebt = debt > 0;

  const [amount, setAmount] = useState(hasDebt ? String(debt) : "");
  const [paymentMethod, setPaymentMethod] = useState<SettlePaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const handleSettle = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return Alert.alert("Erro", "Valor inválido");
    // Só bloqueia exceder dívida quando há dívida registrada no app
    if (hasDebt && value > debt) {
      return Alert.alert("Erro", `O valor não pode ser maior que a dívida (${formatCurrency(debt)})`);
    }

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
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        {/* Info card */}
        <View className={`border rounded-2xl p-4 ${hasDebt ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800" : "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800"}`}>
          <Text className={`text-sm font-medium ${hasDebt ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}`}>{name}</Text>
          {hasDebt ? (
            <>
              <Text className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{formatCurrency(debt)}</Text>
              <Text className="text-xs text-red-400 mt-0.5">Dívida total no app</Text>
            </>
          ) : (
            <>
              <Text className="text-base font-semibold text-orange-700 dark:text-orange-300 mt-1">Sem dívida registrada no app</Text>
              <Text className="text-xs text-orange-400 mt-0.5">Recebimento de dívida anterior ou avulso</Text>
            </>
          )}
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Valor recebido (R$)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-xl font-bold"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            autoFocus
            placeholder="0,00"
            placeholderTextColor="#9ca3af"
          />
        </View>

        {hasDebt && (
          <View className="flex-row gap-2">
            {[debt * 0.5, debt].map((preset, idx) => (
              <TouchableOpacity
                key={idx}
                className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 items-center"
                onPress={() => setAmount(String(preset.toFixed(2)))}
              >
                <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {idx === 0 ? "Metade" : "Total"}
                </Text>
                <Text className="text-xs text-gray-400 dark:text-gray-500">{formatCurrency(preset)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Como o cliente pagou?
          </Text>
          <View className="flex-row gap-2">
            {SETTLE_METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                className={`flex-1 rounded-xl py-3 border items-center gap-1 ${
                  paymentMethod === m.key
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
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
                    paymentMethod === m.key ? "text-white" : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"}`}
          onPress={handleSettle}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Registrando..." : "Confirmar Pagamento"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 3: Rodar a suite de testes**

```
npx jest --no-coverage
```

Esperado: todos passando (esta task não muda lógica de negócio com testes, só UI).

- [ ] **Step 4: Commit**

```
git add app/customer-detail.tsx app/settle-debt.tsx
git commit -m "feat(mobile): receber vale sem venda previa + botao sempre visivel"
```

---

## Task 3: Teste de regressão — apply.test.ts

**Files:**
- Modify: `lib/sync/__tests__/apply.test.ts`

Adicionar teste que verifica que `applySettlement` para evento já criado localmente (com uuid em `applied_events`) é corretamente deduplicado:

- [ ] **Step 1: Adicionar teste em `apply.test.ts`**

Encontrar o fim do arquivo e adicionar:

```typescript
describe("applySettlement — dedup com applied_events", () => {
  it("não re-aplica balance se uuid já está em applied_events (evento local)", async () => {
    const db = await freshDb();
    const custUuid = "ccccc000-0000-0000-0000-000000000001";
    const settlementUuid = "dddd0000-0000-0000-0000-000000000001";
    await seedCustomer(db, custUuid, "Teste", -200);

    // Simula que settleCustomerDebt já aplicou o balance e inseriu em applied_events
    await db.runAsync(
      `UPDATE customers SET balance = balance + 200 WHERE uuid = ?`,
      [custUuid]
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
      [settlementUuid]
    );

    // Pull traz o mesmo evento — não deve re-aplicar
    await applyEvent(db, {
      kind: "debt_settlement",
      data: {
        id: settlementUuid,
        customer_id: custUuid,
        amount: "200",
        payment_method: "pix",
      },
    });

    const c = await db.getFirstAsync<{ balance: number }>(
      `SELECT balance FROM customers WHERE uuid = ?`, [custUuid]
    );
    expect(c?.balance).toBeCloseTo(0, 5);
  });

  it("aplica normally quando uuid não está em applied_events (evento de outro device)", async () => {
    const db = await freshDb();
    const custUuid = "ccccc000-0000-0000-0000-000000000002";
    const settlementUuid = "dddd0000-0000-0000-0000-000000000002";
    await seedCustomer(db, custUuid, "Outro", -200);

    await applyEvent(db, {
      kind: "debt_settlement",
      data: {
        id: settlementUuid,
        customer_id: custUuid,
        amount: "200",
        payment_method: "cash",
      },
    });

    const c = await db.getFirstAsync<{ balance: number }>(
      `SELECT balance FROM customers WHERE uuid = ?`, [custUuid]
    );
    expect(c?.balance).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Rodar testes**

```
npx jest lib/sync/__tests__/apply.test.ts --no-coverage
```

Esperado: todos passando.

- [ ] **Step 3: Rodar suite completa**

```
npx jest --no-coverage
```

Esperado: 112+ testes passando.

- [ ] **Step 4: Commit**

```
git add lib/sync/__tests__/apply.test.ts
git commit -m "test(apply): cobertura de dedup do debt_settlement via applied_events"
```

---

## Resumo das mudanças

| Arquivo | Tipo | O que muda |
|---|---|---|
| `db/queries/customers.ts` | fix | `settleCustomerDebt` insere uuid em `applied_events` |
| `app/customer-detail.tsx` | feature | botão "Receber Vale" sempre visível |
| `app/settle-debt.tsx` | feature | sem cap quando balance=0; label contextual |
| `db/__tests__/customers.sync.test.ts` | test | teste do double-apply |
| `lib/sync/__tests__/apply.test.ts` | test | dedup via applied_events |
