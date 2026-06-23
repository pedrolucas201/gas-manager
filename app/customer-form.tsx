import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { addCustomer, updateCustomer } from "@/db/queries/customers";
import { useAppStore } from "@/store";

export default function CustomerFormScreen() {
  const db = useSQLiteContext();
  const { id, initialName, initialPhone, initialAddress } = useLocalSearchParams<{
    id?: string;
    initialName?: string;
    initialPhone?: string;
    initialAddress?: string;
  }>();
  const isEdit = !!id;

  const [name, setName] = useState(initialName ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [saving, setSaving] = useState(false);
  const bumpCustomers = useAppStore((s) => s.bumpCustomers);

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert("Erro", "Informe o nome do cliente");

    setSaving(true);
    try {
      if (isEdit) {
        await updateCustomer(db, parseInt(id!), {
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
        });
      } else {
        await addCustomer(db, {
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
        });
      }
      bumpCustomers();
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao salvar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Nome *</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
            placeholder="Nome do cliente"
            placeholderTextColor="#9ca3af"
            value={name}
            onChangeText={setName}
            autoFocus={!isEdit}
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Telefone</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50 text-base"
            placeholder="(00) 00000-0000"
            placeholderTextColor="#9ca3af"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Endereço</Text>
          <TextInput
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-gray-50"
            placeholder="Rua, número, bairro..."
            placeholderTextColor="#9ca3af"
            value={address}
            onChangeText={setAddress}
            multiline
            numberOfLines={2}
          />
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${saving ? "bg-gray-300 dark:bg-gray-700" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">
            {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Cadastrar Cliente"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
