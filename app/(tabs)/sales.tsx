import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getSales, voidSale } from "@/db/queries/sales";
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
            await voidSale(db, id);
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
