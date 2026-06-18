/**
 * Firebase app + Auth singleton com persistência via AsyncStorage.
 *
 * Configuração lida de process.env.EXPO_PUBLIC_FIREBASE_* (injetado pelo
 * Expo automaticamente a partir de .env.local — nunca commitado).
 *
 * getReactNativePersistence é exportado pelo entry-point React Native do
 * @firebase/auth (resolvido pelo Metro via o campo "react-native" do
 * package.json de @firebase/auth — dist/rn/index.js). Verificado em
 * @firebase/auth@1.13.3 / firebase@12.15.0.
 *
 * Nota sobre tsconfig paths: o tsconfig.json aponta firebase/auth e
 * @firebase/auth para dist/rn/index.rn.d.ts para que o tsc resolva
 * getReactNativePersistence. Isso é necessário porque o exports map do
 * @firebase/auth tem "types" como chave de primeiro nível, e o tsc 5.x
 * a prioriza sobre customConditions (comportamento confirmado via traceResolution).
 * Em runtime o Metro usa o campo "react-native" do package.json e o
 * resultado é idêntico.
 */
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
} from "@firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Valida as variáveis de ambiente críticas para Auth em tempo de boot.
// Uma variável ausente causaria falha silenciosa na primeira chamada de login.
const REQUIRED_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
for (const [key, value] of Object.entries(REQUIRED_ENV)) {
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${key}. Adicione-a ao arquivo .env.local.`
    );
  }
}

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
};

// Guarda contra dupla inicialização do FirebaseApp (hot-reload / Fast Refresh).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Cria a instância de Auth com persistência via AsyncStorage no primeiro boot,
 * ou reutiliza a existente no Fast Refresh/hot-reload.
 *
 * A ordem importa: initializeAuth() PRIMEIRO. No RN, getAuth() NÃO lança quando
 * Auth ainda não foi inicializado — ele inicializa com persistência em memória
 * (default) e apenas emite um aviso. Se chamássemos getAuth() primeiro, o app
 * ficaria com persistência em memória e o usuário seria deslogado a cada reinício.
 * Por isso tentamos initializeAuth (que aplica AsyncStorage) e só caímos em
 * getAuth() quando initializeAuth lança auth/already-initialized no hot-reload.
 */
function getOrCreateAuth() {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

/**
 * Singleton de Auth com persistência via AsyncStorage.
 * O usuário permanece autenticado entre reinicializações do app (refresh
 * token nunca expira no Firebase email/senha).
 */
export const auth = getOrCreateAuth();
