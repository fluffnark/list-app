import React, { useEffect, useState } from "react";
import { api, apiRoot, syncNow } from "./db";

type Status = {
  ready: boolean;
  enabled: boolean;
  sourceListId: string | null;
  lists: { id: string; title: string }[];
  lastSync: string | null;
  lastResult: { imported: number; existing: number } | null;
  error: string | null;
};

export function GoogleTasksSettings({
  signedIn,
  googleConfigured,
  onError,
}: {
  signedIn: boolean;
  googleConfigured: boolean;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<Status>();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const data: Status = await api("/api/google-tasks");
    setStatus(data);
    setSource(data.sourceListId || data.lists[0]?.id || "");
  };
  useEffect(() => {
    if (!signedIn) {
      setStatus(undefined);
      return;
    }
    void load().catch((error) =>
      onError(error instanceof Error ? error.message : String(error)),
    );
  }, [signedIn]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const configure = async (enabled: boolean) => {
    await api("/api/google-tasks", {
      method: "PUT",
      body: JSON.stringify({ enabled, sourceListId: source || null }),
    });
    if (enabled) {
      await load();
      await api("/api/google-tasks/sync", { method: "POST" });
      await syncNow(true);
    }
    await load();
  };
  return (
    <div className="settings-card">
      <h3>Google Home task capture</h3>
      <p>
        Say “Hey Google, remind me to…” to save a Google Task. Import open tasks
        from one Google Tasks list into your ListFlow Inbox.
      </p>
      <p className="tiny muted">
        Tasks are imported once. Later edits, completions and deletions stay in
        the app where you make them. Google provides due dates, but not reminder
        times; timed alerts stay in Google Tasks.
      </p>
      {!signedIn ? (
        <p>Sign in to your workspace to connect task capture.</p>
      ) : !googleConfigured ? (
        <p>
          Configure the server’s Google OAuth client and enable the Google Tasks
          API in that Cloud project, then return here to allow Tasks access.
        </p>
      ) : !status ? (
        <p role="status">Loading task capture…</p>
      ) : (
        <>
          {!status.ready ? (
            <a
              className="secondary-button"
              href={apiRoot() + "/auth/google?tasks=1"}
            >
              Allow Google Tasks access
            </a>
          ) : (
            <>
              <label>
                Google Tasks list
                <select
                  aria-label="Google Tasks list"
                  value={source}
                  disabled={busy || status.enabled}
                  onChange={(event) => setSource(event.target.value)}
                >
                  {!status.lists.length && (
                    <option value="">No lists available</option>
                  )}
                  {status.lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="tiny muted">
                Enabling capture also imports existing open tasks in the
                selected list. Voice tasks usually go into your default Google
                Tasks list. Turn capture off before changing lists.
              </p>
              <div className="export-actions">
                <button
                  className="secondary-button"
                  disabled={busy || (!source && !status.enabled)}
                  onClick={() => void run(() => configure(!status.enabled))}
                >
                  {status.enabled
                    ? "Turn off task capture"
                    : "Enable task capture"}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !status.enabled}
                  onClick={() =>
                    void run(async () => {
                      await api("/api/google-tasks/sync", { method: "POST" });
                      await syncNow(true);
                      await load();
                    })
                  }
                >
                  Import now
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void run(load)}
                >
                  Refresh
                </button>
              </div>
              <p role="status">
                {busy
                  ? "Updating task capture…"
                  : status.enabled
                    ? "Task capture is on. Checks run about once a minute."
                    : "Task capture is off."}
              </p>
              {status.lastSync && (
                <p className="tiny muted">
                  Last import: {new Date(status.lastSync).toLocaleString()}
                  {status.lastResult
                    ? ` · ${status.lastResult.imported} new tasks`
                    : ""}
                  .
                </p>
              )}
            </>
          )}
          {status.error && (
            <p className="warning-text" role="alert">
              {status.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
