import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { router } from "expo-router";
import { addCustomer } from "@/db/queries/customers";

export default function CustomerFormScreen() {
  const db = useSQLiteContext();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert("Erro", "Informe o nome do cliente");

    setSaving(true);
    try {
      await addCustomer(db, { name: name.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined });
      router.back();
    } catch (e: any) {
      Alert.alert("Erro", e.message ?? "Falha ao salvar cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-4 gap-4">
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Nome *</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-base"
            placeholder="Nome do cliente"
            value={name}
            onChangeText={setName}
            autoFocus
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Telefone</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-base"
            placeholder="(00) 00000-0000"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-2">Endereço</Text>
          <TextInput
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
            placeholder="Rua, número, bairro..."
            value={address}
            onChangeText={setAddress}
            multiline
            numberOfLines={2}
          />
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 items-center mt-2 mb-8 ${saving ? "bg-gray-300" : "bg-primary-500"}`}
          onPress={handleSave}
          disabled={saving}
        >
          <Text className="text-white font-bold text-base">{saving ? "Salvando..." : "Cadastrar Cliente"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
