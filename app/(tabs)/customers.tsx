import { View, Text, FlatList, TouchableOpacity, RefreshControl, TextInput } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getCustomers } from "@/db/queries/customers";
import { Customer } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function CustomerCard({ item, onSettle, onEdit, onDetail }: { item: Customer; onSettle: (c: Customer) => void; onEdit: (c: Customer) => void; onDetail: (c: Customer) => void }) {
  const hasDebt = item.balance < 0;
  return (
    <View className="bg-white dark:bg-gray-900 mx-4 mb-2 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      {hasDebt && <View className="h-0.5 bg-red-400" />}
      <View className="p-4">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity className="flex-1" onPress={() => onDetail(item)}>
            <Text className="font-bold text-gray-900 dark:text-gray-50">{item.name}</Text>
            {item.phone && (
              <Text className="text-xs text-gray-400 dark:text-gray-500">{item.phone}</Text>
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
              <View className="bg-green-100 dark:bg-green-900 rounded-lg px-3 py-1.5">
                <Text className="text-green-700 dark:text-green-300 text-xs font-semibold">Em dia</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

export default function CustomersScreen() {
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filtered, setFiltered] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const customersVersion = useAppStore((s) => s.customersVersion);

  const load = useCallback(async () => {
    const data = await getCustomers(db);
    setCustomers(data);
    setFiltered(data);
  }, [db]);

  useEffect(() => { load(); }, [load, customersVersion]);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(customers);
    } else {
      setFiltered(
        customers.filter((c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.phone ?? "").includes(search)
        )
      );
    }
  }, [search, customers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleSettle = (customer: Customer) => {
    router.push({ pathname: "/settle-debt", params: { id: customer.id, name: customer.name, balance: customer.balance } });
  };

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

  const handleDetail = (customer: Customer) => {
    router.push({ pathname: "/customer-detail", params: { id: customer.id } });
  };

  const debtors = customers.filter((c) => c.balance < 0);
  const totalDebt = debtors.reduce((acc, c) => acc + Math.abs(c.balance), 0);

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <CustomerCard item={item} onSettle={handleSettle} onEdit={handleEdit} onDetail={handleDetail} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-3">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-gray-900 dark:text-gray-50">Clientes</Text>
              <TouchableOpacity
                className="bg-primary-500 rounded-xl px-3 py-2"
                onPress={() => router.push("/customer-form")}
              >
                <Ionicons name="add" size={18} color="white" />
              </TouchableOpacity>
            </View>

            {debtors.length > 0 && (
              <View className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-3 flex-row items-center">
                <Ionicons name="alert-circle" size={18} color="#dc2626" />
                <Text className="text-red-700 dark:text-red-400 text-sm ml-2 font-medium">
                  {debtors.length} devedor(es) · {formatCurrency(totalDebt)} total
                </Text>
              </View>
            )}

            <View className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex-row items-center px-3">
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput
                className="flex-1 py-2.5 px-2 text-gray-900 dark:text-gray-50"
                placeholder="Buscar cliente..."
                placeholderTextColor="#9ca3af"
                value={search}
                onChangeText={setSearch}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="people-outline" size={48} color="#d1d5db" />
            <Text className="text-gray-400 dark:text-gray-500 mt-3 font-medium">Nenhum cliente encontrado</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
}
