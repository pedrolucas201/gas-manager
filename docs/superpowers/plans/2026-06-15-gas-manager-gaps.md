# Gas Manager — Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar todos os gaps funcionais do app: sincronização entre telas via Zustand, edição de cliente e preços, histórico de entradas, tela de detalhe de cliente, cancelar venda e lucro nos relatórios.

**Architecture:** Um store Zustand com contadores de versão por entidade (sales/inventory/customers) serve de "barramento de invalidação" — qualquer tela que muta dados incrementa o contador relevante, e as telas de listagem re-executam o load automaticamente via `useEffect` que depende desse contador. Não há estado de negócio no store, só sinais de refresh.

**Tech Stack:** Expo Router v56, expo-sqlite, Zustand v5, NativeWind v4, TypeScript.

---

## Mapa de Arquivos

**Criar:**
- `store/index.ts` — store Zustand com versões por entidade
- `app/customer-detail.tsx` — tela de detalhe do cliente + histórico de compras

**Modificar:**
- `db/queries/sales.ts` — adicionar `deleteSale`, atualizar `getReportByPeriod` com lucro
- `app/_layout.tsx` — registrar rota `customer-detail`
- `app/sale-form.tsx` — chamar bump após salvar
- `app/restock-form.tsx` — chamar bump após salvar
- `app/customer-form.tsx` — suportar modo edição via params
- `app/settle-debt.tsx` — chamar bump após quitar
- `app/(tabs)/index.tsx` — subscrever versões Zustand
- `app/(tabs)/sales.tsx` — subscrever + botão deletar venda
- `app/(tabs)/inventory.tsx` — subscrever + edição de preços + histórico de entradas
- `app/(tabs)/customers.tsx` — subscrever + botão editar cliente
- `app/(tabs)/reports.tsx` — subscrever + exibir lucro/margem

---

## Task 1: Zustand Store

**Files:**
- Create: `store/index.ts`

- [ ] **Step 1: Criar o store**

```typescript
// store/index.ts
import { create } from "zustand";

interface AppStore {
  salesVersion: number;
  inventoryVersion: number;
  customersVersion: number;
  bumpSales: () => void;
  bumpInventory: () => void;
  bumpCustomers: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  salesVersion: 0,
  inventoryVersion: 0,
  customersVersion: 0,
  bumpSales: () => set((s) => ({ salesVersion: s.salesVersion + 1 })),
  bumpInventory: () => set((s) => ({ inventoryVersion: s.inventoryVersion + 1 })),
  bumpCustomers: () => set((s) => ({ customersVersion: s.customersVersion + 1 })),
}));
```

- [ ] **Step 2: Verificar que o TypeScript aceita**

```bash
npx tsc --noEmit
```

Esperado: sem erros relacionados ao store.

- [ ] **Step 3: Commit**

```bash
git add store/index.ts
git commit -m "feat: add zustand store with per-entity version counters"
```

---

## Task 2: Wire Mutations — sale-form

**Files:**
- Modify: `app/sale-form.tsx`

- [ ] **Step 1: Importar store e chamar bumps após salvar**

Adicionar import no topo do arquivo:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente `SaleFormScreen`, antes do `return`:
```typescript
const bumpSales = useAppStore((s) => s.bumpSales);
const bumpInventory = useAppStore((s) => s.bumpInventory);
const bumpCustomers = useAppStore((s) => s.bumpCustomers);
```

Substituir o bloco `try` dentro de `handleSave`:
```typescript
try {
  await registerSale(db, {
    customer_id: selectedCustomer?.id ?? null,
    cylinder_type_id: selectedCylinder.id,
    quantity: qty,
    unit_price: selectedCylinder.sale_price,
    payment_method: paymentMethod,
    is_exchange: isExchange,
  });
  bumpSales();
  bumpInventory();
  if (paymentMethod === "fiado") bumpCustomers();
  router.back();
} catch (e: any) {
  Alert.alert("Erro", e.message ?? "Falha ao registrar venda");
} finally {
  setSaving(false);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/sale-form.tsx
git commit -m "feat: invalidate zustand versions after sale"
```

---

## Task 3: Wire Mutations — restock-form, customer-form, settle-debt

**Files:**
- Modify: `app/restock-form.tsx`, `app/customer-form.tsx`, `app/settle-debt.tsx`

