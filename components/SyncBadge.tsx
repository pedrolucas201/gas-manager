import { TouchableOpacity, Text, View } from "react-native";
import { useSyncStore } from "@/store/sync";

export function SyncBadge({ onLogout }: { onLogout: () => void }) {
  const { status, pendingCount, online } = useSyncStore();

  let label = "Sincronizado";
  let bgColor = "bg-green-100";
  let textColor = "text-green-800";

  if (!online) {
    label = "Offline";
    bgColor = "bg-gray-100";
    textColor = "text-gray-600";
  } else if (pendingCount > 0) {
    label = `${pendingCount} pendente${pendingCount > 1 ? "s" : ""}`;
    bgColor = "bg-yellow-100";
    textColor = "text-yellow-800";
  } else if (status === "syncing") {
    label = "Sincronizando…";
    bgColor = "bg-blue-100";
    textColor = "text-blue-800";
  } else if (status === "error") {
    label = "Erro de sync";
    bgColor = "bg-red-100";
    textColor = "text-red-800";
  }

  return (
    <View className="flex-row items-center gap-2 pr-2">
      <View className={`px-2 py-0.5 rounded-full ${bgColor}`}>
        <Text className={`text-xs font-semibold ${textColor}`}>{label}</Text>
      </View>
      <TouchableOpacity onPress={onLogout} hitSlop={8}>
        <Text className="text-white text-xs font-medium">Sair</Text>
      </TouchableOpacity>
    </View>
  );
}
