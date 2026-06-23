import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { getCylinderTypes, addRestock } from "@/db/queries/inventory";
import { CylinderType } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function RestockFormScreen() {
  const db = useSQLiteContext();
  const [cylinders, setCylinders] = useState<CylinderType[]>([]);
  const [selected, setSelected] = useState<CylinderType | null>(null);
  const [quantity, setQuantity] = useState("10");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const bumpInventory = useAppStore((s) => s.bumpInventory);

  const load = useCallback(async () => {
    const cyl = await getCylinderTypes(db);
    setCylinders(cyl);
    if (cyl.length > 0) {
      setSelected(cyl[0]);
      setCostPerUnit(String(cyl[0].cost_price));
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const handleSelectCylinder = (c: CylinderType) => {
    setSelected(c);
    setCostPerUnit(String(c.cost_price));
  };

  const total = (parseInt(quantity) || 0) * (parseFloat(costPerUnit) || 0);

  const handleSave = async () => {
    if (!selected) return Alert.alert("Erro", "Selecione um botijão");
    const qty = parseInt(quantity);
    const cost = parseFloat(costPerUnit);
    if (!qty || qty <= 0) return Alert.alert("Erro", "Quantidade inválida");
    if (!cost || cost <= 0) return Alert.alert("Erro", "Custo inválido");

    setSaving(true);
    try {
      await addRestock(db, {
        cylinder_type_id: selected.id,
        quantity: qty,
        cost_per_unit: cost,
        notes: notes.trim() || undefined,
      });
      bumpInventory();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao registrar entrada");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Botijão</Text>
          <View className="flex-row gap-2 flex-wrap">
            {cylinders.map((c) => (
              <TouchableOpacity
                key={c.id}
                className={`flex-1 min-w-[80px] rounded-xl p-3 border items-center ${
                  selected?.id === c.id
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => handleSelectCylinder(c)}
              >
                <Text className={`font-bold text-base ${selected?.id === c.id ? "text-white" : "text-gray-900 dark:text-gray-50"}`}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Quantidade</Text>
          <View className="flex-row items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <TouchableOpacity
              className="w-12 h-12 items-center justify-center border-r border-gray-200 dark:border-gray-700"
              onPress={() => setQuantity((prev) => String(Math.max(1, (parseInt(prev) || 1) - 1)))}
            >
              <Text className="text-xl font-bold text-gray-600 dark:text-gray-300">−</Text>
            </TouchableOpacity>
            <TextInput
              className="flex-1 text-center text-xl font-bold text-gray-900 dark:text-gray-50 py-2"
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
            />
            <TouchableOpacity
              className="w-12 h-12 items-center justify-center border-l border-gray-200 dark:border-gray-700"
              onPress={() => setQuantity((prev) => String((parseInt(prev) || 0) + 1))}
            >
              <Text className="text-xl font-bold text-gray-600 dark:text-gray-300">+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Custo por unidade (R$)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
            keyboardType="decimal-pad"
            placeholder="0,00"
            placeholderTextColor="#9ca3af"
            value={costPerUnit}
            onChangeText={setCostPerUnit}
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Observações (opcional)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50"
            placeholder="Ex: Fornecedor X, NF 123..."
            placeholderTextColor="#9ca3af"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={2}
          />
        </View>

        <View className="bg-primary-50 border border-primary-200 rounded-xl p-4 flex-row items-center justify-between">
          <Text className="text-gray-700 font-semibold">Custo Total</Text>
          <Text className="text-primary-600 font-bold text-xl">{formatCurrency(total)}</Text>
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mb-8 ${saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Salvando..." : "Registrar Entrada"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
