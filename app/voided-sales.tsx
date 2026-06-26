import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { getVoidedSales, unvoidSale } from "@/db/queries/sales";
import { Sale, PaymentMethod } from "@/types";
import { useAppStore } from "@/store";
import { triggerManualSync } from "@/lib/sync/engine";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  fiado: "Fiado",
};

function VoidedCard({ item, onRestore }: { item: Sale; onRestore: (id: number) => void }) {
  return (
    <View className="bg-white dark:bg-gray-900 mx-4 mb-2 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1">
          <Text className="font-bold text-gray-900 dark:text-gray-50">
            {item.quantity}x {item.cylinder_name}
            {item.is_exchange ? " (troca)" : ""}
          </Text>
          {item.customer_name && (
            <Text className="text-xs text-gray-500 dark:text-gray-400">{item.customer_name}</Text>
          )}
          <Text className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Cancelada em {formatDate(item.voided_at)}
          </Text>
        </View>
        <View className="items-end gap-2">
          <Text className="font-bold text-gray-900 dark:text-gray-50 text-base">{formatCurrency(item.total)}</Text>
          <TouchableOpacity
            onPress={() => onRestore(item.id)}
            className="flex-row items-center gap-1 rounded-lg bg-orange-500 px-3 py-2"
          >
            <Ionicons name="arrow-undo-outline" size={14} color="#ffffff" />
            <Text className="text-white font-semibold text-sm">Restaurar</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View className="self-start rounded-full px-2 py-0.5 bg-red-100 dark:bg-red-900 mt-1">
        <Text className="text-xs font-semibold text-red-700 dark:text-red-300">
          {paymentLabels[item.payment_method]} · cancelada
        </Text>
      </View>
    </View>
  );
}

export default function VoidedSalesScreen() {
  const db = useSQLiteContext();
  const [sales, setSales] = useState<Sale[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const salesVersion = useAppStore((s) => s.salesVersion);
  const bumpSales = useAppStore((s) => s.bumpSales);
  const bumpInventory = useAppStore((s) => s.bumpInventory);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const load = useCallback(async () => {
    setSales(await getVoidedSales(db));
  }, [db]);

  useEffect(() => { load(); }, [load, salesVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await triggerManualSync();
    await load();
    setRefreshing(false);
  }, [load]);

  const handleRestore = (id: number) => {
    Alert.alert(
      "Restaurar venda",
      "A venda volta a contar no faturamento, no estoque e no saldo do cliente.",
      [
        { text: "Não", style: "cancel" },
        {
          text: "Restaurar",
          onPress: async () => {
            await unvoidSale(db, id);
            bumpSales();
            bumpInventory();
            bumpCustomers();
            await load();
            triggerManualSync();
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <FlatList
        data={sales}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <VoidedCard item={item} onRestore={handleRestore} />}
        contentContainerStyle={{ paddingTop: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
        ListEmptyComponent={
          <Text className="text-center text-gray-500 dark:text-gray-400 mt-16">
            Nenhuma venda cancelada.
          </Text>
        }
      />
    </View>
  );
}