- [ ] **Step 1: restock-form — bump após salvar**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente, antes do `return`:
```typescript
const bumpInventory = useAppStore((s) => s.bumpInventory);
```

No bloco `try` de `handleSave`, após `addRestock(...)`:
```typescript
await addRestock(db, {
  cylinder_type_id: selected.id,
  quantity: qty,
  cost_per_unit: cost,
  notes: notes.trim() || undefined,
});
bumpInventory();
router.back();
```

- [ ] **Step 2: customer-form — bump após salvar**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente, antes do `return`:
```typescript
const bumpCustomers = useAppStore((s) => s.bumpCustomers);
```

No bloco `try` de `handleSave`, após a operação de DB:
```typescript
bumpCustomers();
router.back();
```

- [ ] **Step 3: settle-debt — bump após quitar**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente, antes do `return`:
```typescript
const bumpCustomers = useAppStore((s) => s.bumpCustomers);
```

No bloco `try` de `handleSettle`, após `settleCustomerDebt(...)`:
```typescript
await settleCustomerDebt(db, parseInt(id!), value);
bumpCustomers();
router.back();
```

- [ ] **Step 4: Commit**

```bash
git add app/restock-form.tsx app/customer-form.tsx app/settle-debt.tsx
git commit -m "feat: invalidate zustand versions after restock, customer, settle"
```

---

## Task 4: Subscribe Screens — Dashboard, Sales, Customers, Reports

**Files:**
- Modify: `app/(tabs)/index.tsx`, `app/(tabs)/sales.tsx`, `app/(tabs)/customers.tsx`, `app/(tabs)/reports.tsx`

- [ ] **Step 1: Dashboard — subscrever salesVersion, inventoryVersion, customersVersion**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente `DashboardScreen`, antes do `return`:
```typescript
const salesVersion = useAppStore((s) => s.salesVersion);
const inventoryVersion = useAppStore((s) => s.inventoryVersion);
const customersVersion = useAppStore((s) => s.customersVersion);
```

Substituir o `useEffect` existente:
```typescript
useEffect(() => { load(); }, [load, salesVersion, inventoryVersion, customersVersion]);
```

- [ ] **Step 2: Sales — subscrever salesVersion**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente `SalesScreen`, antes do `return`:
```typescript
const salesVersion = useAppStore((s) => s.salesVersion);
```

Substituir o `useEffect` existente:
```typescript
useEffect(() => { load(); }, [load, salesVersion]);
```

- [ ] **Step 3: Customers — subscrever customersVersion**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente `CustomersScreen`, antes do `return`:
```typescript
const customersVersion = useAppStore((s) => s.customersVersion);
```

Substituir o `useEffect` existente:
```typescript
useEffect(() => { load(); }, [load, customersVersion]);
```

- [ ] **Step 4: Reports — subscrever salesVersion**

Adicionar import:
```typescript
import { useAppStore } from "@/store";
```

Dentro do componente `ReportsScreen`, antes do `return`:
```typescript
const salesVersion = useAppStore((s) => s.salesVersion);
```

Substituir o `useEffect` existente:
```typescript
useEffect(() => { load(); }, [load, salesVersion]);
```

- [ ] **Step 5: Verificar manualmente**

1. Abrir o app (`npx expo start`)
2. Ir para Dashboard — anotar valores zerados
3. Registrar uma venda via `sale-form`
4. Ao fechar o modal, o Dashboard deve atualizar os números **sem** pull-to-refresh

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/index.tsx app/(tabs)/sales.tsx app/(tabs)/customers.tsx app/(tabs)/reports.tsx
git commit -m "feat: auto-refresh screens via zustand version subscriptions"
```

---

## Task 5: Editar Cliente

**Files:**
- Modify: `app/customer-form.tsx`, `app/(tabs)/customers.tsx`

- [ ] **Step 1: Atualizar customer-form para suportar modo edição**

Substituir o conteúdo completo de `app/customer-form.tsx`:

```typescript
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { addCustomer, updateCustomer } from "@/db/queries/customers";
import { useAppStore } from "@/store";

