import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { WatchMode } from "../config/types.js";
import { CONFIG_DEFAULTS } from "../config/types.js";

export interface WatcherOptions {
    /** Directories or files to watch */
    paths: string[];
    /** Watch mode: auto, watch, or poll */
    watchMode: WatchMode;
    /** Poll interval in milliseconds (used for poll and auto fallback) */
    pollInterval: number;
    /** Glob patterns to ignore */
    ignorePatterns?: string[];
    /** When true, treat all paths as individual files (use file-specific watchers even if the path doesn't exist yet) */
    pathsAreFiles?: boolean;
}

export interface ChangeEvent {
    type: "change" | "rename";
    filePath: string;
    dirPath: string;
}

/**
 * File watcher with fs.watch primary and polling fallback.
 * Emits 'change' events when files in watched directories change.
 */
export class Watcher extends EventEmitter {
    private options: WatcherOptions;
    private fsWatchers: fs.FSWatcher[] = [];
    private pollTimers: NodeJS.Timeout[] = [];
    private running = false;
    private previousSnapshots = new Map<string, Map<string, number>>();

    constructor(options: WatcherOptions) {
        super();
        this.options = {
            ...options,
            ignorePatterns: options.ignorePatterns ?? [],
        };
    }

    /**
     * Start watching directories and/or individual files.
     */
    start(): void {
        if (this.running) return;
        this.running = true;

        for (const watchPath of this.options.paths) {
            // Determine if path is a file or directory
            let isFile = this.options.pathsAreFiles ?? false;
            if (!isFile) {
                try {
                    const stat = fs.lstatSync(watchPath);
                    isFile = stat.isFile();
                } catch {
                    // Path doesn't exist yet — use pathsAreFiles hint or fall back to directory watch
                }
            }

            if (isFile) {
                if (this.options.watchMode === "poll") {
                    this.startPollingFile(watchPath);
                } else if (this.options.watchMode === "watch") {
                    this.startFsWatchFile(watchPath);
                } else {
                    this.startAutoWatchFile(watchPath);
                }
            } else {
                if (this.options.watchMode === "poll") {
                    this.startPolling(watchPath);
                } else if (this.options.watchMode === "watch") {
                    this.startFsWatch(watchPath);
                } else {
                    this.startAutoWatch(watchPath);
                }
            }
        }
    }

    /**
     * Stop watching all directories.
     */
    stop(): void {
        this.running = false;

        for (const watcher of this.fsWatchers) {
            watcher.close();
        }
        this.fsWatchers = [];

        for (const timer of this.pollTimers) {
            clearInterval(timer);
        }
        this.pollTimers = [];

        this.previousSnapshots.clear();
    }

    /**
     * Check if the watcher is currently running.
     */
    isRunning(): boolean {
        return this.running;
    }

    private shouldIgnore(filePath: string): boolean {
        const basename = path.basename(filePath);
        return basename === CONFIG_DEFAULTS.metadataFileName;
    }

    private startFsWatch(dirPath: string): void {
        try {
            const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
                if (!this.running || !filename) return;
                if (this.shouldIgnore(filename)) return;

                this.emit("change", {
                    type: eventType as "change" | "rename",
                    filePath: path.join(dirPath, filename),
                    dirPath,
                } satisfies ChangeEvent);
            });

            watcher.on("error", (err) => {
                this.emit("error", { dirPath, error: err });
            });

