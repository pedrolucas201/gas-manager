import "../global.css";
import { Stack, router } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { Suspense, useEffect, useRef } from "react";
import { ActivityIndicator, View, Text, TouchableOpacity } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { initDatabase } from "@/db/database";
import { onAuthChange } from "@/lib/auth";
import { SyncEngine } from "@/lib/sync/engine";
import { useSyncStore } from "@/store/sync";

function VoidConfirmBanner() {
  const voidConfirmNeeded = useSyncStore((s) => s.voidConfirmNeeded);
  const insets = useSafeAreaInsets();
  if (voidConfirmNeeded <= 0) return null;
  return (
    <TouchableOpacity
      onPress={() => router.push("/pending-voids")}
      style={{ paddingTop: insets.top }}
      className="bg-red-600 px-4 pb-3"
    >
      <View className="flex-row items-center gap-2 pt-2">
        <Ionicons name="warning-outline" size={18} color="#ffffff" />
        <Text className="text-white font-semibold flex-1">
          {voidConfirmNeeded} cancelamento{voidConfirmNeeded > 1 ? "s" : ""} aguardando confirmação — toque para revisar
        </Text>
        <Ionicons name="chevron-forward" size={18} color="#ffffff" />
      </View>
    </TouchableOpacity>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user === null) {
        engineRef.current?.stop();
        engineRef.current = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.replace("/login" as any);
      } else {
        if (!engineRef.current) {
          const engine = new SyncEngine(db);
          engineRef.current = engine;
          engine.start();
        }
        router.replace("/(tabs)");
      }
    });
    return () => {
      unsub();
      engineRef.current?.stop();
    };
  }, [db]);

  return (
    <View className="flex-1">
      <VoidConfirmBanner />
      <View className="flex-1">{children}</View>
    </View>
  );
}

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
        <SQLiteProvider
          databaseName="gas-manager-v2.db"
          onInit={initDatabase}
          useSuspense
        >
          <AuthGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="sale-form"
                options={{
                  headerShown: true,
                  title: "Nova Venda",
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="restock-form"
                options={{
                  headerShown: true,
                  title: "Entrada de Estoque",
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="customer-form"
                options={{
                  headerShown: true,
                  title: "Cliente",
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="settle-debt"
                options={{
                  headerShown: true,
                  title: "Registrar Pagamento",
                  presentation: "modal",
                }}
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
              <Stack.Screen
                name="voided-sales"
                options={{
                  headerShown: true,
                  title: "Vendas Canceladas",
                }}
              />
              <Stack.Screen
                name="pending-voids"
                options={{
                  headerShown: true,
                  title: "Revisar Cancelamentos",
                }}
              />
            </Stack>
          </AuthGate>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}
