# Synchrotron — Technical Reference for Agents

> This document is a deep technical reference for AI coding agents working on the Synchrotron codebase. Read `README.md` first for the user-facing overview.

## Architecture Overview

Synchrotron is a TypeScript/Node.js local file synchronisation daemon. It syncs files and directories across paths on the same machine, running as a background process.

```
src/
├── cli/                    # Commander.js CLI entry points
│   ├── index.ts            # CLI root (commander program)
│   └── commands/           # One file per command (init, start, stop, status, install-service, uninstall-service)
├── config/
│   ├── types.ts            # All type definitions, interfaces, CONFIG_DEFAULTS
│   ├── loader.ts           # YAML config loading, validation, getConfigHome()
│   └── index.ts            # Re-exports
├── daemon/
│   ├── entry.ts            # Daemon process entry point (spawned by `start` command)
│   ├── runner.ts           # Core daemon loop: initial sync → start watchers → handle changes
│   ├── logger.ts           # Logger with size-based rotation
│   ├── pid.ts              # PID file management
│   └── process.ts          # Process discovery, zombie detection & killing
├── sync/
│   ├── engine.ts           # SyncEngine class: syncSet() for directories, syncFileSet() for files
│   ├── manifest.ts         # buildManifest(), diffManifests(), shouldIgnore()
│   ├── metadata.ts         # Read/write .sync directory metadata files
│   ├── file-metadata.ts    # Read/write <file>.sync sidecar files for file-type sets
│   ├── watcher.ts          # Watcher class: fs.watch + polling fallback
│   └── index.ts            # Re-exports
├── service/                # Platform-specific service installers (systemd, launchd, Task Scheduler)
├── utils/
│   └── fileops.ts          # File operation helpers
└── index.ts                # Package entry point
```

## Single Source of Truth: CONFIG_DEFAULTS

All metadata filenames and extensions are defined in `src/config/types.ts`:

```typescript
export const CONFIG_DEFAULTS = {
    pollInterval: 5000,
    conflictResolution: "keep-both" as ConflictResolution,
    maxLogSizeMB: 10,
    maxLogFiles: 5,
    configFileName: ".synchrotron.yml",    // Config file name (NOT a sync artifact)
    metadataFileName: ".sync",             // Directory metadata file
    sidecarExtension: ".sync",             // Sidecar extension for file-type sets
} as const;
```

**Every** reference to metadata file naming **must** use `CONFIG_DEFAULTS`. Never hardcode `.sync` or `.synchrotron` strings in sync logic.

## Metadata System

### Directory Sets

Each synced directory contains a `.sync` file (JSON) that stores:

```typescript
interface SyncMetadata {
    lastSyncTime: number;      // ms since epoch
    manifest: Record<string, FileEntry>;  // relativePath → { hash, size, mtimeMs }
}
```

- Written by `writeMetadata()` in `src/sync/metadata.ts`
- Read by `readMetadata()` — returns `null` if the file does not exist (fresh peer)
- Path: `path.join(dirPath, CONFIG_DEFAULTS.metadataFileName)`

### File Sets

Each synced file has a sidecar file (`<filepath>.sync`) that stores:

```typescript
interface FileSyncMetadata {
    hash: string;
    mtimeMs: number;
    size: number;
    lastSyncTime: number;
}
```

- Written/read by `writeFileMetadata()` / `readFileMetadata()` in `src/sync/file-metadata.ts`
- Path: `filePath + CONFIG_DEFAULTS.sidecarExtension`

### Conflict Files

When `keep-both` resolution is applied:

- **Directory sets**: destination is renamed to `<base>.sync-conflict.<ISO-timestamp><ext>`
- **File sets**: peer is renamed to `<base>.sync-conflict.<ISO-timestamp><ext>`

## The shouldIgnore Filter — CRITICAL

Both `manifest.ts` and `watcher.ts` implement `shouldIgnore()` to prevent metadata and conflict files from being treated as regular sync content. **These two implementations must stay in sync.**

Current checks (in order):

| # | Check | Purpose |
|---|-------|---------|
| 1 | `basename === CONFIG_DEFAULTS.metadataFileName` | Exact match: `.sync` |
| 2 | `basename.endsWith(CONFIG_DEFAULTS.sidecarExtension)` | Any file ending in `.sync` (sidecar files) |
| 3 | `basename.startsWith(CONFIG_DEFAULTS.metadataFileName + ".")` | Derivatives: `.sync.*` (e.g. `.sync.conflict-*`) |
| 4 | `basename === ".synchrotron" \|\| basename.startsWith(".synchrotron.")` | Legacy backward compat |
| 5 | `basename.includes("sync-conflict")` | Conflict renamed files |
| 6 | User-defined ignore patterns via minimatch *(manifest.ts only)* | Per-set `ignore` globs |

