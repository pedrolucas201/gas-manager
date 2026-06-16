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

function CustomerCard({ item, onSettle }: { item: Customer; onSettle: (c: Customer) => void }) {
  const hasDebt = item.balance < 0;
  return (
    <View className="bg-white mx-4 mb-2 rounded-xl border border-gray-100 overflow-hidden">
      {hasDebt && <View className="h-0.5 bg-red-400" />}
      <View className="p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="font-bold text-gray-900">{item.name}</Text>
            {item.phone && (
              <Text className="text-xs text-gray-400">{item.phone}</Text>
            )}
          </View>
          {hasDebt ? (
            <TouchableOpacity
              className="bg-red-500 rounded-lg px-3 py-1.5 ml-2"
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

  const debtors = customers.filter((c) => c.balance < 0);
  const totalDebt = debtors.reduce((acc, c) => acc + Math.abs(c.balance), 0);

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <CustomerCard item={item} onSettle={handleSettle} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-3">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-gray-900">Clientes</Text>
              <TouchableOpacity
                className="bg-primary-500 rounded-xl px-3 py-2"
                onPress={() => router.push("/customer-form")}
              >
                <Ionicons name="add" size={18} color="white" />
              </TouchableOpacity>
            </View>

            {debtors.length > 0 && (
              <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 flex-row items-center">
                <Ionicons name="alert-circle" size={18} color="#dc2626" />
                <Text className="text-red-700 text-sm ml-2 font-medium">
                  {debtors.length} devedor(es) · {formatCurrency(totalDebt)} total
                </Text>
              </View>
            )}

            <View className="bg-white border border-gray-200 rounded-xl flex-row items-center px-3">
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput
                className="flex-1 py-2.5 px-2 text-gray-900"
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
            <Text className="text-gray-400 mt-3 font-medium">Nenhum cliente encontrado</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
}
