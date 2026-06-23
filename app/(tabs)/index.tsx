import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getDashboardStats } from "@/db/queries/sales";
import { getInventory } from "@/db/queries/inventory";
import { getDebtors } from "@/db/queries/customers";
import { DashboardStats, Inventory, Customer } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 flex-1 shadow-sm border border-gray-100 dark:border-gray-800">
      <Text className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">{label}</Text>
      <Text className="text-xl font-bold text-gray-900 dark:text-gray-50">{value}</Text>
      {sub && <Text className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</Text>}
    </View>
  );
}

export default function DashboardScreen() {
  const db = useSQLiteContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [debtors, setDebtors] = useState<Customer[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const salesVersion = useAppStore((s) => s.salesVersion);
  const inventoryVersion = useAppStore((s) => s.inventoryVersion);
  const customersVersion = useAppStore((s) => s.customersVersion);

  const load = useCallback(async () => {
    const [s, inv, dbt] = await Promise.all([
      getDashboardStats(db),
      getInventory(db),
      getDebtors(db),
    ]);
    setStats(s);
    setInventory(inv);
    setDebtors(dbt);
  }, [db]);

  useEffect(() => { load(); }, [load, salesVersion, inventoryVersion, customersVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const totalDebt = debtors.reduce((acc, c) => acc + Math.abs(c.balance), 0);

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-gray-950"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
    >
      <View className="bg-primary-500 px-5 pt-14 pb-6">
        <Text className="text-white text-sm font-medium opacity-80">Bem-vindo</Text>
        <Text className="text-white text-2xl font-bold">Beto Gas</Text>
      </View>

      <View className="px-4 -mt-4 mb-4">
        <TouchableOpacity
          className="bg-white dark:bg-gray-900 rounded-2xl p-4 flex-row items-center shadow border border-gray-100 dark:border-gray-800"
          onPress={() => router.push("/sale-form")}
        >
          <View className="bg-primary-500 rounded-xl w-10 h-10 items-center justify-center mr-3">
            <Ionicons name="add" size={24} color="white" />
          </View>
          <View className="flex-1">
            <Text className="font-bold text-gray-900 dark:text-gray-50">Nova Venda</Text>
            <Text className="text-xs text-gray-400 dark:text-gray-500">Registrar venda de botijão</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text className="px-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Hoje</Text>
      <View className="px-4 flex-row gap-3 mb-4">
        <StatCard
          label="Faturamento"
          value={formatCurrency(stats?.today_revenue ?? 0)}
          sub={`${stats?.today_sales ?? 0} botijões`}
        />
        <StatCard
          label="Esta Semana"
          value={formatCurrency(stats?.week_revenue ?? 0)}
          sub={`${stats?.week_sales ?? 0} botijões`}
        />
      </View>

      <View className="px-4 mb-4">
        <View className="bg-primary-500 rounded-2xl p-4 flex-row items-center justify-between">
          <View>
            <Text className="text-white text-xs opacity-80 font-medium mb-1">Faturamento do Mês</Text>
            <Text className="text-white text-2xl font-bold">{formatCurrency(stats?.month_revenue ?? 0)}</Text>
            <Text className="text-white text-xs opacity-70">{stats?.month_sales ?? 0} botijões vendidos</Text>
          </View>
          <Ionicons name="trending-up" size={40} color="rgba(255,255,255,0.4)" />
        </View>
      </View>

      <Text className="px-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Estoque</Text>
      <View className="px-4 mb-4 gap-2">
        {inventory.map((item) => (
          <View key={item.id} className="bg-white dark:bg-gray-900 rounded-xl px-4 py-3 flex-row items-center border border-gray-100 dark:border-gray-800">
            <View className="flex-1">
              <Text className="font-bold text-gray-900 dark:text-gray-50">{item.cylinder_name}</Text>
              <Text className="text-xs text-gray-400 dark:text-gray-500">
                {item.full_qty} cheios · {item.empty_qty} vazios
              </Text>
            </View>
            <View
              className={`rounded-full px-3 py-1 ${
                item.full_qty <= 3 ? "bg-red-100 dark:bg-red-900" : item.full_qty <= 8 ? "bg-yellow-100 dark:bg-yellow-900" : "bg-green-100 dark:bg-green-900"
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  item.full_qty <= 3 ? "text-red-600 dark:text-red-300" : item.full_qty <= 8 ? "text-yellow-700 dark:text-yellow-300" : "text-green-700 dark:text-green-300"
                }`}
              >
                {item.full_qty <= 3 ? "Baixo" : item.full_qty <= 8 ? "Médio" : "OK"}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {debtors.length > 0 && (
        <>
          <Text className="px-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Fiado</Text>
          <TouchableOpacity
            className="mx-4 mb-6 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex-row items-center"
            onPress={() => router.push("/(tabs)/customers")}
          >
            <Ionicons name="warning" size={22} color="#dc2626" />
            <View className="ml-3 flex-1">
              <Text className="font-bold text-red-700 dark:text-red-400">{debtors.length} cliente(s) com fiado</Text>
              <Text className="text-xs text-red-500 dark:text-red-400">Total devido: {formatCurrency(totalDebt)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#dc2626" />
          </TouchableOpacity>
        </>
      )}

      <View className="h-6" />
    </ScrollView>
  );
}
