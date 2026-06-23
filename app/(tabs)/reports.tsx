import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getReportByPeriod, getDashboardStats } from "@/db/queries/sales";
import { getSettlements } from "@/db/queries/settlements";
import { getExpenses } from "@/db/queries/expenses";
import { DashboardStats, DebtSettlement, Expense } from "@/types";
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

const paymentLabels: Record<string, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  fiado: "Fiado",
};

export default function ReportsScreen() {
  const db = useSQLiteContext();
  const [period, setPeriod] = useState<Period>("today");
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [settlements, setSettlements] = useState<DebtSettlement[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const salesVersion = useAppStore((s) => s.salesVersion);
  const customersVersion = useAppStore((s) => s.customersVersion);
  const expensesVersion = useAppStore((s) => s.expensesVersion);

  const load = useCallback(async () => {
    const { from, to } = getDateRange(period);
    const [reportRows, dashStats, settleRows, expenseRows] = await Promise.all([
      getReportByPeriod(db, from, to),
      getDashboardStats(db),
      getSettlements(db, from, to),
      getExpenses(db, from, to),
    ]);
    setRows(reportRows as any[]);
    setStats(dashStats);
    setSettlements(settleRows);
    setExpenses(expenseRows);
  }, [db, period]);

  useEffect(() => { load(); }, [load, salesVersion, customersVersion, expensesVersion]);

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

  const totalRevenue = rows.reduce((acc: number, r: any) => acc + r.total_revenue, 0);
  const totalCost = rows.reduce((acc: number, r: any) => acc + r.total_cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const totalSettled = settlements.reduce((acc, s) => acc + s.amount, 0);

  const settlementByMethod: Record<string, number> = {};
  settlements.forEach((s) => {
    settlementByMethod[s.payment_method] =
      (settlementByMethod[s.payment_method] ?? 0) + s.amount;
  });

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-gray-950"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />}
    >
      <View className="px-4 pt-4 pb-3">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-50">Financeiro</Text>
          <TouchableOpacity
            className="flex-row items-center gap-1.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2"
            onPress={() => router.push("/add-expense")}
          >
            <Ionicons name="remove-circle-outline" size={16} color="#dc2626" />
            <Text className="text-red-700 dark:text-red-400 font-semibold text-sm">Despesa</Text>
          </TouchableOpacity>
        </View>

        {/* Period selector */}
        <View className="bg-gray-200 dark:bg-gray-800 rounded-xl p-1 flex-row mb-4">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              className={`flex-1 py-2 rounded-lg items-center ${period === p ? "bg-white dark:bg-gray-700 shadow" : ""}`}
              onPress={() => setPeriod(p)}
            >
              <Text className={`text-sm font-semibold ${period === p ? "text-gray-900 dark:text-gray-50" : "text-gray-500 dark:text-gray-400"}`}>
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

        {rows.length > 0 && (
          <View className="flex-row gap-3 mb-4">
            <View className="flex-1 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
              <Text className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">Lucro</Text>
              <Text className={`text-xl font-bold ${totalProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {formatCurrency(totalProfit)}
              </Text>
            </View>
            <View className="flex-1 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
              <Text className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">Margem</Text>
              <Text className={`text-xl font-bold ${margin >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {margin.toFixed(1)}%
              </Text>
            </View>
          </View>
        )}

        {/* By payment method */}
        {Object.keys(paymentTotals).length > 0 && (
          <>
            <Text className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Vendas por pagamento</Text>
            <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
              {Object.entries(paymentTotals).map(([method, total], idx, arr) => (
                <View
                  key={method}
                  className={`px-4 py-3 flex-row items-center justify-between ${idx < arr.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                >
                  <Text className="text-gray-700 dark:text-gray-300 font-medium">{paymentLabels[method] ?? method}</Text>
                  <Text className="font-bold text-gray-900 dark:text-gray-50">{formatCurrency(total)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* By cylinder */}
        {rows.length > 0 && (
          <>
            <Text className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Por Botijão</Text>
            <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
              {Object.entries(
                rows.reduce((acc: Record<string, { qty: number; revenue: number; profit: number }>, r: any) => {
                  acc[r.cylinder_name] = acc[r.cylinder_name] ?? { qty: 0, revenue: 0, profit: 0 };
                  acc[r.cylinder_name].qty += r.total_qty;
                  acc[r.cylinder_name].revenue += r.total_revenue;
                  acc[r.cylinder_name].profit += r.total_profit;
                  return acc;
                }, {})
              ).map(([name, { qty, revenue, profit }], idx, arr) => (
                <View
                  key={name}
                  className={`px-4 py-3 flex-row items-center justify-between ${idx < arr.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                >
                  <View>
                    <Text className="text-gray-700 dark:text-gray-300 font-medium">{name}</Text>
                    <Text className="text-xs text-gray-400 dark:text-gray-500">{qty} un · lucro {formatCurrency(profit)}</Text>
                  </View>
                  <Text className="font-bold text-gray-900 dark:text-gray-50">{formatCurrency(revenue)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Vales recebidos */}
        <Text className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
          Vales recebidos
        </Text>
        {settlements.length > 0 ? (
          <>
            <View className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-2xl p-4 mb-3 flex-row items-center justify-between">
              <View>
                <Text className="text-green-700 dark:text-green-400 font-bold text-xl">
                  {formatCurrency(totalSettled)}
                </Text>
                <Text className="text-green-600 dark:text-green-500 text-xs mt-0.5">
                  {settlements.length} pagamento(s) de fiado recebido(s)
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={32} color="#16a34a" />
            </View>

            {Object.keys(settlementByMethod).length > 1 && (
              <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-3">
                {Object.entries(settlementByMethod).map(([method, total], idx, arr) => (
                  <View
                    key={method}
                    className={`px-4 py-3 flex-row items-center justify-between ${idx < arr.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                  >
                    <Text className="text-gray-700 dark:text-gray-300 font-medium">
                      {paymentLabels[method] ?? method}
                    </Text>
                    <Text className="font-bold text-gray-900 dark:text-gray-50">
                      {formatCurrency(total)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
              {settlements.map((s, idx) => (
                <View
                  key={s.uuid}
                  className={`px-4 py-3 flex-row items-center justify-between ${idx < settlements.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                >
                  <View className="flex-1 mr-3">
                    <Text className="font-medium text-gray-900 dark:text-gray-50 text-sm">
                      {s.customer_name}
                    </Text>
                    <Text className="text-xs text-gray-400 dark:text-gray-500">
                      {paymentLabels[s.payment_method] ?? s.payment_method} ·{" "}
                      {new Date(s.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Text className="font-bold text-green-700 dark:text-green-400">
                    +{formatCurrency(s.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 items-center mb-4">
            <Ionicons name="wallet-outline" size={36} color="#d1d5db" />
            <Text className="text-gray-400 dark:text-gray-500 mt-2 font-medium text-sm">
              Nenhum vale recebido {periodLabels[period].toLowerCase()}
            </Text>
          </View>
        )}

        {/* Despesas */}
        <Text className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
          Despesas
        </Text>
        {expenses.length > 0 ? (
          <>
            <View className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-4 mb-3 flex-row items-center justify-between">
              <View>
                <Text className="text-red-700 dark:text-red-400 font-bold text-xl">
                  {formatCurrency(expenses.reduce((acc, e) => acc + e.amount, 0))}
                </Text>
                <Text className="text-red-600 dark:text-red-500 text-xs mt-0.5">
                  {expenses.length} despesa(s) no período
                </Text>
              </View>
              <Ionicons name="arrow-down-circle" size={32} color="#dc2626" />
            </View>
            <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
              {expenses.map((e, idx) => (
                <View
                  key={e.uuid}
                  className={`px-4 py-3 flex-row items-center justify-between ${
                    idx < expenses.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""
                  }`}
                >
                  <View className="flex-1 mr-3">
                    <Text className="font-medium text-gray-900 dark:text-gray-50 text-sm">
                      {e.category}
                    </Text>
                    {e.description && (
                      <Text className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {e.description}
                      </Text>
                    )}
                    <Text className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(e.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Text className="font-bold text-red-600 dark:text-red-400">
                    -{formatCurrency(e.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 items-center mb-4">
            <Ionicons name="receipt-outline" size={36} color="#d1d5db" />
            <Text className="text-gray-400 dark:text-gray-500 mt-2 font-medium text-sm">
              Nenhuma despesa {periodLabels[period].toLowerCase()}
            </Text>
          </View>
        )}

        {rows.length === 0 && settlements.length === 0 && expenses.length === 0 && (
          <View className="items-center py-4">
            <Text className="text-gray-300 dark:text-gray-600 text-sm">
              Sem movimentação no período
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
