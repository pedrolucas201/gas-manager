import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert, TextInput } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getInventory, getCylinderTypes, updateInventory, updateCylinderPrice, getRestocks } from "@/db/queries/inventory";
import { Inventory, CylinderType, Restock } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function InventoryScreen() {
  const db = useSQLiteContext();
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [cylinders, setCylinders] = useState<CylinderType[]>([]);
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editFull, setEditFull] = useState("");
  const [editEmpty, setEditEmpty] = useState("");
  const [editingPrice, setEditingPrice] = useState<number | null>(null);
  const [editSalePrice, setEditSalePrice] = useState("");
  const [editCostPrice, setEditCostPrice] = useState("");
  const [showRestocks, setShowRestocks] = useState(false);
  const inventoryVersion = useAppStore((s) => s.inventoryVersion);
  const bumpInventory = useAppStore((s) => s.bumpInventory);

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const startEdit = (item: Inventory) => {
    setEditing(item.cylinder_type_id);
    setEditFull(String(item.full_qty));
    setEditEmpty(String(item.empty_qty));
  };

  const saveEdit = async (cylinder_type_id: number) => {
    const full = parseInt(editFull) || 0;
    const empty = parseInt(editEmpty) || 0;
    await updateInventory(db, cylinder_type_id, full, empty);
    setEditing(null);
    await load();
  };

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

  const cylinderMap = Object.fromEntries(cylinders.map((c) => [c.id, c]));

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
}
