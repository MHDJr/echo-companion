import { useState, useRef, useEffect } from "react";
import type { GoogleSyncStatus } from "../types";
import { connectGoogleWorkspaceOAuth, disconnectGoogleWorkspace } from "../services/googleSyncService";

interface GoogleSyncBadgeProps {
  status: GoogleSyncStatus;
  isSyncing: boolean;
  onSyncNow: () => void;
  onStatusChange: (status: GoogleSyncStatus) => void;
}

export function GoogleSyncBadge({
  status,
  isSyncing,
  onSyncNow,
  onStatusChange,
}: GoogleSyncBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  async function handleConnect() {
    setLoading(true);
    try {
      const res = await connectGoogleWorkspaceOAuth();
      if (res?.data?.url && typeof window !== "undefined") {
        window.location.href = res.data.url;
      }
    } catch (err) {
      console.error("[GoogleSyncBadge] Connect error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      const ok = await disconnectGoogleWorkspace();
      if (ok) {
        onStatusChange({
          isConnected: false,
          calendarConnected: false,
          tasksConnected: false,
          googleEmail: null,
        });
        setIsOpen(false);
      }
    } catch (err) {
      console.error("[GoogleSyncBadge] Disconnect error:", err);
    } finally {
      setLoading(false);
    }
  }

  const formattedLastSync = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="google-sync-badge-wrapper" ref={popoverRef}>
      <button
        type="button"
        className={`google-sync-badge-btn ${status.isConnected ? "connected" : "idle"} ${
          isSyncing ? "syncing" : ""
        }`}
        onClick={() => setIsOpen(!isOpen)}
        title={status.isConnected ? `Google Connected (${status.googleEmail || "Active"})` : "Connect Google Workspace"}
        aria-label="Google Workspace Sync Status"
        aria-expanded={isOpen}
      >
        <svg className="google-badge-svg" viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
        </svg>

        <span className="badge-text">
          {isSyncing ? "Syncing..." : status.isConnected ? "Google Synced" : "Connect Google"}
        </span>

        <span className={`sync-status-indicator ${isSyncing ? "pulsing" : status.isConnected ? "online" : "offline"}`} />
      </button>

      {isOpen && (
        <div className="google-sync-popover">
          <div className="popover-header">
            <span className="popover-eyebrow">INTEGRATION STATUS</span>
            <h4 className="popover-title">Google Workspace</h4>
          </div>

          <div className="popover-body">
            {status.isConnected ? (
              <>
                <div className="popover-info-item">
                  <span className="info-label">Account</span>
                  <span className="info-value">{status.googleEmail || "Connected"}</span>
                </div>
                <div className="popover-info-item">
                  <span className="info-label">Services</span>
                  <span className="info-value">Calendar & Tasks</span>
                </div>
                {formattedLastSync && (
                  <div className="popover-info-item">
                    <span className="info-label">Last Synced</span>
                    <span className="info-value">{formattedLastSync}</span>
                  </div>
                )}

                <div className="popover-actions">
                  <button
                    type="button"
                    className="popover-sync-btn"
                    onClick={() => {
                      onSyncNow();
                      setIsOpen(false);
                    }}
                    disabled={isSyncing}
                  >
                    {isSyncing ? "Syncing..." : "↻ Sync Now"}
                  </button>
                  <button
                    type="button"
                    className="popover-disconnect-btn"
                    onClick={handleDisconnect}
                    disabled={loading}
                  >
                    {loading ? "Disconnecting..." : "Disconnect"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="popover-desc">
                  Connect your Google Calendar and Tasks to keep schedules and action items synchronized in both directions.
                </p>
                <button
                  type="button"
                  className="popover-connect-btn"
                  onClick={handleConnect}
                  disabled={loading}
                >
                  {loading ? "Connecting..." : "Connect Google Workspace"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