### What happens if shouldIgnore is wrong

If a metadata/conflict file passes through `shouldIgnore`:

1. It appears in `buildManifest()` as a regular file entry
2. The sync engine copies it to peer directories as a regular file
3. This creates new metadata files in peers, which triggers more watcher events
4. Each watcher event triggers another sync, which finds more metadata files to sync
5. **Exponential conflict cascade** — tens of thousands of files in seconds

This is the single most dangerous failure mode in Synchrotron.

### Rules for modifying shouldIgnore

- **Always update both** `manifest.ts` and `watcher.ts` when changing ignore logic
- **Test with the actual daemon** — unit tests cannot catch all race conditions
- If you rename metadata files, add backward-compat rules for the old names to prevent legacy files from leaking through
- When in doubt, be more aggressive with filtering — a false ignore is far less damaging than a missed one

## Sync Engine Flow

### Directory Set Sync (`engine.ts → syncSet()`)

```
1. Ensure all directories exist (create missing ones)
2. For each directory:
   a. buildManifest(dirPath, ignorePatterns) → currentManifest
   b. readMetadata(dirPath) → previousMetadata (null = fresh peer)
   c. diffManifests(previousManifest, currentManifest) → { added, deleted, modified, unchanged }
3. For each (source, dest) pair where source ≠ dest:
   a. If dest is fresh: copy ALL source files → dest (additions only, no deletions)
   b. Otherwise: propagate source.diff.added → dest (copy or conflict)
   c. Propagate source.diff.modified → dest (copy or conflict if dest also modified)
   d. Propagate source.diff.deleted → dest (delete only if dest unchanged)
4. After all pairs processed: writeMetadata() for every directory with updated manifest
```

### File Set Sync (`engine.ts → syncFileSet()`)

```
1. For each peer file:
   a. Check exists, read sidecar metadata, compute current hash
   b. Classify as: changed (exists + hash differs from sidecar), fresh (no file + no sidecar), or unchanged
2. If no changed and no fresh peers → return (nothing to do)
3. If changed peers exist:
   a. Pick the single changed peer (or conflict-resolve if multiple changed)
   b. Copy winner to all other peers
4. If only fresh peers exist (no content changes):
   a. Copy from any existing peer to populate the fresh ones
5. Write sidecar metadata for all peers
```

### Fresh Peer Semantics

A "fresh peer" is a directory or file with **no metadata**. This indicates it has never been synced.

- **Directory set**: a directory with no `.sync` file inside it
- **File set**: a file path with no `<path>.sync` sidecar

Fresh peers receive content from other peers but never contribute changes or deletions. After the first sync, metadata is written and the peer is no longer fresh.

**Implication**: Deleting all metadata files causes ALL peers to become fresh on next sync. Since every peer is fresh, the engine copies ALL files from every peer to every other peer. If the files are identical this is harmless (just redundant copies). If files differ, conflicts occur.

## Watcher System

The `Watcher` class (`src/sync/watcher.ts`) emits `change` events.

- **Directory sets**: watches the directory recursively with `fs.watch({ recursive: true })`
- **File sets**: watches individual files (or their parent dirs on platforms that require it)
- `pathsAreFiles` option tells the watcher to treat all paths as individual files
- `shouldIgnore()` filters out metadata/conflict changes before emitting

The daemon's `runner.ts` debounces change events (1 second) before triggering a sync. Multiple rapid changes to the same sync set are collapsed into one sync call.

## Daemon Lifecycle

```
CLI `start`:
  1. Kill process from PID file (if alive)
  2. Scan for orphaned synchrotron daemon processes → kill all
  3. Spawn detached child process running dist/daemon/entry.js

  → entry.ts loads config, calls runForeground()
  → runner.ts:
    1. Self-check: read existing PID file, kill that process if alive
    2. Write own PID file
    3. Register SIGTERM/SIGINT handlers
    4. Run initialSync() for all sync sets (sequential)
    5. Start watchers for all sync sets
    6. Wait for change events → scheduleSyncSet() with debounce
    7. On shutdown signal → stop watchers, remove PID file, exit
```

The `start` command now **automatically stops any existing daemon** (including zombies) before spawning. The old behaviour of refusing to start if a daemon was running has been replaced with a stop-then-start approach, since the zombie problem made the "refuse" behaviour actively harmful.

## Zombie Daemon Prevention

Synchrotron has multiple layers of protection against zombie daemon processes:

### Layer 1 — Process scan on `start` (primary defense)

