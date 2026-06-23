import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getCustomerById, getCustomerSales, deleteCustomer } from "@/db/queries/customers";
import { Customer } from "@/types";
import { useAppStore } from "@/store";
import { triggerManualSync } from "@/lib/sync/engine";

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
  cash: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  pix: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  card: "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300",
  fiado: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
};

export default function CustomerDetailScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const customersVersion = useAppStore((s) => s.customersVersion);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      getCustomerById(db, parseInt(id!)),
      getCustomerSales(db, parseInt(id!)),
    ]);
    setCustomer(c);
    setSales(s as any[]);
  }, [db, id]);

  useEffect(() => { load(); }, [load, customersVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await triggerManualSync();
    await load();
    setRefreshing(false);
  }, [load]);

  const totalSpent = sales.reduce((acc, s) => acc + s.total, 0);
  const hasDebt = (customer?.balance ?? 0) < 0;

  const handleDelete = () => {
    if (!customer) return;
    Alert.alert(
      "Excluir cliente",
      `Tem certeza que deseja excluir "${customer.name}"? As vendas já registradas serão mantidas, mas sem vínculo com o cliente.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCustomer(db, customer.id);
              bumpCustomers();
              router.back();
            } catch (err) {
              Alert.alert("Não foi possível excluir", (err as Error).message);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-gray-950"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
    >
      {customer && (
        <>
          <View className="mx-4 mt-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 mb-3">
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xl font-bold text-gray-900 dark:text-gray-50">{customer.name}</Text>
                {customer.phone && (
                  <Text className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{customer.phone}</Text>
                )}
                {customer.address && (
                  <Text className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">{customer.address}</Text>
                )}
              </View>
              <View className="flex-row items-center gap-1">
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
                <TouchableOpacity className="p-2" onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
            </View>

            <View className="flex-row gap-3 mt-3">
              <View className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3 items-center">
                <Text className="text-lg font-bold text-gray-900 dark:text-gray-50">{sales.length}</Text>
                <Text className="text-xs text-gray-400 dark:text-gray-500">Compras</Text>
              </View>
              <View className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-xl p-3 items-center">
                <Text className="text-lg font-bold text-gray-900 dark:text-gray-50">{formatCurrency(totalSpent)}</Text>
                <Text className="text-xs text-gray-400 dark:text-gray-500">Total gasto</Text>
              </View>
            </View>

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
          </View>

          <Text className="px-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
            Histórico de Compras
          </Text>

          {sales.length === 0 ? (
            <View className="items-center py-12">
              <Ionicons name="cart-outline" size={40} color="#d1d5db" />
              <Text className="text-gray-400 dark:text-gray-500 mt-2">Nenhuma compra registrada</Text>
            </View>
          ) : (
            <View className="mx-4 gap-2 mb-8">
              {sales.map((s: any) => {
                const colors = paymentColors[s.payment_method as string] ?? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300";
                const parts = colors.split(" ");
                const bg = parts.slice(0, 2).join(" ");
                const txt = parts.slice(2).join(" ");
                return (
                  <View key={s.id} className="bg-white dark:bg-gray-900 rounded-xl px-4 py-3 border border-gray-100 dark:border-gray-800">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-bold text-gray-900 dark:text-gray-50">
                        {s.quantity}x {s.cylinder_name}
                        {s.is_exchange ? " (troca)" : ""}
                      </Text>
                      <Text className="font-bold text-gray-900 dark:text-gray-50">{formatCurrency(s.total)}</Text>
                    </View>
                    <View className="flex-row items-center justify-between mt-1">
                      <Text className="text-xs text-gray-400 dark:text-gray-500">{formatDate(s.created_at)}</Text>
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
