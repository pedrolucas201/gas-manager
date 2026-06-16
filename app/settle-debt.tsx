import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { settleCustomerDebt } from "@/db/queries/customers";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function SettleDebtScreen() {
  const db = useSQLiteContext();
  const { id, name, balance } = useLocalSearchParams<{ id: string; name: string; balance: string }>();
  const debt = Math.abs(parseFloat(balance ?? "0"));

  const [amount, setAmount] = useState(String(debt));
  const [saving, setSaving] = useState(false);

  const handleSettle = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return Alert.alert("Erro", "Valor inválido");
    if (value > debt) return Alert.alert("Erro", `O valor não pode ser maior que a dívida (${formatCurrency(debt)})`);

    setSaving(true);
    try {
      await settleCustomerDebt(db, parseInt(id!), value);
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao registrar pagamento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        <View className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <Text className="text-sm text-red-600 font-medium">{name}</Text>
          <Text className="text-2xl font-bold text-red-700 mt-1">{formatCurrency(debt)}</Text>
          <Text className="text-xs text-red-400 mt-0.5">Dívida total</Text>
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Valor recebido (R$)</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-xl font-bold"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            autoFocus
          />
        </View>

        <View className="flex-row gap-2">
          {[debt * 0.5, debt].map((preset, idx) => (
            <TouchableOpacity
              key={idx}
              className="flex-1 bg-white border border-gray-200 rounded-xl py-2.5 items-center"
              onPress={() => setAmount(String(preset.toFixed(2)))}
            >
              <Text className="text-sm font-semibold text-gray-700">
                {idx === 0 ? "Metade" : "Total"}
              </Text>
              <Text className="text-xs text-gray-400">{formatCurrency(preset)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${saving ? "bg-gray-300" : "bg-primary-500"}`}
          onPress={handleSettle}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Registrando..." : "Confirmar Pagamento"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
