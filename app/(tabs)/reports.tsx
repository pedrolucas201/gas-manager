import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { getReportByPeriod, getDashboardStats } from "@/db/queries/sales";
import { DashboardStats } from "@/types";
import { useAppStore } from "@/store";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getDateRange(period: "today" | "week" | "month") {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { from: fmt(start), to: today };
  }
  return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: today };
}

type Period = "today" | "week" | "month";

const periodLabels: Record<Period, string> = {
  today: "Hoje",
  week: "7 dias",
  month: "Este mês",
};

export default function ReportsScreen() {
  const db = useSQLiteContext();
  const [period, setPeriod] = useState<Period>("today");
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const salesVersion = useAppStore((s) => s.salesVersion);

  const load = useCallback(async () => {
    const { from, to } = getDateRange(period);
    const [reportRows, dashStats] = await Promise.all([
      getReportByPeriod(db, from, to),
      getDashboardStats(db),
    ]);
    setRows(reportRows as any[]);
    setStats(dashStats);
  }, [db, period]);

  useEffect(() => { load(); }, [load, salesVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const currentRevenue =
    period === "today" ? stats?.today_revenue :
    period === "week" ? stats?.week_revenue :
    stats?.month_revenue;

  const currentSales =
    period === "today" ? stats?.today_sales :
    period === "week" ? stats?.week_sales :
    stats?.month_sales;

  const paymentTotals: Record<string, number> = {};
  rows.forEach((r: any) => {
    paymentTotals[r.payment_method] = (paymentTotals[r.payment_method] ?? 0) + r.total_revenue;
  });

  const paymentLabels: Record<string, string> = {
    cash: "Dinheiro",
    pix: "PIX",
    card: "Cartão",
    fiado: "Fiado",
  };

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
    >
      <View className="px-4 pt-4 pb-3">
        <Text className="text-lg font-bold text-gray-900 mb-3">Relatórios</Text>

        {/* Period selector */}
        <View className="bg-gray-200 rounded-xl p-1 flex-row mb-4">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              className={`flex-1 py-2 rounded-lg items-center ${period === p ? "bg-white shadow" : ""}`}
              onPress={() => setPeriod(p)}
            >
              <Text className={`text-sm font-semibold ${period === p ? "text-gray-900" : "text-gray-500"}`}>
                {periodLabels[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary card */}
        <View className="bg-primary-500 rounded-2xl p-5 mb-4">
          <Text className="text-white opacity-80 text-sm font-medium mb-1">Faturamento</Text>
          <Text className="text-white text-3xl font-bold">{formatCurrency(currentRevenue ?? 0)}</Text>
          <Text className="text-white opacity-70 text-sm mt-1">{currentSales ?? 0} botijões vendidos</Text>
        </View>

        {/* By payment method */}
        {Object.keys(paymentTotals).length > 0 && (
          <>
            <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Por Pagamento</Text>
            <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
              {Object.entries(paymentTotals).map(([method, total], idx, arr) => (
                <View
                  key={method}
                  className={`px-4 py-3 flex-row items-center justify-between ${idx < arr.length - 1 ? "border-b border-gray-100" : ""}`}
                >
                  <Text className="text-gray-700 font-medium">{paymentLabels[method] ?? method}</Text>
                  <Text className="font-bold text-gray-900">{formatCurrency(total)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* By cylinder */}
        {rows.length > 0 && (
          <>
            <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Por Botijão</Text>
            <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
              {Object.entries(
                rows.reduce((acc: Record<string, { qty: number; revenue: number }>, r: any) => {
                  acc[r.cylinder_name] = acc[r.cylinder_name] ?? { qty: 0, revenue: 0 };
                  acc[r.cylinder_name].qty += r.total_qty;
                  acc[r.cylinder_name].revenue += r.total_revenue;
                  return acc;
                }, {})
              ).map(([name, { qty, revenue }], idx, arr) => (
                <View
                  key={name}
                  className={`px-4 py-3 flex-row items-center justify-between ${idx < arr.length - 1 ? "border-b border-gray-100" : ""}`}
                >
                  <View>
                    <Text className="text-gray-700 font-medium">{name}</Text>
                    <Text className="text-xs text-gray-400">{qty} unidades</Text>
                  </View>
                  <Text className="font-bold text-gray-900">{formatCurrency(revenue)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {rows.length === 0 && (
          <View className="items-center py-12">
            <Ionicons name="bar-chart-outline" size={48} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 font-medium">Nenhuma venda no período</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
