# Synchrotron

Local, platform-agnostic file synchronisation.

Synchrotron is for syncing files and folders across different paths on the same machine.

I built Synchrotron to help me replicate common sets of non version controlled utility files in multiple Git projects, but is essentially general purpose local syncing.

Synchrotron runs in the background, syncing files and folders according to a `.yaml` configuration file in your home directory.

![Synchrotron](images/synchrotron.png)

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
npm install -g @gbro3n/synchrotron
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

| Flag | Description |
|---|---|
| `--foreground` | Run in the foreground instead of as a background daemon |
| `--config <dir>` | Read config from a different directory instead of `~/.synchrotron` |

### `synchrotron stop`

Stop the running sync daemon. Sends SIGTERM for graceful shutdown, then SIGKILL after 5 seconds if needed.

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
2. A `.synchrotron` metadata file in each directory tracks the file manifest (path, size, mtime, SHA-256 hash) at the last sync.
3. On each sync cycle, the engine builds a current manifest, diffs it against the previous one, and propagates additions, modifications, and deletions across all directories in the set.
4. Empty directories (with no metadata file) are treated as **fresh peers** — they receive all files and no deletions are propagated to/from them.
5. Symlinks are skipped. Files with permission errors or locks are skipped with warnings.
6. Files larger than 10 MB are copied using Node.js streams for memory efficiency.

### File Sets

1. Each file sync set defines 2+ individual files to keep in sync (e.g. `/etc/hosts` and a backup copy).
2. Sync is **positional** — `paths[0]` is treated as the reference; if it changes, the change propagates to all other paths.
3. A `<filename>.<ext>.synchrotron` sidecar file next to each path records the hash, mtime, and size at last sync.
4. Peers with no sidecar are treated as **fresh peers** — they receive the content with no deletions involved.
5. File sets support the same conflict resolution strategies as directory sets.

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
