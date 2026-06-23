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
  const balanceNum = parseFloat(balance ?? "0");
  const debt = balanceNum < 0 ? Math.abs(balanceNum) : 0;
  const hasDebt = debt > 0;

  const [amount, setAmount] = useState(hasDebt ? String(debt) : "");
  const [paymentMethod, setPaymentMethod] = useState<SettlePaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const handleSettle = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return Alert.alert("Erro", "Valor inválido");
    // Só bloqueia exceder dívida quando há dívida registrada no app
    if (hasDebt && value > debt) {
      return Alert.alert("Erro", `O valor não pode ser maior que a dívida (${formatCurrency(debt)})`);
    }

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
        {/* Info card */}
        <View className={`border rounded-2xl p-4 ${hasDebt ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800" : "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800"}`}>
          <Text className={`text-sm font-medium ${hasDebt ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}`}>{name}</Text>
          {hasDebt ? (
            <>
              <Text className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{formatCurrency(debt)}</Text>
              <Text className="text-xs text-red-400 mt-0.5">Dívida total no app</Text>
            </>
          ) : (
            <>
              <Text className="text-base font-semibold text-orange-700 dark:text-orange-300 mt-1">Sem dívida registrada no app</Text>
              <Text className="text-xs text-orange-400 mt-0.5">Recebimento de dívida anterior ou avulso</Text>
            </>
          )}
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Valor recebido (R$)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-xl font-bold"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            autoFocus
            placeholder="0,00"
            placeholderTextColor="#9ca3af"
          />
        </View>

        {hasDebt && (
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
        )}

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
