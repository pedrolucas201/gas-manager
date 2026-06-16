import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getCustomerById, getCustomerSales } from "@/db/queries/customers";
import { Customer } from "@/types";

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
