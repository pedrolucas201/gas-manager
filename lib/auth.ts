/**
 * Wrappers de autenticação Firebase (email/senha).
 *
 * Responsabilidades:
 *  - signIn: autentica e retorna o UserCredential
 *  - signOutUser: encerra a sessão
 *  - onAuthChange: observa mudanças no estado de autenticação
 *  - getIdToken: devolve o token JWT atual (auto-renova se necessário)
 *
 * Erros do Firebase são mapeados para mensagens em português.
 */
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type UserCredential,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "./firebase";

// ---------------------------------------------------------------------------
// Mapeamento de códigos de erro Firebase → mensagens PT
// ---------------------------------------------------------------------------

const FIREBASE_ERROR_MAP: Record<string, string> = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/user-disabled": "Esta conta foi desativada.",
  "auth/network-request-failed":
    "Falha de conexão. Verifique sua internet e tente novamente.",
};

function mapFirebaseError(code: string): string {
  return (
    FIREBASE_ERROR_MAP[code] ??
    "Erro de autenticação. Tente novamente mais tarde."
  );
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Autentica com email e senha.
 * Lança um Error com mensagem em português em caso de falha.
 */
export async function signIn(
  email: string,
  password: string
): Promise<UserCredential> {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    throw new Error(mapFirebaseError(code));
  }
}

/**
 * Encerra a sessão do usuário atual.
 */
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Registra um observador para mudanças no estado de autenticação.
 * Retorna a função de cancelamento (unsubscribe).
 */
export function onAuthChange(
  callback: (user: User | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

/**
 * Retorna o ID token JWT do usuário autenticado atual.
 * O SDK Firebase renova o token automaticamente se estiver expirado.
 * Retorna null se não houver usuário autenticado.
 */
export async function getIdToken(): Promise<string | null> {
  return auth.currentUser?.getIdToken() ?? null;
}
