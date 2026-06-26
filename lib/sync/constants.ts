// The backend seeds a single P13 cylinder type with this fixed UUID (migration
// 0003). The app is P13-only, so every sale/restock references this id instead
// of syncing a catalog of types.
export const SERVER_P13_UUID = "11111111-1111-1111-1111-111111111111";

// Cloud Run base URL, injected at build time via .env.local (EXPO_PUBLIC_*).
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

// Acima deste número de cancelamentos (void_sale) pendentes num único push, o
// engine pausa e exige confirmação explícita do usuário antes de enviar —
// proteção contra um backlog de anulações drenar em massa silenciosamente.
export const VOID_CONFIRM_THRESHOLD = 3;