export default function CustomerFormScreen() {
  const db = useSQLiteContext();
  const { id, initialName, initialPhone, initialAddress } = useLocalSearchParams<{
    id?: string;
    initialName?: string;
    initialPhone?: string;
    initialAddress?: string;
  }>();
  const isEdit = !!id;

  const [name, setName] = useState(initialName ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [saving, setSaving] = useState(false);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert("Erro", "Informe o nome do cliente");

    setSaving(true);
    try {
      if (isEdit) {
        await updateCustomer(db, parseInt(id!), {
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
        });
      } else {
        await addCustomer(db, {
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
        });
      }
      bumpCustomers();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao salvar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Nome *</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-base"
            placeholder="Nome do cliente"
            value={name}
            onChangeText={setName}
            autoFocus={!isEdit}
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Telefone</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-base"
            placeholder="(00) 00000-0000"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Endereço</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
            placeholder="Rua, número, bairro..."
            value={address}
            onChangeText={setAddress}
            multiline
            numberOfLines={2}
          />
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${saving ? "bg-gray-300" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">
            {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Cadastrar Cliente"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Atualizar o título do modal no _layout.tsx conforme modo**

O `_layout.tsx` usa título fixo "Cliente". Isso já está ok para os dois modos. Nenhuma mudança necessária.

- [ ] **Step 3: Adicionar botão de editar em CustomerCard em customers.tsx**

Substituir o componente `CustomerCard` em `app/(tabs)/customers.tsx`:

```typescript
function CustomerCard({ item, onSettle, onEdit }: { item: Customer; onSettle: (c: Customer) => void; onEdit: (c: Customer) => void }) {
  const hasDebt = item.balance < 0;
  return (
    <View className="bg-white mx-4 mb-2 rounded-xl border border-gray-100 overflow-hidden">
      {hasDebt && <View className="h-0.5 bg-red-400" />}
      <View className="p-4">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity className="flex-1" onPress={() => onEdit(item)}>
            <Text className="font-bold text-gray-900">{item.name}</Text>
            {item.phone && (
              <Text className="text-xs text-gray-400">{item.phone}</Text>
            )}
          </TouchableOpacity>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity onPress={() => onEdit(item)} className="p-1">
              <Ionicons name="pencil" size={16} color="#9ca3af" />
            </TouchableOpacity>
            {hasDebt ? (
              <TouchableOpacity
                className="bg-red-500 rounded-lg px-3 py-1.5 ml-1"
                onPress={() => onSettle(item)}
              >
                <Text className="text-white text-xs font-bold">{formatCurrency(Math.abs(item.balance))}</Text>
                <Text className="text-white text-xs opacity-80 text-center">Pagar</Text>
              </TouchableOpacity>
            ) : (
              <View className="bg-green-100 rounded-lg px-3 py-1.5">
                <Text className="text-green-700 text-xs font-semibold">Em dia</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Adicionar handler de edição e atualizar renderItem em CustomersScreen**

Dentro de `CustomersScreen`, adicionar após `handleSettle`:
```typescript
const handleEdit = (customer: Customer) => {
  router.push({
    pathname: "/customer-form",
    params: {
      id: customer.id,
      initialName: customer.name,
      initialPhone: customer.phone ?? "",
      initialAddress: customer.address ?? "",
    },
  });
};
```

Atualizar `renderItem` na FlatList:
```typescript
renderItem={({ item }) => <CustomerCard item={item} onSettle={handleSettle} onEdit={handleEdit} />}
```

- [ ] **Step 5: Commit**

```bash
git add app/customer-form.tsx app/(tabs)/customers.tsx
git commit -m "feat: add edit customer support with prefilled form"
```

---

## Task 6: Editar Preços e Histórico de Entradas no Estoque

**Files:**
- Modify: `app/(tabs)/inventory.tsx`

- [ ] **Step 1: Atualizar query getRestocks para importar e usar no componente**

Adicionar import em `app/(tabs)/inventory.tsx`:
```typescript
import { getInventory, getCylinderTypes, updateInventory, updateCylinderPrice, getRestocks } from "@/db/queries/inventory";
import { Inventory, CylinderType, Restock } from "@/types";
import { useAppStore } from "@/store";
```

- [ ] **Step 2: Adicionar estados para restock history, preços e versão**

Dentro de `InventoryScreen`, adicionar após os estados existentes:
```typescript
const [restocks, setRestocks] = useState<Restock[]>([]);
const [showRestocks, setShowRestocks] = useState(false);
const [editingPrice, setEditingPrice] = useState<number | null>(null);
const [editSalePrice, setEditSalePrice] = useState("");
const [editCostPrice, setEditCostPrice] = useState("");
const inventoryVersion = useAppStore((s) => s.inventoryVersion);
const bumpInventory = useAppStore((s) => s.bumpInventory);
```

- [ ] **Step 3: Atualizar load para buscar restocks e subscrever versão**

Substituir a função `load` e o `useEffect`:
```typescript
const load = useCallback(async () => {
  const [inv, cyl, rst] = await Promise.all([
    getInventory(db),
    getCylinderTypes(db),
    getRestocks(db),
  ]);
  setInventory(inv);
  setCylinders(cyl);
  setRestocks(rst);
}, [db]);

useEffect(() => { load(); }, [load, inventoryVersion]);
```

- [ ] **Step 4: Adicionar handlers de edição de preço**

Após `saveEdit`:
```typescript
const startEditPrice = (item: Inventory) => {
  const cyl = cylinderMap[item.cylinder_type_id];
  if (!cyl) return;
  setEditingPrice(item.cylinder_type_id);
  setEditSalePrice(String(cyl.sale_price));
  setEditCostPrice(String(cyl.cost_price));
};

const savePrice = async (cylinder_type_id: number) => {
  const sale = parseFloat(editSalePrice) || 0;
  const cost = parseFloat(editCostPrice) || 0;
  if (sale <= 0 || cost <= 0) return Alert.alert("Erro", "Preços devem ser maiores que zero");
  await updateCylinderPrice(db, cylinder_type_id, sale, cost);
  bumpInventory();
  setEditingPrice(null);
  await load();
};
```

- [ ] **Step 5: Substituir o conteúdo completo renderizado do ScrollView**

Substituir o `return` completo de `InventoryScreen`:

```typescript
return (
  <ScrollView
    className="flex-1 bg-gray-50"
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
  >
    <View className="px-4 pt-4 pb-2 flex-row items-center justify-between">
      <Text className="text-lg font-bold text-gray-900">Estoque</Text>
      <TouchableOpacity
        className="bg-primary-500 rounded-xl px-4 py-2 flex-row items-center gap-2"
        onPress={() => router.push("/restock-form")}
      >
        <Ionicons name="add" size={16} color="white" />
        <Text className="text-white font-semibold text-sm">Entrada</Text>
      </TouchableOpacity>
    </View>

    {inventory.map((item) => {
      const cyl = cylinderMap[item.cylinder_type_id];
      const isLow = item.full_qty <= 3;
      const isMid = item.full_qty > 3 && item.full_qty <= 8;
      const isEditingQty = editing === item.cylinder_type_id;
      const isEditingPrc = editingPrice === item.cylinder_type_id;

      return (
        <View key={item.id} className="mx-4 mb-3 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <View className={`h-1 ${isLow ? "bg-red-400" : isMid ? "bg-yellow-400" : "bg-green-400"}`} />
          <View className="p-4">
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="font-bold text-gray-900 text-base">{item.cylinder_name}</Text>
                {cyl && (
                  <Text className="text-xs text-gray-400">
                    Venda: {formatCurrency(cyl.sale_price)} · Custo: {formatCurrency(cyl.cost_price)}
                  </Text>
                )}
              </View>
              <View className="flex-row gap-3">
                <TouchableOpacity onPress={() => isEditingPrc ? setEditingPrice(null) : startEditPrice(item)}>
                  <Ionicons name={isEditingPrc ? "close" : "pricetag"} size={18} color="#9ca3af" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => isEditingQty ? setEditing(null) : startEdit(item)}>
                  <Ionicons name={isEditingQty ? "close" : "pencil"} size={18} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            </View>

            {isEditingPrc ? (
              <View className="gap-2">
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs text-gray-500 mb-1">Preço de Venda (R$)</Text>
                    <TextInput
                      className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900"
                      keyboardType="decimal-pad"
                      value={editSalePrice}
                      onChangeText={setEditSalePrice}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs text-gray-500 mb-1">Custo (R$)</Text>
                    <TextInput
                      className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900"
                      keyboardType="decimal-pad"
                      value={editCostPrice}
                      onChangeText={setEditCostPrice}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  className="bg-primary-500 rounded-lg py-2 items-center"
                  onPress={() => savePrice(item.cylinder_type_id)}
                >
                  <Text className="text-white font-semibold">Salvar Preços</Text>
                </TouchableOpacity>
              </View>
            ) : isEditingQty ? (
              <View className="gap-2">
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs text-gray-500 mb-1">Cheios</Text>
                    <TextInput
                      className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900"
                      keyboardType="numeric"
                      value={editFull}
                      onChangeText={setEditFull}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs text-gray-500 mb-1">Vazios</Text>
                    <TextInput
                      className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900"
                      keyboardType="numeric"
                      value={editEmpty}
                      onChangeText={setEditEmpty}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  className="bg-primary-500 rounded-lg py-2 items-center"
                  onPress={() => saveEdit(item.cylinder_type_id)}
                >
                  <Text className="text-white font-semibold">Salvar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="flex-row gap-3">
                <View className="flex-1 bg-green-50 rounded-xl p-3 items-center">
                  <Text className="text-2xl font-bold text-green-700">{item.full_qty}</Text>
                  <Text className="text-xs text-green-600 font-medium">Cheios</Text>
                </View>
                <View className="flex-1 bg-gray-50 rounded-xl p-3 items-center">
                  <Text className="text-2xl font-bold text-gray-500">{item.empty_qty}</Text>
                  <Text className="text-xs text-gray-400 font-medium">Vazios</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      );
    })}

    {/* Restock history */}
    <TouchableOpacity
      className="mx-4 mb-3 flex-row items-center justify-between py-2"
      onPress={() => setShowRestocks((v) => !v)}
    >
      <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest">
        Histórico de Entradas
      </Text>
      <Ionicons name={showRestocks ? "chevron-up" : "chevron-down"} size={16} color="#9ca3af" />
    </TouchableOpacity>

    {showRestocks && (
      <View className="mx-4 mb-4 gap-2">
        {restocks.length === 0 ? (
          <Text className="text-gray-400 text-sm text-center py-4">Nenhuma entrada registrada</Text>
        ) : (
          restocks.map((r) => (
            <View key={r.id} className="bg-white rounded-xl px-4 py-3 border border-gray-100">
              <View className="flex-row items-center justify-between">
                <Text className="font-bold text-gray-900">{r.cylinder_name}</Text>
                <Text className="font-bold text-gray-900">{formatCurrency(r.total_cost)}</Text>
              </View>
              <View className="flex-row items-center justify-between mt-1">
                <Text className="text-xs text-gray-400">
                  {r.quantity} un · {formatCurrency(r.cost_per_unit)}/un
                </Text>
                <Text className="text-xs text-gray-400">
                  {new Date(r.created_at).toLocaleDateString("pt-BR")}
                </Text>
              </View>
              {r.notes && <Text className="text-xs text-gray-400 mt-1 italic">{r.notes}</Text>}
            </View>
          ))
        )}
      </View>
    )}

    <View className="h-8" />
  </ScrollView>
);
```

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/inventory.tsx
git commit -m "feat: add price editing and restock history to inventory screen"
```

---

## Task 7: Tela de Detalhe do Cliente

**Files:**
- Create: `app/customer-detail.tsx`
- Modify: `app/_layout.tsx`
- Modify: `app/(tabs)/customers.tsx`

- [ ] **Step 1: Criar app/customer-detail.tsx**

```typescript
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getCustomerById, getCustomerSales } from "@/db/queries/customers";
import { Customer, PaymentMethod } from "@/types";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const paymentLabels: Record<string, string> = {
  cash: "Dinheiro", pix: "PIX", card: "Cartão", fiado: "Fiado",
};

const paymentColors: Record<string, string> = {
  cash: "bg-green-100 text-green-700",
  pix: "bg-blue-100 text-blue-700",
  card: "bg-purple-100 text-purple-700",
  fiado: "bg-red-100 text-red-700",
};

export default function CustomerDetailScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      getCustomerById(db, parseInt(id!)),
      getCustomerSales(db, parseInt(id!)),
    ]);
    setCustomer(c);
    setSales(s as any[]);
  }, [db, id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const totalSpent = sales.reduce((acc, s) => acc + s.total, 0);
  const hasDebt = (customer?.balance ?? 0) < 0;

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
    >
      {customer && (
        <>
          <View className="mx-4 mt-4 bg-white rounded-2xl border border-gray-100 p-4 mb-3">
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xl font-bold text-gray-900">{customer.name}</Text>
                {customer.phone && (
                  <Text className="text-sm text-gray-500 mt-0.5">{customer.phone}</Text>
                )}
                {customer.address && (
                  <Text className="text-sm text-gray-400 mt-0.5">{customer.address}</Text>
                )}
              </View>
              <TouchableOpacity
                className="p-2"
                onPress={() =>
                  router.push({
                    pathname: "/customer-form",
                    params: {
                      id: customer.id,
                      initialName: customer.name,
                      initialPhone: customer.phone ?? "",
                      initialAddress: customer.address ?? "",
                    },
                  })
                }
              >
                <Ionicons name="pencil" size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-3 mt-3">
              <View className="flex-1 bg-gray-50 rounded-xl p-3 items-center">
                <Text className="text-lg font-bold text-gray-900">{sales.length}</Text>
                <Text className="text-xs text-gray-400">Compras</Text>
              </View>
              <View className="flex-1 bg-gray-50 rounded-xl p-3 items-center">
                <Text className="text-lg font-bold text-gray-900">{formatCurrency(totalSpent)}</Text>
                <Text className="text-xs text-gray-400">Total gasto</Text>
              </View>
            </View>

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
          </View>

          <Text className="px-4 text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
            Histórico de Compras
          </Text>

          {sales.length === 0 ? (
            <View className="items-center py-12">
              <Ionicons name="cart-outline" size={40} color="#d1d5db" />
              <Text className="text-gray-400 mt-2">Nenhuma compra registrada</Text>
            </View>
          ) : (
            <View className="mx-4 gap-2 mb-8">
              {sales.map((s: any) => {
                const colors = paymentColors[s.payment_method as string] ?? "bg-gray-100 text-gray-700";
                const [bg, txt] = colors.split(" ");
                return (
                  <View key={s.id} className="bg-white rounded-xl px-4 py-3 border border-gray-100">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-bold text-gray-900">
                        {s.quantity}x {s.cylinder_name}
                        {s.is_exchange ? " (troca)" : ""}
                      </Text>
                      <Text className="font-bold text-gray-900">{formatCurrency(s.total)}</Text>
                    </View>
                    <View className="flex-row items-center justify-between mt-1">
                      <Text className="text-xs text-gray-400">{formatDate(s.created_at)}</Text>
                      <View className={`rounded-full px-2 py-0.5 ${bg}`}>
                        <Text className={`text-xs font-semibold ${txt}`}>
                          {paymentLabels[s.payment_method as string] ?? s.payment_method}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Registrar rota em app/_layout.tsx**

Adicionar dentro do `<Stack>` em `app/_layout.tsx`, após a rota `settle-debt`:
```typescript
<Stack.Screen
  name="customer-detail"
  options={{ headerShown: true, title: "Cliente", headerStyle: { backgroundColor: "#f97316" }, headerTintColor: "#ffffff" }}
/>
```

- [ ] **Step 3: Tornar o card de cliente clicável em customers.tsx**

Atualizar `CustomerCard` para que tocar no card (fora dos botões) abra o detalhe. Adicionar `onPress` ao `TouchableOpacity` que envolve nome/telefone:

No arquivo `customers.tsx`, atualizar a prop do componente e a navegação:
```typescript
function CustomerCard({ item, onSettle, onEdit, onDetail }: {
  item: Customer;
  onSettle: (c: Customer) => void;
  onEdit: (c: Customer) => void;
  onDetail: (c: Customer) => void;
}) {
```

Atualizar o `TouchableOpacity` interno que envolve nome/telefone:
```typescript
<TouchableOpacity className="flex-1" onPress={() => onDetail(item)}>
```

Adicionar handler `handleDetail` em `CustomersScreen`:
```typescript
const handleDetail = (customer: Customer) => {
  router.push({ pathname: "/customer-detail", params: { id: customer.id } });
};
```

Atualizar `renderItem`:
```typescript
renderItem={({ item }) => (
  <CustomerCard item={item} onSettle={handleSettle} onEdit={handleEdit} onDetail={handleDetail} />
)}
```

- [ ] **Step 4: Commit**

```bash
git add app/customer-detail.tsx app/_layout.tsx app/(tabs)/customers.tsx
git commit -m "feat: add customer detail screen with purchase history"
```

---

## Task 8: Cancelar/Deletar Venda

**Files:**
- Modify: `db/queries/sales.ts`
- Modify: `app/(tabs)/sales.tsx`

- [ ] **Step 1: Adicionar deleteSale em db/queries/sales.ts**

Adicionar ao final do arquivo `db/queries/sales.ts`:

```typescript
export async function deleteSale(db: SQLiteDatabase, id: number) {
  const sale = await db.getFirstAsync<Sale>(`SELECT * FROM sales WHERE id = ?`, [id]);
  if (!sale) return;

  await db.runAsync(
    `UPDATE inventory SET full_qty = full_qty + ?, empty_qty = MAX(0, empty_qty - ?)
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );

  if (sale.payment_method === "fiado" && sale.customer_id) {
    await db.runAsync(
      `UPDATE customers SET balance = balance + ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }

  await db.runAsync(`DELETE FROM sales WHERE id = ?`, [id]);
}
```

- [ ] **Step 2: Adicionar botão de deletar em SaleCard e handler em SalesScreen**

Substituir o conteúdo completo de `app/(tabs)/sales.tsx`:

```typescript
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getSales, deleteSale } from "@/db/queries/sales";
import { Sale, PaymentMethod } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  fiado: "Fiado",
};

const paymentColors: Record<PaymentMethod, string> = {
  cash: "bg-green-100 text-green-700",
  pix: "bg-blue-100 text-blue-700",
  card: "bg-purple-100 text-purple-700",
  fiado: "bg-red-100 text-red-700",
};

function SaleCard({ item, onDelete }: { item: Sale; onDelete: (id: number) => void }) {
  const colors = paymentColors[item.payment_method];
  const [bg, txt] = colors.split(" ");
  return (
    <View className="bg-white mx-4 mb-2 rounded-xl p-4 border border-gray-100">
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1">
          <Text className="font-bold text-gray-900">
            {item.quantity}x {item.cylinder_name}
            {item.is_exchange ? " (troca)" : ""}
          </Text>
          {item.customer_name && (
            <Text className="text-xs text-gray-500">{item.customer_name}</Text>
          )}
        </View>
        <View className="flex-row items-center gap-3">
          <Text className="font-bold text-gray-900 text-base">{formatCurrency(item.total)}</Text>
          <TouchableOpacity onPress={() => onDelete(item.id)} className="p-1">
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
      <View className="flex-row items-center justify-between mt-2">
        <Text className="text-xs text-gray-400">{formatDate(item.created_at)}</Text>
        <View className={`rounded-full px-2 py-0.5 ${bg}`}>
          <Text className={`text-xs font-semibold ${txt}`}>{paymentLabels[item.payment_method]}</Text>
        </View>
      </View>
    </View>
  );
}

export default function SalesScreen() {
  const db = useSQLiteContext();
  const [sales, setSales] = useState<Sale[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const salesVersion = useAppStore((s) => s.salesVersion);
  const bumpSales = useAppStore((s) => s.bumpSales);
  const bumpInventory = useAppStore((s) => s.bumpInventory);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const load = useCallback(async () => {
    const data = await getSales(db);
    setSales(data);
  }, [db]);

  useEffect(() => { load(); }, [load, salesVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleDelete = (id: number) => {
    Alert.alert(
      "Cancelar venda",
      "Deseja cancelar esta venda? O estoque e o saldo do cliente serão restaurados.",
      [
        { text: "Não", style: "cancel" },
        {
          text: "Cancelar venda",
          style: "destructive",
          onPress: async () => {
            await deleteSale(db, id);
            bumpSales();
            bumpInventory();
            bumpCustomers();
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={sales}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <SaleCard item={item} onDelete={handleDelete} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-3">
            <Text className="text-lg font-bold text-gray-900">Últimas Vendas</Text>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="cart-outline" size={48} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 font-medium">Nenhuma venda registrada</Text>
            <Text className="text-gray-300 text-sm">Toque no botão abaixo para adicionar</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      <TouchableOpacity
        className="absolute bottom-6 right-4 bg-primary-500 rounded-full w-14 h-14 items-center justify-center shadow-lg"
        onPress={() => router.push("/sale-form")}
      >
        <Ionicons name="add" size={28} color="white" />
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add db/queries/sales.ts app/(tabs)/sales.tsx
git commit -m "feat: add sale cancellation with inventory and balance rollback"
```

---

## Task 9: Lucro e Margem nos Relatórios

**Files:**
- Modify: `db/queries/sales.ts`
- Modify: `app/(tabs)/reports.tsx`

- [ ] **Step 1: Atualizar getReportByPeriod para incluir custo e lucro**

Em `db/queries/sales.ts`, substituir a função `getReportByPeriod`:

```typescript
export async function getReportByPeriod(
  db: SQLiteDatabase,
  from: string,
  to: string
) {
  return await db.getAllAsync(
    `SELECT
       ct.name as cylinder_name,
       SUM(s.quantity) as total_qty,
       SUM(s.total) as total_revenue,
       SUM(s.quantity * ct.cost_price) as total_cost,
       SUM(s.total) - SUM(s.quantity * ct.cost_price) as total_profit,
       s.payment_method,
       COUNT(*) as num_sales
     FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) BETWEEN ? AND ?
     GROUP BY ct.id, s.payment_method
     ORDER BY total_revenue DESC`,
    [from, to]
  );
}
```

- [ ] **Step 2: Adicionar card de lucro e coluna de margem na tela de relatórios**

Em `app/(tabs)/reports.tsx`, após o cálculo de `paymentTotals`, adicionar:

```typescript
const totalRevenue = rows.reduce((acc: number, r: any) => acc + r.total_revenue, 0);
const totalCost = rows.reduce((acc: number, r: any) => acc + r.total_cost, 0);
const totalProfit = totalRevenue - totalCost;
const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
```

Após o card de faturamento (`<View className="bg-primary-500 ...`), adicionar o card de lucro:

```typescript
{rows.length > 0 && (
  <View className="flex-row gap-3 mb-4">
    <View className="flex-1 bg-white rounded-2xl border border-gray-100 p-4">
      <Text className="text-xs text-gray-500 font-medium mb-1">Lucro</Text>
      <Text className={`text-xl font-bold ${totalProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
        {formatCurrency(totalProfit)}
      </Text>
    </View>
    <View className="flex-1 bg-white rounded-2xl border border-gray-100 p-4">
      <Text className="text-xs text-gray-500 font-medium mb-1">Margem</Text>
      <Text className={`text-xl font-bold ${margin >= 0 ? "text-green-700" : "text-red-600"}`}>
        {margin.toFixed(1)}%
      </Text>
    </View>
  </View>
)}
```

Atualizar a seção "Por Botijão" para mostrar lucro por tipo:

```typescript
{Object.entries(
  rows.reduce((acc: Record<string, { qty: number; revenue: number; profit: number }>, r: any) => {
    acc[r.cylinder_name] = acc[r.cylinder_name] ?? { qty: 0, revenue: 0, profit: 0 };
    acc[r.cylinder_name].qty += r.total_qty;
    acc[r.cylinder_name].revenue += r.total_revenue;
    acc[r.cylinder_name].profit += r.total_profit;
    return acc;
  }, {})
).map(([name, { qty, revenue, profit }], idx, arr) => (
  <View
    key={name}
    className={`px-4 py-3 flex-row items-center justify-between ${idx < arr.length - 1 ? "border-b border-gray-100" : ""}`}
  >
    <View>
      <Text className="text-gray-700 font-medium">{name}</Text>
      <Text className="text-xs text-gray-400">{qty} un · lucro {formatCurrency(profit)}</Text>
    </View>
    <Text className="font-bold text-gray-900">{formatCurrency(revenue)}</Text>
  </View>
))}
```

- [ ] **Step 3: Commit**

```bash
git add db/queries/sales.ts app/(tabs)/reports.tsx
git commit -m "feat: add profit and margin to reports"
```

---

## Verificação Final

- [ ] Registrar uma venda → Dashboard e Relatórios atualizam sem pull-to-refresh
- [ ] Cancelar uma venda → estoque volta, fiado do cliente reverte
- [ ] Editar cliente → dados aparecem preenchidos no form, salvamento atualiza a lista
- [ ] Editar preços → ícone de pricetag abre inputs, salvar reflete nos cards
- [ ] Histórico de entradas → seção colapsável aparece com dados após restock
- [ ] Tela de detalhe → tocar no nome do cliente abre o histórico de compras
- [ ] Relatórios → cards de lucro e margem aparecem quando há vendas no período

```bash
git log --oneline -10
```
