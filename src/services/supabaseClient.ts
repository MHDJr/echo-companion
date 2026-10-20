import { createClient, type User, type Session } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://mewxhhifntjkedgptxqi.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!supabaseAnonKey) {
  console.warn(
    "[Echo Auth] VITE_SUPABASE_ANON_KEY is not defined. Public operations requiring client keys will fail."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function getCurrentSession(): Promise<Session | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("[Echo Auth] Error fetching session:", error.message);
      return null;
    }
    return session;
  } catch (err) {
    console.error("[Echo Auth] Unexpected error fetching session:", err);
    return null;
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({ email: email.trim(), password });
}

export async function signOutUser() {
  return supabase.auth.signOut();
}
