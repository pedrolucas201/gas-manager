import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, Alert, Switch, Modal, FlatList
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
  const [unitPrice, setUnitPrice] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [isExchange, setIsExchange] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerModalVisible, setCustomerModalVisible] = useState(false);

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone ?? "").includes(customerSearch)
  );

  const load = useCallback(async () => {
    const [cyl, cust] = await Promise.all([getCylinderTypes(db), getCustomers(db)]);
    setCylinders(cyl);
    setCustomers(cust);
    if (cyl.length > 0) selectCylinder(cyl[0]);
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const selectCylinder = (c: CylinderType) => {
    setSelectedCylinder(c);
    setUnitPrice(String(c.sale_price));
  };

  const total = (parseInt(quantity) || 0) * (parseFloat(unitPrice) || 0);

  const handleSave = async () => {
    if (!selectedCylinder) return Alert.alert("Erro", "Selecione um botijão");
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) return Alert.alert("Erro", "Quantidade inválida");
    const price = parseFloat(unitPrice);
    if (!price || price <= 0) return Alert.alert("Erro", "Preço de venda inválido");
    if (paymentMethod === "fiado" && !selectedCustomer) {
      return Alert.alert("Erro", "Selecione um cliente para venda no fiado");
    }

    setSaving(true);
    try {
      await registerSale(db, {
        customer_id: selectedCustomer?.id ?? null,
        cylinder_type_id: selectedCylinder.id,
        quantity: qty,
        unit_price: price,
        cost_price: selectedCylinder.cost_price,
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
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">

        {/* Cylinder type */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Botijão</Text>
          <View className="flex-row gap-2 flex-wrap">
            {cylinders.map((c) => (
              <TouchableOpacity
                key={c.id}
                className={`flex-1 min-w-[80px] rounded-xl p-3 border items-center ${
                  selectedCylinder?.id === c.id
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => selectCylinder(c)}
              >
                <Text className={`font-bold text-base ${selectedCylinder?.id === c.id ? "text-white" : "text-gray-900 dark:text-gray-50"}`}>
                  {c.name}
                </Text>
                <Text className={`text-xs mt-0.5 ${selectedCylinder?.id === c.id ? "text-white opacity-80" : "text-gray-400 dark:text-gray-500"}`}>
                  {formatCurrency(c.sale_price)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quantity */}
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

        {/* Price */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Preço de Venda (R$)</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-3 text-gray-900 dark:text-gray-50 font-semibold"
            keyboardType="decimal-pad"
            value={unitPrice}
            onChangeText={setUnitPrice}
          />
        </View>

        {/* Payment method */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Pagamento</Text>
          <View className="flex-row gap-2 flex-wrap">
            {PAYMENT_METHODS.map((pm) => (
              <TouchableOpacity
                key={pm.key}
                className={`flex-1 min-w-[70px] rounded-xl py-2.5 border items-center ${
                  paymentMethod === pm.key
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                }`}
                onPress={() => setPaymentMethod(pm.key)}
              >
                <Text className={`font-semibold text-sm ${paymentMethod === pm.key ? "text-white" : "text-gray-700 dark:text-gray-300"}`}>
                  {pm.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Exchange toggle */}
        <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex-row items-center justify-between">
          <View>
            <Text className="font-semibold text-gray-900 dark:text-gray-50">Troca de botijão</Text>
            <Text className="text-xs text-gray-400 dark:text-gray-500">Cliente devolveu botijão vazio</Text>
          </View>
          <Switch
            value={isExchange}
            onValueChange={setIsExchange}
            trackColor={{ true: "#f97316" }}
          />
        </View>

        {/* Customer — modal com busca */}
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Cliente {paymentMethod === "fiado" ? "(obrigatório)" : "(opcional)"}
          </Text>
          <TouchableOpacity
            className={`flex-row items-center justify-between bg-white dark:bg-gray-900 border rounded-xl px-4 py-3.5 ${
              paymentMethod === "fiado" && !selectedCustomer
                ? "border-red-300 dark:border-red-700"
                : "border-gray-200 dark:border-gray-700"
            }`}
            onPress={() => setCustomerModalVisible(true)}
          >
            <Text
              className={`text-base ${
                selectedCustomer ? "text-gray-900 dark:text-gray-50 font-medium" : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {selectedCustomer?.name ?? "Sem cliente"}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#9ca3af" />
          </TouchableOpacity>

          <Modal
            visible={customerModalVisible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setCustomerModalVisible(false)}
          >
            <View className="flex-1 bg-gray-50 dark:bg-gray-950">
              <View className="px-4 pt-6 pb-3 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-lg font-bold text-gray-900 dark:text-gray-50">
                    Selecionar cliente
                  </Text>
                  <TouchableOpacity onPress={() => setCustomerModalVisible(false)}>
                    <Ionicons name="close" size={24} color="#6b7280" />
                  </TouchableOpacity>
                </View>
                <View className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex-row items-center px-3">
                  <Ionicons name="search" size={16} color="#9ca3af" />
                  <TextInput
                    className="flex-1 py-2.5 px-2 text-gray-900 dark:text-gray-50"
                    placeholder="Buscar pelo nome ou telefone..."
                    placeholderTextColor="#9ca3af"
                    value={customerSearch}
                    onChangeText={setCustomerSearch}
                    autoFocus
                  />
                  {customerSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setCustomerSearch("")}>
                      <Ionicons name="close-circle" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <FlatList
                data={filteredCustomers}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <TouchableOpacity
                    className="mx-4 mt-3 mb-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3.5 flex-row items-center justify-between"
                    onPress={() => {
                      setSelectedCustomer(null);
                      setCustomerSearch("");
                      setCustomerModalVisible(false);
                    }}
                  >
                    <Text
                      className={`font-medium text-base ${
                        !selectedCustomer ? "text-primary-500" : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      Sem cliente
                    </Text>
                    {!selectedCustomer && (
                      <Ionicons name="checkmark" size={20} color="#f97316" />
                    )}
                  </TouchableOpacity>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    className="mx-4 mb-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3.5 flex-row items-center justify-between"
                    onPress={() => {
                      setSelectedCustomer(item);
                      setCustomerSearch("");
                      setCustomerModalVisible(false);
                    }}
                  >
                    <View className="flex-1 mr-3">
                      <Text
                        className={`font-medium text-base ${
                          selectedCustomer?.id === item.id
                            ? "text-primary-500"
                            : "text-gray-900 dark:text-gray-50"
                        }`}
                      >
                        {item.name}
                      </Text>
                      {item.phone && (
                        <Text className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {item.phone}
                        </Text>
                      )}
                    </View>
                    {selectedCustomer?.id === item.id && (
                      <Ionicons name="checkmark" size={20} color="#f97316" />
                    )}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View className="items-center py-12">
                    <Ionicons name="people-outline" size={40} color="#d1d5db" />
                    <Text className="text-gray-400 dark:text-gray-500 mt-2 font-medium">
                      Nenhum cliente encontrado
                    </Text>
                  </View>
                }
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            </View>
          </Modal>
        </View>

        {/* Total */}
        <View className="bg-primary-50 border border-primary-200 rounded-xl p-4 flex-row items-center justify-between">
          <Text className="text-gray-700 font-semibold">Total</Text>
          <Text className="text-primary-600 font-bold text-xl">{formatCurrency(total)}</Text>
        </View>

        {/* Save button */}
        <TouchableOpacity
          className={`rounded-xl py-4 items-center mb-8 ${saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Salvando..." : "Registrar Venda"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