            this.fsWatchers.push(watcher);
        } catch (err) {
            this.emit("error", { dirPath, error: err });
        }
    }

    private startAutoWatch(dirPath: string): void {
        try {
            this.startFsWatch(dirPath);

            // If fs.watch fails, the error handler won't add the watcher.
            // We check if the watcher was successfully added.
            const lastWatcher = this.fsWatchers[this.fsWatchers.length - 1];
            if (lastWatcher) {
                // Attach a one-time error handler to fall back to polling
                lastWatcher.on("error", () => {
                    lastWatcher.close();
                    this.fsWatchers = this.fsWatchers.filter((w) => w !== lastWatcher);
                    this.startPolling(dirPath);
                });
            } else {
                this.startPolling(dirPath);
            }
        } catch {
            this.startPolling(dirPath);
        }
    }

    private startPolling(dirPath: string): void {
        // Take initial snapshot
        this.previousSnapshots.set(dirPath, this.takeSnapshot(dirPath));

        const timer = setInterval(() => {
            if (!this.running) return;

            const currentSnapshot = this.takeSnapshot(dirPath);
            const previousSnapshot = this.previousSnapshots.get(dirPath) ?? new Map();

            // Detect changes
            for (const [filePath, mtime] of currentSnapshot) {
                const prevMtime = previousSnapshot.get(filePath);
                if (prevMtime === undefined) {
                    // New file
                    this.emit("change", {
                        type: "rename",
                        filePath,
                        dirPath,
                    } satisfies ChangeEvent);
                } else if (mtime !== prevMtime) {
                    // Modified file
                    this.emit("change", {
                        type: "change",
                        filePath,
                        dirPath,
                    } satisfies ChangeEvent);
                }
            }

            // Detect deletions
            for (const [filePath] of previousSnapshot) {
                if (!currentSnapshot.has(filePath)) {
                    this.emit("change", {
                        type: "rename",
                        filePath,
                        dirPath,
                    } satisfies ChangeEvent);
                }
            }

            this.previousSnapshots.set(dirPath, currentSnapshot);
        }, this.options.pollInterval);

        this.pollTimers.push(timer);
    }

    // ─── Individual file watchers ─────────────────────────────────────────────

    private startFsWatchFile(filePath: string): void {
        try {
            const watcher = fs.watch(filePath, (eventType) => {
                if (!this.running) return;
                this.emit("change", {
                    type: eventType as "change" | "rename",
                    filePath,
                    dirPath: path.dirname(filePath),
                } satisfies ChangeEvent);
            });

            watcher.on("error", (err) => {
                this.emit("error", { dirPath: filePath, error: err });
            });

            this.fsWatchers.push(watcher);
        } catch (err) {
            this.emit("error", { dirPath: filePath, error: err });
        }
    }

    private startAutoWatchFile(filePath: string): void {
        try {
            this.startFsWatchFile(filePath);
            const lastWatcher = this.fsWatchers[this.fsWatchers.length - 1];
            if (lastWatcher) {
                lastWatcher.on("error", () => {
                    lastWatcher.close();
                    this.fsWatchers = this.fsWatchers.filter((w) => w !== lastWatcher);
                    this.startPollingFile(filePath);
                });
            } else {
                this.startPollingFile(filePath);
            }
        } catch {
            this.startPollingFile(filePath);
        }
    }

    private startPollingFile(filePath: string): void {
        // Take initial snapshot (just the one file's mtime)
        const getFileMtime = (): number | null => {
            try {
                return fs.statSync(filePath).mtimeMs;
            } catch {
                return null;
            }
        };

        let previousMtime = getFileMtime();

        const timer = setInterval(() => {
            if (!this.running) return;
            const currentMtime = getFileMtime();

            if (currentMtime !== previousMtime) {
                this.emit("change", {
                    type: currentMtime === null ? "rename" : "change",
                    filePath,
                    dirPath: path.dirname(filePath),
                } satisfies ChangeEvent);
                previousMtime = currentMtime;
            }
        }, this.options.pollInterval);

        this.pollTimers.push(timer);
    }

    /**
     * Take a snapshot of all files in a directory (path → mtime).
     */
    private takeSnapshot(dirPath: string): Map<string, number> {
        const snapshot = new Map<string, number>();

        function walk(currentPath: string): void {
            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    if (entry.isDirectory()) {
                        walk(fullPath);
                    } else if (entry.isFile()) {
                        try {
                            const stat = fs.statSync(fullPath);
                            snapshot.set(fullPath, stat.mtimeMs);
                        } catch {
                            // File may have been deleted between readdir and stat
                        }
                    }
                }
            } catch {
                // Directory may not exist or be inaccessible
            }
        }

        walk(dirPath);
        return snapshot;
    }
}
