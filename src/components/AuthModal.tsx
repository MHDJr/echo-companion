import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { signInWithEmail, signUpWithEmail, signOutUser } from "../services/supabaseClient";

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  if (!isOpen) return null;

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
              <span className="auth-user-label">Account:</span>
              <span className="auth-user-email">{currentUser.email || currentUser.id}</span>
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

              <button type="submit" className="auth-submit-btn" disabled={isLoading}>
                {isLoading
                  ? "Processing..."
                  : mode === "signin"
                  ? "Sign In"
                  : "Create Account"}
              </button>
            </form>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="auth-demo-btn"
              onClick={handleDemoSignIn}
              disabled={isLoading}
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