`src/daemon/process.ts` provides `findSynchrotronProcesses()` which performs a platform-specific OS process scan (WMIC on Windows, `ps` on Unix) to find ALL node processes running `synchrotron.*daemon/entry`, regardless of PID file state.

The `start` command (`src/cli/commands/start.ts`):

1. Reads the PID file and kills that process if alive
2. Scans for orphaned daemon processes the PID file doesn't know about
3. Kills all orphans
4. Only then spawns the new daemon

This means `synchrotron start` is now **always safe** — it automatically replaces any running daemon.

### Layer 2 — Daemon self-check on startup

`runner.ts` reads the existing PID file before writing its own. If another daemon is still alive, it kills it first. This catches cases where the daemon is started directly (bypassing the CLI).

### Layer 3 — npm script hooks for development

`package.json` has `prebuild` and `prestart` hooks that run `synchrotron stop` before every `npm run build` and `npm start`. This prevents the most common development mistake: rebuilding without stopping the daemon.

### Layer 4 — Process scan on `stop` (fallback)

The `stop` command now also scans for orphaned processes after handling the PID file, ensuring `synchrotron stop` catches zombies even with a stale/missing PID file.

### Previous Problem (now mitigated)

See `TROUBLESHOOTING.md` for the full history. In summary, old daemon processes could survive a `stop` command if the PID file was stale, creating metadata conflicts and cascading file storms. The process scanner now eliminates this class of bug.

## Build and Test

```bash
npm run build     # tsc → dist/ (auto-stops daemon via prebuild hook)
npm test          # vitest (85 tests across 9 files)
npm run test:watch
```

The compiled JS in `dist/` is what the daemon executes. After any source change, you **must** `npm run build` before restarting the daemon. The daemon does not use ts-node — it runs the compiled JavaScript directly.

**Note**: `npm run build` and `npm start` both run `synchrotron stop` automatically via npm script hooks (`prebuild`/`prestart`), so you no longer need to manually stop the daemon before rebuilding.

Test files:

| File | Covers |
|------|--------|
| `tests/cli.test.ts` | CLI commands, argument parsing |
| `tests/config.test.ts` | Config loading, validation, defaults |
| `tests/engine.test.ts` | SyncEngine directory set sync logic |
| `tests/file-engine.test.ts` | SyncEngine file set sync logic |
| `tests/manifest.test.ts` | Manifest building, diffing, shouldIgnore |
| `tests/metadata.test.ts` | Metadata read/write/fresh peer detection |
| `tests/file-metadata.test.ts` | Sidecar metadata read/write |
| `tests/process.test.ts` | Process discovery, zombie detection |
| `tests/e2e.test.ts` | End-to-end daemon lifecycle |

## Common Pitfalls for Agents

### 1. Forgetting to rebuild

The daemon runs `dist/` JS, not TypeScript source. If you edit `.ts` files but forget `npm run build`, the daemon still runs the old code. **Mitigated**: the `prebuild` npm hook now auto-stops the running daemon, and `synchrotron start` auto-kills old processes. But you still need to `npm run build` before `synchrotron start`.

### 2. Leaving zombie daemons running

**Largely mitigated** by the multi-layer zombie prevention system (see "Zombie Daemon Prevention" above). `synchrotron start` now automatically kills all existing daemon processes before spawning a new one, and `npm run build` stops the daemon via a prebuild hook. Manual process killing should no longer be necessary.

### 3. Editing shouldIgnore in only one place

`shouldIgnore()` exists in **two files**: `manifest.ts` (used during sync to build file lists) and `watcher.ts` (used to filter change events). If you update one but not the other, metadata files will leak through the gap and cause conflict cascades.

### 4. Not cleaning up after metadata naming changes

If you rename metadata files (e.g. `.synchrotron` → `.sync`), old-named files already on disk will remain. The sync engine will treat them as regular content files to sync (unless shouldIgnore has backward-compat rules). You must:

- Add legacy name checks to `shouldIgnore()` in both files
- Manually delete all old-named files from every sync directory and file peer
- Delete all sidecar files so fresh metadata is created with the new naming

### 5. Underestimating the conflict cascade

With N peer directories and M files per directory, a single metadata file leaking into manifests creates M×N² sync actions per cycle. With watchers triggering syncs on every file write, this compounds exponentially. A 4-peer directory set with 10 files can produce 1,000+ conflict files within seconds.

### 6. Testing only with unit tests

Unit tests run in isolated temp directories and cannot reproduce:

- Race conditions between watchers and sync cycles
- Multiple syncs triggered by rapid file changes
- EBUSY errors from concurrent file access on Windows
- Interaction between overlapping sync sets

Always verify changes with the actual daemon on real sync directories.
