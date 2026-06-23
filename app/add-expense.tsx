import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router } from "expo-router";
import { addExpense } from "@/db/queries/expenses";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const CATEGORIES = ["Gasolina", "Manutenção", "Pneu", "Outros"];

export default function AddExpenseScreen() {
  const db = useSQLiteContext();
  const [category, setCategory] = useState("Gasolina");
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const bumpExpenses = useAppStore((s) => s.bumpExpenses);

  const isCustom = category === "Outros";
  const finalCategory =
    isCustom && customCategory.trim() ? customCategory.trim() : category;

  const handleSave = async () => {
    const value = parseFloat(amount.replace(",", "."));
    if (!value || value <= 0) return Alert.alert("Erro", "Informe um valor válido");
    if (isCustom && !customCategory.trim()) {
      return Alert.alert("Erro", "Informe a categoria");
    }

    setSaving(true);
    try {
      await addExpense(db, {
        category: finalCategory,
        description: description.trim() || undefined,
        amount: value,
      });
      bumpExpenses();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao registrar despesa");
    } finally {
      setSaving(false);
    }
  };

  const parsedAmount = parseFloat(amount.replace(",", "."));
  const totalPreview = !isNaN(parsedAmount) && parsedAmount > 0
    ? formatCurrency(parsedAmount)
    : null;

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-gray-950"
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-4 pt-4 gap-4">
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Categoria
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                className={`rounded-xl px-4 py-2.5 border ${
                  category === cat
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => setCategory(cat)}
              >
                <Text
                  className={`font-semibold text-sm ${
                    category === cat ? "text-white" : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {isCustom && (
            <TextInput
              className="mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50"
              placeholder="Nome da categoria..."
              placeholderTextColor="#9ca3af"
              value={customCategory}
              onChangeText={setCustomCategory}
              autoFocus
            />
          )}
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Valor (R$)
          </Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-xl font-bold"
            keyboardType="decimal-pad"
            placeholder="0,00"
            placeholderTextColor="#9ca3af"
            value={amount}
            onChangeText={setAmount}
          />
          {totalPreview && (
            <Text className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">
              {totalPreview}
            </Text>
          )}
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Descrição (opcional)
          </Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50"
            placeholder="Ex: Posto BR, km 12.400..."
            placeholderTextColor="#9ca3af"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
          />
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${
            saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"
          }`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">
            {saving ? "Salvando..." : "Registrar Despesa"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
