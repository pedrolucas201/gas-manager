import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, Alert, Switch
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { getCylinderTypes } from "@/db/queries/inventory";
import { getCustomers } from "@/db/queries/customers";
import { registerSale } from "@/db/queries/sales";
import { CylinderType, Customer, PaymentMethod } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Dinheiro" },
  { key: "pix", label: "PIX" },
  { key: "card", label: "Cartão" },
  { key: "fiado", label: "Fiado" },
];

export default function SaleFormScreen() {
  const db = useSQLiteContext();
  const [cylinders, setCylinders] = useState<CylinderType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const bumpSales = useAppStore((s) => s.bumpSales);
  const bumpInventory = useAppStore((s) => s.bumpInventory);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const [selectedCylinder, setSelectedCylinder] = useState<CylinderType | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [isExchange, setIsExchange] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [cyl, cust] = await Promise.all([getCylinderTypes(db), getCustomers(db)]);
    setCylinders(cyl);
    setCustomers(cust);
    if (cyl.length > 0) setSelectedCylinder(cyl[0]);
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const total = selectedCylinder
    ? (parseInt(quantity) || 0) * selectedCylinder.sale_price
    : 0;

  const handleSave = async () => {
    if (!selectedCylinder) return Alert.alert("Erro", "Selecione um botijão");
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) return Alert.alert("Erro", "Quantidade inválida");
    if (paymentMethod === "fiado" && !selectedCustomer) {
      return Alert.alert("Erro", "Selecione um cliente para venda no fiado");
    }

    setSaving(true);
    try {
      await registerSale(db, {
        customer_id: selectedCustomer?.id ?? null,
        cylinder_type_id: selectedCylinder.id,
        quantity: qty,
        unit_price: selectedCylinder.sale_price,
        payment_method: paymentMethod,
        is_exchange: isExchange,
      });
      bumpSales();
      bumpInventory();
      if (paymentMethod === "fiado") bumpCustomers();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao registrar venda");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">

        {/* Cylinder type */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Botijão</Text>
          <View className="flex-row gap-2 flex-wrap">
            {cylinders.map((c) => (
              <TouchableOpacity
                key={c.id}
                className={`flex-1 min-w-[80px] rounded-xl p-3 border items-center ${
                  selectedCylinder?.id === c.id
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white border-gray-200"
                }`}
                onPress={() => setSelectedCylinder(c)}
              >
                <Text className={`font-bold text-base ${selectedCylinder?.id === c.id ? "text-white" : "text-gray-900"}`}>
                  {c.name}
                </Text>
                <Text className={`text-xs mt-0.5 ${selectedCylinder?.id === c.id ? "text-white opacity-80" : "text-gray-400"}`}>
                  {formatCurrency(c.sale_price)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quantity */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Quantidade</Text>
          <View className="flex-row items-center bg-white border border-gray-200 rounded-xl overflow-hidden">
            <TouchableOpacity
              className="w-12 h-12 items-center justify-center border-r border-gray-200"
              onPress={() => setQuantity((prev) => String(Math.max(1, (parseInt(prev) || 1) - 1)))}
            >
              <Text className="text-xl font-bold text-gray-600">−</Text>
            </TouchableOpacity>
            <TextInput
              className="flex-1 text-center text-xl font-bold text-gray-900 py-2"
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
            />
            <TouchableOpacity
              className="w-12 h-12 items-center justify-center border-l border-gray-200"
              onPress={() => setQuantity((prev) => String((parseInt(prev) || 0) + 1))}
            >
              <Text className="text-xl font-bold text-gray-600">+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Payment method */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Pagamento</Text>
          <View className="flex-row gap-2 flex-wrap">
            {PAYMENT_METHODS.map((pm) => (
              <TouchableOpacity
                key={pm.key}
                className={`flex-1 min-w-[70px] rounded-xl py-2.5 border items-center ${
                  paymentMethod === pm.key
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white border-gray-200"
                }`}
                onPress={() => setPaymentMethod(pm.key)}
              >
                <Text className={`font-semibold text-sm ${paymentMethod === pm.key ? "text-white" : "text-gray-700"}`}>
                  {pm.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Exchange toggle */}
        <View className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex-row items-center justify-between">
          <View>
            <Text className="font-semibold text-gray-900">Troca de botijão</Text>
            <Text className="text-xs text-gray-400">Cliente devolveu botijão vazio</Text>
          </View>
          <Switch
            value={isExchange}
            onValueChange={setIsExchange}
            trackColor={{ true: "#f97316" }}
          />
        </View>

        {/* Customer */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">
            Cliente {paymentMethod === "fiado" ? "(obrigatório)" : "(opcional)"}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 px-4">
            <View className="flex-row gap-2">
              <TouchableOpacity
                className={`rounded-xl px-4 py-2 border ${!selectedCustomer ? "bg-gray-800 border-gray-800" : "bg-white border-gray-200"}`}
                onPress={() => setSelectedCustomer(null)}
              >
                <Text className={`font-medium text-sm ${!selectedCustomer ? "text-white" : "text-gray-700"}`}>
                  Sem cliente
                </Text>
              </TouchableOpacity>
              {customers.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  className={`rounded-xl px-4 py-2 border ${selectedCustomer?.id === c.id ? "bg-primary-500 border-primary-500" : "bg-white border-gray-200"}`}
                  onPress={() => setSelectedCustomer(c)}
                >
                  <Text className={`font-medium text-sm ${selectedCustomer?.id === c.id ? "text-white" : "text-gray-700"}`}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Total */}
        <View className="bg-primary-50 border border-primary-200 rounded-xl p-4 flex-row items-center justify-between">
          <Text className="text-gray-700 font-semibold">Total</Text>
          <Text className="text-primary-600 font-bold text-xl">{formatCurrency(total)}</Text>
        </View>

        {/* Save button */}
        <TouchableOpacity
          className={`rounded-xl py-4 items-center mb-8 ${saving ? "bg-gray-300" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Salvando..." : "Registrar Venda"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
