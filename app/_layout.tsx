import "../global.css";
import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { Suspense } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initDatabase } from "@/db/database";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Suspense
        fallback={
          <View className="flex-1 items-center justify-center bg-white">
            <ActivityIndicator size="large" color="#f97316" />
          </View>
        }
      >
        <SQLiteProvider databaseName="gas-manager-v2.db" onInit={initDatabase} useSuspense>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="sale-form"
              options={{ headerShown: true, title: "Nova Venda", presentation: "modal" }}
            />
            <Stack.Screen
              name="restock-form"
              options={{ headerShown: true, title: "Entrada de Estoque", presentation: "modal" }}
            />
            <Stack.Screen
              name="customer-form"
              options={{ headerShown: true, title: "Cliente", presentation: "modal" }}
            />
            <Stack.Screen
              name="settle-debt"
              options={{ headerShown: true, title: "Registrar Pagamento", presentation: "modal" }}
            />
            <Stack.Screen
              name="customer-detail"
              options={{
                headerShown: true,
                title: "Cliente",
                headerStyle: { backgroundColor: "#f97316" },
                headerTintColor: "#ffffff",
                headerTitleStyle: { fontWeight: "700" },
              }}
            />
          </Stack>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}
