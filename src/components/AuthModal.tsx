import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { signInWithEmail, signUpWithEmail, signOutUser, signInWithGoogle } from "../services/supabaseClient";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onUserChange: (user: User | null) => void;
}

export function AuthModal({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
}: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setSuccessNotice(null);
    setIsGoogleLoading(true);

    try {
      const res = await signInWithGoogle();
      if (res?.error) {
        // Helpful diagnostic message if provider is not yet enabled in Dashboard
        if (res.error.message?.toLowerCase().includes("unsupported provider") || res.error.message?.toLowerCase().includes("not enabled")) {
          setErrorMessage(
            "Google sign-in is not yet enabled in your Supabase project dashboard. Go to Supabase Dashboard > Authentication > Providers > Google to configure credentials."
          );
        } else {
          setErrorMessage(res.error.message);
        }
        setIsGoogleLoading(false);
      } else if (res?.data?.url && typeof window !== "undefined") {
        window.location.href = res.data.url;
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to initiate Google sign-in.");
      setIsGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setIsLoading(true);
    try {
      if (mode === "signin") {
        const { data, error } = await signInWithEmail(trimmedEmail, password);
        if (error) {
          setErrorMessage(error.message);
        } else {
          onUserChange(data.user);
          onClose();
        }
      } else {
        const { data, error } = await signUpWithEmail(trimmedEmail, password);
        if (error) {
          setErrorMessage(error.message);
        } else if (data.session) {
          onUserChange(data.user);
          onClose();
        } else {
          setSuccessNotice(
            "Account created! If confirmation email was sent, please verify before signing in."
          );
        }
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Authentication error.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDemoSignIn() {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await signInWithEmail(
        "echo_companion_test_89888@gmail.com",
        "EchoPassword2026!"
      );
      if (error) {
        setErrorMessage(error.message);
      } else {
        onUserChange(data.user);
        onClose();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Demo sign in failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignOut() {
    setIsLoading(true);
    try {
      await signOutUser();
      onUserChange(null);
      onClose();
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  const userAvatar = currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture;
  const userFullName = currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name;
  const isGoogleUser = currentUser?.app_metadata?.provider === "google";

  return (
    <div className="auth-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-header">
          <div className="auth-modal-badge">SECURITY & ACCESS</div>
          <button className="auth-modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        {currentUser ? (
          <div className="auth-signed-in-view">
            <h3 className="auth-modal-title">Signed In</h3>
            <p className="auth-modal-subtitle">
              You are authenticated. Your conversations with Echo Companion are private and securely routed through Supabase Edge Functions.
            </p>
            <div className="auth-user-info-box">
              {userAvatar && (
                <img
                  src={userAvatar}
                  alt={userFullName || "User Avatar"}
                  className="auth-user-avatar"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="auth-user-details">
                <span className="auth-user-label">
                  {isGoogleUser ? "Google Authenticated" : "Account"}
                </span>
                <span className="auth-user-email">
                  {userFullName ? `${userFullName} · ${currentUser.email}` : currentUser.email || currentUser.id}
                </span>
              </div>
            </div>
            <div className="auth-actions-row">
              <button
                type="button"
                className="auth-signout-btn"
                onClick={handleSignOut}
                disabled={isLoading}
              >
                {isLoading ? "Signing out..." : "Sign Out"}
              </button>
              <button type="button" className="auth-done-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="auth-modal-title">
              {mode === "signin" ? "Sign in to Echo" : "Create Echo Account"}
            </h3>
            <p className="auth-modal-subtitle">
              An authenticated session is required to converse with Echo AI.
            </p>

            {errorMessage && <div className="auth-alert error">{errorMessage}</div>}
            {successNotice && <div className="auth-alert success">{successNotice}</div>}

            {/* Google OAuth Primary Sign-in */}
            <button
              type="button"
              className="auth-google-btn"
              onClick={handleGoogleSignIn}
              disabled={isLoading || isGoogleLoading}
            >
              <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
              </svg>
              <span>{isGoogleLoading ? "Connecting with Google..." : "Continue with Google"}</span>
            </button>

            <div className="auth-divider">
              <span>or email</span>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              <label className="auth-field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                />
              </label>

              <button type="submit" className="auth-submit-btn" disabled={isLoading || isGoogleLoading}>
                {isLoading
                  ? "Processing..."
                  : mode === "signin"
                  ? "Sign In"
                  : "Create Account"}
              </button>
            </form>

            <div className="auth-divider">
              <span>quick demo</span>
            </div>

            <button
              type="button"
              className="auth-demo-btn"
              onClick={handleDemoSignIn}
              disabled={isLoading || isGoogleLoading}
            >
              ⚡ Quick Connect (Pre-verified Demo)
            </button>

            <div className="auth-toggle-row">
              {mode === "signin" ? (
                <span>
                  Don't have an account?{" "}
                  <button type="button" onClick={() => setMode("signup")}>
                    Create one
                  </button>
                </span>
              ) : (
                <span>
                  Already have an account?{" "}
                  <button type="button" onClick={() => setMode("signin")}>
                    Sign in
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
