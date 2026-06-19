import { Tabs, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SyncBadge } from "@/components/SyncBadge";
import { signOutUser } from "@/lib/auth";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  name,
  color,
  size,
}: {
  name: IoniconsName;
  color: string | unknown;
  size: number;
}) {
  return <Ionicons name={name} size={size} color={color as string} />;
}

async function handleLogout() {
  await signOutUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router.replace("/login" as any);
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#f97316",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e5e7eb",
          paddingBottom: insets.bottom + 8,
          height: 52 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: "#f97316" },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => <SyncBadge onLogout={handleLogout} />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: "Vendas",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="cart" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Estoque",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="cube" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: "Clientes",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="people" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Relatórios",
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="bar-chart" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
