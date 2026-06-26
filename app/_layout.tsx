import "../global.css";
import { Stack, router } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { Suspense, useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initDatabase } from "@/db/database";
import { onAuthChange } from "@/lib/auth";
import { SyncEngine } from "@/lib/sync/engine";

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

  return <>{children}</>;
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
