import { useState } from "react";
import { connectGoogleWorkspaceOAuth, disconnectGoogleWorkspace } from "../services/googleSyncService";
import type { GoogleSyncStatus } from "../types";

interface GoogleConnectPromptProps {
  status: GoogleSyncStatus;
  onStatusChange: (status: GoogleSyncStatus) => void;
  onDismiss: () => void;
}

export function GoogleConnectPrompt({
  status,
  onStatusChange,
  onDismiss,
}: GoogleConnectPromptProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConnect() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await connectGoogleWorkspaceOAuth();
      if (res?.error) {
        setErrorMsg(res.error.message);
        setLoading(false);
      } else if (res?.data?.url && typeof window !== "undefined") {
        window.location.href = res.data.url;
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to initiate Google connection.");
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const ok = await disconnectGoogleWorkspace();
      if (ok) {
        onStatusChange({
          isConnected: false,
          calendarConnected: false,
          tasksConnected: false,
          googleEmail: null,
        });
      } else {
        setErrorMsg("Failed to disconnect Google account. Please try again.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Error disconnecting.");
    } finally {
      setLoading(false);
    }
  }

  if (status.isConnected) {
    return (
      <div className="google-connect-banner connected">
        <div className="google-banner-icon">
          <span className="google-status-dot online" />
        </div>
        <div className="google-banner-text">
          <p className="google-banner-title">
            Google Workspace Connected
            {status.googleEmail && <span className="google-banner-email"> · {status.googleEmail}</span>}
          </p>
          <p className="google-banner-desc">
            Two-way synchronization active for Google Calendar and Google Tasks.
          </p>
        </div>
        <div className="google-banner-actions">
          <button
            type="button"
            className="google-disconnect-btn"
            onClick={handleDisconnect}
            disabled={loading}
          >
            {loading ? "Disconnecting..." : "Disconnect"}
          </button>
          <button
            type="button"
            className="google-close-btn"
            onClick={onDismiss}
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="google-connect-banner">
      <div className="google-banner-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
        </svg>
      </div>

      <div className="google-banner-text">
        <p className="google-banner-title">Connect Google Calendar & Tasks</p>
        <p className="google-banner-desc">
          Echo needs permission to read and create/update your calendar events and tasks. Everything remains secure and encrypted on the server.
        </p>
        {errorMsg && <p className="google-banner-error">{errorMsg}</p>}
      </div>

      <div className="google-banner-actions">
        <button
          type="button"
          className="google-connect-btn"
          onClick={handleConnect}
          disabled={loading}
        >
          {loading ? "Connecting..." : "Connect Google"}
        </button>
        <button
          type="button"
          className="google-notnow-btn"
          onClick={onDismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
