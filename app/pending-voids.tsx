import { View, Text, FlatList, TouchableOpacity, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getPendingVoids, discardPendingVoid } from "@/db/queries/sales";
import { approveVoidBatch } from "@/lib/sync/engine";
import { Sale } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type PendingVoid = Sale & { event_uuid: string };

export default function PendingVoidsScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<PendingVoid[]>([]);
  const salesVersion = useAppStore((s) => s.salesVersion);
  const bumpSales = useAppStore((s) => s.bumpSales);
  const bumpInventory = useAppStore((s) => s.bumpInventory);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const load = useCallback(async () => {
    setRows(await getPendingVoids(db));
  }, [db]);

  useEffect(() => { load(); }, [load, salesVersion]);

  const handleKeep = (eventUuid: string, saleId: number) => {
    Alert.alert(
      "Manter venda",
      "Este cancelamento será descartado e a venda mantida.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Manter venda",
          onPress: async () => {
            await discardPendingVoid(db, eventUuid, saleId);
            bumpSales();
            bumpInventory();
            bumpCustomers();
            await load();
          },
        },
      ]
    );
  };

  const handleSendAll = async () => {
    await approveVoidBatch();
    router.back();
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <FlatList
        data={rows}
        keyExtractor={(item) => item.event_uuid}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
        ListHeaderComponent={
          <Text className="mx-4 my-3 text-gray-600 dark:text-gray-300">
            Estes cancelamentos vão apagar as vendas em todos os dispositivos.
            Revise antes de enviar — toque em "Manter venda" para desfazer um cancelamento.
          </Text>
        }
        ListEmptyComponent={
          <Text className="text-center text-gray-500 dark:text-gray-400 mt-16">
            Nenhum cancelamento pendente.
          </Text>
        }
        renderItem={({ item }) => (
          <View className="bg-white dark:bg-gray-900 mx-4 mb-2 rounded-xl p-4 border border-gray-100 dark:border-gray-800 flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="font-bold text-gray-900 dark:text-gray-50">
                {item.quantity}x · {formatCurrency(item.total)}
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {item.customer_name ?? "Sem cliente"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleKeep(item.event_uuid, item.id)}
              className="flex-row items-center gap-1 rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-2"
            >
              <Ionicons name="arrow-undo-outline" size={14} color="#374151" />
              <Text className="font-semibold text-gray-900 dark:text-gray-50 text-sm">Manter venda</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {rows.length > 0 && (
        <TouchableOpacity
          onPress={handleSendAll}
          className="m-4 p-4 rounded-xl bg-red-600 items-center"
        >
          <Text className="text-white font-bold">
            Enviar {rows.length} cancelamento{rows.length > 1 ? "s" : ""}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
