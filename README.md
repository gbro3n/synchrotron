# Synchrotron

Local, platform-agnostic file synchronisation.

Synchrotron is for syncing files and folders across different paths on the same machine.

I built Synchrotron to help me replicate common sets of non version controlled utility files in multiple Git projects, but is essentially general purpose local syncing.

Synchrotron runs in the background, syncing files and folders according to a `.yaml` configuration file in your home directory. The main motivation for the `.yaml` based configuration is that the sync config can be version controlled. My personal workflow also includes version controlled copy of each of the sync sets, which acts as a backup for accidental deletes being synced across folders, and monitoring of the sync process.

![Synchrotron](https://github.com/gbro3n/synchrotron/blob/main/images/synchrotron.png?raw=true)

## Features

- **Sync sets** — group directories or individual files that should be kept in sync
- **Directory sets** — sync full directory trees across multiple locations
- **File sets** — sync individual files by content, regardless of filename differences
- **YAML configuration** — human-readable `.synchrotron.yml` config file
- **Conflict resolution** — configurable per sync set (`keep-both` or `last-write-wins`)
- **File watching** — `fs.watch` with automatic polling fallback for network drives
- **Background daemon** — runs continuously with status checking
- **Startup service** — install as a system service (systemd, launchd, Task Scheduler)
- **Cross-platform** — works on Linux, macOS, and Windows
- **Robust** — handles permission errors, locked files, symlinks, and large files

## Installation

```bash
npm install -g @gbro3n/synchrotron (coming soon)
```

## Quick Start

```bash
# Initialise config in ~/.synchrotron/.synchrotron.yml
synchrotron init

# Edit ~/.synchrotron/.synchrotron.yml to add your sync sets (see Configuration below)

# Start the sync daemon
synchrotron start

# Check status
synchrotron status

# Stop the daemon
synchrotron stop
```

## CLI Commands

### `synchrotron init`

Create a `.synchrotron.yml` configuration file in `~/.synchrotron` (config home). Edit it to add your sync sets.

| Flag | Description |
|---|---|
| `--config <dir>` | Write config to a different directory instead of `~/.synchrotron` |

### `synchrotron start`

Start the sync daemon in the background. Reads config from `~/.synchrotron/.synchrotron.yml` by default. Performs an initial sync of all sets, then watches for changes.

If a daemon is already running, it is **automatically stopped** before starting the new one. This includes orphaned daemon processes that the PID file doesn't know about (see [Single Instance Enforcement](#single-instance-enforcement) below).

| Flag | Description |
|---|---|
| `--foreground` | Run in the foreground instead of as a background daemon |
| `--config <dir>` | Read config from a different directory instead of `~/.synchrotron` |

### `synchrotron stop`

Stop the running sync daemon. Sends SIGTERM for graceful shutdown, then SIGKILL after 5 seconds if needed. Also scans for orphaned daemon processes and kills those too.

### `synchrotron status`

Show the current status of the daemon, config, and all sync sets including last sync times and file counts per directory.

| Flag | Description |
|---|---|
| `--config <dir>` | Read config from a different directory instead of `~/.synchrotron` |

### `synchrotron install-service`

Install synchrotron as a startup service for the current platform:

- **Linux** — creates a systemd user service (`~/.config/systemd/user/synchrotron.service`)
- **macOS** — creates a launchd agent (`~/Library/LaunchAgents/com.synchrotron.daemon.plist`)
- **Windows** — creates a Task Scheduler entry that runs at logon

### `synchrotron uninstall-service`

Remove the startup service for the current platform.

## Configuration

Configuration is stored in `.synchrotron.yml`:

```yaml
pollInterval: 5000
conflictResolution: keep-both

syncSets:
  # Directory set — syncs a full directory tree across multiple locations
  - name: photos
    type: directory
    paths:
      - /home/user/photos
      - /mnt/backup/photos
    ignore:
      - "*.tmp"
      - ".DS_Store"

  # Directory set with per-set overrides
  - name: documents
    type: directory
    paths:
      - /home/user/documents
      - /mnt/backup/documents
    pollInterval: 10000
    conflictResolution: last-write-wins
    watchMode: poll

  # File set — syncs individual files by content (position-based, not name-based)
  - name: hosts
    type: file
    paths:
      - /etc/hosts
      - /mnt/backup/hosts
```

### Options

| Option | Level | Applies To | Default | Description |
|---|---|---|---|---|
| `name` | Per-set | All sets | *(optional)* | Label for log readability and status display |
| `type` | Per-set | All sets | *(required)* | `directory` or `file` |
| `pollInterval` | Global / Per-set | All sets | `5000` | Milliseconds between sync cycles |
| `conflictResolution` | Global / Per-set | All sets | `keep-both` | `keep-both` or `last-write-wins` |
| `watchMode` | Per-set | Directory sets | `auto` | `auto`, `watch`, or `poll` |
| `ignore` | Per-set | Directory sets | `[]` | Glob patterns to ignore |
| `maxLogSizeMB` | Global | — | `10` | Max log file size in MB before rotation |
| `maxLogFiles` | Global | — | `5` | Max number of rotated log files to keep |

### Conflict Resolution Strategies

- **`keep-both`** (default) — renames the destination file with a `.conflict-<timestamp>` suffix and copies the source file in. Both versions are preserved.
- **`last-write-wins`** — the file with the most recent modification time overwrites the other.

### Watch Modes

- **`auto`** (default) — uses `fs.watch` for real-time detection; falls back to polling if `fs.watch` errors (e.g. on network drives).
- **`watch`** — uses `fs.watch` only. Will error if the filesystem doesn't support it.
- **`poll`** — polling only. Works everywhere but uses more CPU. Use this for network drives.

## Logging

The daemon writes to `~/.synchrotron/logs/synchrotron.log` with size-based rotation:

- When the log reaches `maxLogSizeMB` (default 10 MB), it is rotated to `synchrotron.1.log`, `synchrotron.2.log`, etc.
- At most `maxLogFiles` (default 5) rotated files are kept; older ones are deleted.

Both values can be set in `.synchrotron.yml`:

```yaml
maxLogSizeMB: 20
maxLogFiles: 3
```

Log lines include per-file action detail:

```
[2026-02-24T14:30:00.000Z] [INFO] Syncing "photos" (directory)...
[2026-02-24T14:30:00.050Z] [INFO]   + /home/user/photos/new.jpg → /mnt/backup/photos/new.jpg (added)
[2026-02-24T14:30:00.120Z] [INFO]   ~ /home/user/photos/edit.jpg → /mnt/backup/photos/edit.jpg (modified)
[2026-02-24T14:30:00.200Z] [INFO]   - /mnt/backup/photos/old.jpg (deleted)
[2026-02-24T14:30:00.250Z] [INFO] Sync "photos" complete: +1 ~1 -1 conflicts:0 errors:0
```

## How It Works

### Directory Sets

1. Each directory sync set defines 2+ directories to keep in sync.
2. A `.sync` metadata file in each directory tracks the file manifest (path, size, mtime, SHA-256 hash) at the last sync.
3. On each sync cycle, the engine builds a current manifest, diffs it against the previous one, and propagates additions, modifications, and deletions across all directories in the set.
4. Empty directories (with no metadata file) are treated as **fresh peers** — they receive all files and no deletions are propagated to/from them.
5. Symlinks are skipped. Files with permission errors or locks are skipped with warnings.
6. Files larger than 10 MB are copied using Node.js streams for memory efficiency.

### File Sets

1. Each file sync set defines 2+ individual files to keep in sync (e.g. `/etc/hosts` and a backup copy).
2. Sync is **positional** — `paths[0]` is treated as the reference; if it changes, the change propagates to all other paths.
3. A `<filename>.sync` sidecar file next to each path records the hash, mtime, and size at last sync.
4. Peers with no sidecar are treated as **fresh peers** — they receive the content with no deletions involved.
5. File sets support the same conflict resolution strategies as directory sets.

## Technical Internals

### Config Home

All runtime files live under `~/.synchrotron/`:

```
~/.synchrotron/
├── .synchrotron.yml          # Configuration file
├── daemon.pid                # PID of the running daemon process
└── logs/
    ├── synchrotron.log       # Current log file
    ├── synchrotron.1.log     # Most recent rotated log
    ├── synchrotron.2.log     # Older rotated logs...
    └── ...
```

### `.sync` — Directory Metadata Files

Each synced directory contains a hidden `.sync` file (JSON, pretty-printed) that records the state of the directory at the last completed sync. The engine uses this to compute diffs between sync cycles.

```json
{
  "lastSyncTime": 1740412200000,
  "manifest": {
    "notes.md": {
      "relativePath": "notes.md",
      "size": 2048,
      "mtimeMs": 1740412100000,
      "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    "subfolder/data.csv": {
      "relativePath": "subfolder/data.csv",
      "size": 51200,
      "mtimeMs": 1740411000000,
      "hash": "a1b2c3d4e5f6..."
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `lastSyncTime` | `number` | Milliseconds since epoch when the sync completed |
| `manifest` | `Record<string, FileEntry>` | Map of relative file paths to their entry |
| `manifest[*].relativePath` | `string` | Path relative to the sync directory root |
| `manifest[*].size` | `number` | File size in bytes |
| `manifest[*].mtimeMs` | `number` | Last modified time (ms since epoch) |
| `manifest[*].hash` | `string` | SHA-256 hex digest of the file contents |

A directory with no `.sync` file is treated as a **fresh peer** — it receives all files from other peers and never contributes deletions.

### `<file>.sync` — File Set Sidecar Metadata

For file-type sync sets, each peer file has a sidecar metadata file at `<filepath>.sync` (e.g. `/etc/hosts.sync`). It records the state of that individual file at last sync.

```json
{
  "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "mtimeMs": 1740412100000,
  "size": 2048,
  "lastSyncTime": 1740412200000
}
```

| Field | Type | Description |
|---|---|---|
| `hash` | `string` | SHA-256 hex digest of the file contents at last sync |
| `mtimeMs` | `number` | Last modified time (ms since epoch) at last sync |
| `size` | `number` | File size in bytes at last sync |
| `lastSyncTime` | `number` | Milliseconds since epoch when the sync completed |

A file with no sidecar is treated as a **fresh peer** and receives content from peers that do have metadata.

### `daemon.pid` — PID File

Located at `~/.synchrotron/daemon.pid`. Contains the process ID (as a plain integer string) of the currently running daemon.

- **Written** by the daemon on startup (`entry.ts`)
- **Read** by `synchrotron stop` and `synchrotron status` to locate the running process
- **Removed** by the daemon on graceful shutdown (SIGTERM/SIGINT handler)

If the daemon crashes or is killed without cleanup, a **stale PID file** may remain. `synchrotron status` checks whether the recorded PID is actually alive. `synchrotron start` will refuse to start if the PID file exists and the process is still running.

### `synchrotron.log` — Log File

Located at `~/.synchrotron/logs/synchrotron.log`. Each line is a timestamped, level-tagged message:

```
[<ISO-8601 timestamp>] [<LEVEL>] <message>
```

Levels are `INFO`, `WARN`, and `ERROR`. Example output from a sync cycle:

```
[2026-02-24T14:30:00.000Z] [INFO] Syncing "photos" (directory)...
[2026-02-24T14:30:00.050Z] [INFO]   + /home/user/photos/new.jpg → /mnt/backup/photos/new.jpg (added)
[2026-02-24T14:30:00.120Z] [INFO]   ~ /home/user/photos/edit.jpg → /mnt/backup/photos/edit.jpg (modified)
[2026-02-24T14:30:00.200Z] [INFO]   - /mnt/backup/photos/old.jpg (deleted)
[2026-02-24T14:30:00.250Z] [INFO] Sync "photos" complete: +1 ~1 -1 conflicts:0 errors:0
```

**Rotation**: when the log reaches `maxLogSizeMB` (default 10 MB), it is rotated:

- `synchrotron.log` → `synchrotron.1.log`
- `synchrotron.1.log` → `synchrotron.2.log`
- ... up to `maxLogFiles` (default 5); older files are deleted.

## Single Instance Enforcement

Synchrotron enforces that only one daemon process runs at a time. Multiple running daemons cause metadata conflicts and cascading file storms (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for details).

Protection is layered:

1. **`synchrotron start` kills existing daemons** — reads the PID file and kills that process, then performs a platform-specific OS process scan to find and kill any orphaned daemon processes the PID file doesn't know about.
2. **Daemon self-check** — on startup, the daemon itself checks the PID file and kills any existing daemon before claiming it. This catches cases where the daemon entry point is invoked directly.
3. **npm script hooks** — `npm run build` and `npm start` both automatically run `synchrotron stop` before proceeding, preventing the common development mistake of rebuilding without stopping.
4. **`synchrotron stop` scans for orphans** — after stopping the PID-file daemon, it scans for any remaining daemon processes.

The process scanner uses:

- **Windows**: `wmic process` to find all `node.exe` processes with synchrotron's daemon entry in the command line
- **Linux / macOS**: `ps -eo pid,args` to find matching processes

If process scanning fails (e.g. restricted permissions), the PID-file-based approach is used as a fallback.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type-check
npm run build

# Watch mode
npm run test:watch
```

### Testing locally before publishing

Build and pack a tarball containing exactly what would be published:

```bash
npm run build
npm pack
# Produces gbro3n-synchrotron-<version>.tgz
```

Install globally from the tarball and smoke-test:

```bash
npm install -g gbro3n-synchrotron-<version>.tgz
synchrotron --help
synchrotron init
```

Uninstall when done:

```bash
npm uninstall -g @gbro3n/synchrotron
```

## Disclaimer

> **USE AT YOUR OWN RISK.**
>
> Synchrotron is a file synchronisation tool. By its nature, it **reads, writes, overwrites, and deletes files** across the directories you configure. Incorrect configuration, unexpected filesystem behaviour, bugs, or hardware failures could result in **permanent data loss or corruption**.
>
> The authors and contributors of Synchrotron provide this software **"as is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability — including loss of data — arising from the use of or inability to use this software.
>
> **Always maintain independent backups of any data you intend to sync.** Do not rely on Synchrotron as your sole means of data protection.

## License

MIT
