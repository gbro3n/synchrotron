# Troubleshooting

## Zombie Daemon Processes (Conflict Storms)

### Symptoms

- `.sync` metadata files appear as regular synced files in logs (e.g. `agent\.sync → agent\.sync (added)`)
- `.synchrotron` metadata files reappear after being deleted
- Exponential conflict cascades — thousands of `.sync.conflict-*` and `.synchrotron` files appear across all sync directories
- Log entries show `.sync` or `.synchrotron` files in `added` or `conflict` actions between peers
- Repeated cleanup has no lasting effect; stale files return within seconds

### Automatic Prevention

> **This issue is now largely mitigated by automatic single-instance enforcement.** `synchrotron start` automatically kills any existing daemon (including orphaned processes) before starting a new one. `npm run build` and `npm start` also stop the daemon automatically. See the [Single Instance Enforcement](README.md#single-instance-enforcement) section in the README.

### Root Cause

Old daemon processes from previous sessions can survive a `synchrotron stop` command if:

- The PID file was deleted or overwritten before the old process was signalled
- The daemon was started, a code change was made, and a new daemon started without fully killing the old one
- The machine was not rebooted between development iterations

These zombie daemons continue running the **old compiled code** in parallel with the new daemon. If the old code uses different metadata filenames (e.g. `.synchrotron` instead of `.sync`), both daemons write competing metadata files. The new daemon's `shouldIgnore` filter correctly excludes `.sync` from manifests, but the old daemon writes `.synchrotron` files that the new daemon treats as regular files to sync — creating a feedback loop.

### Diagnosis

Check for orphaned Node.js daemon processes:

```powershell
# Windows
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*synchrotron*" } | Select-Object Id, StartTime, CommandLine

# Linux / macOS
ps aux | grep synchrotron
```

If more than one process is running `dist/daemon/entry.js`, you have zombie daemons.

### Resolution

1. **Kill all daemon processes:**

    ```powershell
    # Windows
    Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*synchrotron*" } | Stop-Process -Force

    # Linux / macOS
    pkill -f "synchrotron.*entry.js"
    ```

2. **Clean up all metadata and conflict files** from every sync directory. For each directory peer, remove:
   - `.sync` (root metadata)
   - `.synchrotron` (legacy metadata)
   - `*.sync` (sidecar files)
   - `*.synchrotron` (legacy sidecars)
   - `*.sync.conflict-*` (conflict derivatives)
   - `*sync-conflict*` (conflict renamed files)

   For each file peer, remove sidecars:
   - `<filepath>.sync`
   - `<filepath>.synchrotron`

3. **Clear log files:**

    ```bash
    rm ~/.synchrotron/logs/*
    ```

4. **Start a single daemon:**

    ```bash
    synchrotron start
    ```

5. **Verify** — after ~15 seconds, the log should show:
   - Initial syncs with `+N -0 ~0 conflicts:0 errors:0` for directory sets (fresh peers receiving files)
   - File-type sets may show small conflict counts on first run (expected — all peers have content but no sidecar metadata)
   - Subsequent watcher-triggered syncs with `+0 -0 ~0 conflicts:0 errors:0`
   - No `.sync` or `.synchrotron` filenames in sync action logs

---

## Initial File Set Conflicts on First Run

### Symptoms

File-type sync sets (e.g. `AGENTS.md`, `mcp.json`) report `conflicts:3` or `conflicts:4` on the initial sync after a clean start.

### Explanation

This is **expected behaviour**. When all metadata is cleared and the daemon starts fresh, every file peer has content but no sidecar metadata. The engine sees all peers as "changed" (no previous hash to compare against), and since their content may differ, it applies the configured conflict resolution strategy (`keep-both` by default). On subsequent syncs, sidecars exist and hashes match, so conflicts drop to zero.

---

## EBUSY Errors During Sync

### Symptoms

Log shows `EBUSY: resource busy or locked` errors during sync, particularly on Windows.

### Explanation

Another process has a file lock (e.g. an editor, antivirus scanner, or indexing service). Synchrotron skips the file and retries on the next sync cycle. These errors are transient and self-resolving. If they persist for a specific file, check which process holds the lock.

---

## Watcher Not Detecting Changes

### Symptoms

Changes to files are not detected until the next poll interval.

### Possible Causes

- **Network drives**: `fs.watch` does not work on most network filesystems. Set `watchMode: poll` for affected sync sets.
- **WSL2 cross-filesystem**: Changes made inside WSL to Windows-mounted paths may not trigger `fs.watch`. Use `watchMode: poll`.
- The watcher's `shouldIgnore` filter is excluding the file. Files matching `.sync`, `*.sync`, `.sync.*`, `.synchrotron`, `.synchrotron.*`, or `*sync-conflict*` are always ignored.
