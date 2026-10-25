import { createClient, type User, type Session } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://mewxhhifntjkedgptxqi.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ld3hoaGlmbnRqa2VkZ3B0eHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NzQ0MzMsImV4cCI6MjEwODA1MDQzM30.ucB0LxXPwSg_m3vzNWggtFpNXfjl3XzZlPwZCtZLVpo";

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

export function getAuthRedirectUrl(customRedirect?: string): string {
  if (customRedirect) return customRedirect;
  const envUrl = import.meta.env.VITE_APP_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.startsWith("http")) {
    return envUrl.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return "";
}

export async function signInWithGoogle(redirectTo?: string) {
  // Use least-privilege Google OAuth for authentication only.
  // Google Calendar and Google Tasks service access are handled separately.
  const redirectUrl = getAuthRedirectUrl(redirectTo);

  const res = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (res.data?.url && typeof window !== "undefined") {
    window.location.href = res.data.url;
  }
  return res;
}

export async function signOutUser() {
  return supabase.auth.signOut();
}
