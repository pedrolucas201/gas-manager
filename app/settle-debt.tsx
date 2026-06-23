import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { settleCustomerDebt } from "@/db/queries/customers";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type SettlePaymentMethod = "cash" | "pix" | "card";

const SETTLE_METHODS: { key: SettlePaymentMethod; label: string; icon: string }[] = [
  { key: "cash", label: "Dinheiro", icon: "cash-outline" },
  { key: "pix", label: "PIX", icon: "phone-portrait-outline" },
  { key: "card", label: "Cartão", icon: "card-outline" },
];

export default function SettleDebtScreen() {
  const db = useSQLiteContext();
  const { id, name, balance } = useLocalSearchParams<{ id: string; name: string; balance: string }>();
  const debt = Math.abs(parseFloat(balance ?? "0"));

  const [amount, setAmount] = useState(String(debt));
  const [paymentMethod, setPaymentMethod] = useState<SettlePaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const handleSettle = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return Alert.alert("Erro", "Valor inválido");
    if (value > debt) return Alert.alert("Erro", `O valor não pode ser maior que a dívida (${formatCurrency(debt)})`);

    setSaving(true);
    try {
      await settleCustomerDebt(db, parseInt(id!), value, paymentMethod);
      bumpCustomers();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao registrar pagamento");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        <View className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-4">
          <Text className="text-sm text-red-600 dark:text-red-400 font-medium">{name}</Text>
          <Text className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{formatCurrency(debt)}</Text>
          <Text className="text-xs text-red-400 mt-0.5">Dívida total</Text>
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Valor recebido (R$)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-xl font-bold"
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
              className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 items-center"
              onPress={() => setAmount(String(preset.toFixed(2)))}
            >
              <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {idx === 0 ? "Metade" : "Total"}
              </Text>
              <Text className="text-xs text-gray-400 dark:text-gray-500">{formatCurrency(preset)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Como o cliente pagou?
          </Text>
          <View className="flex-row gap-2">
            {SETTLE_METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                className={`flex-1 rounded-xl py-3 border items-center gap-1 ${
                  paymentMethod === m.key
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => setPaymentMethod(m.key)}
              >
                <Ionicons
                  name={m.icon as any}
                  size={20}
                  color={paymentMethod === m.key ? "#ffffff" : "#6b7280"}
                />
                <Text
                  className={`text-xs font-semibold ${
                    paymentMethod === m.key ? "text-white" : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"}`}
          onPress={handleSettle}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Registrando..." : "Confirmar Pagamento"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
