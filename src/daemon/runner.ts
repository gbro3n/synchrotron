import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config/loader.js";
import type { SynchrotronConfig } from "../config/types.js";
import { SyncEngine } from "../sync/engine.js";
import { Watcher, type ChangeEvent } from "../sync/watcher.js";
import { Logger } from "./logger.js";
import { writePidFile, readPidFile, removePidFile } from "./pid.js";
import { isProcessRunning, killProcess } from "./process.js";

/**
 * Run the sync daemon in the foreground (also used by the detached daemon entry).
 * @param configDir Directory containing the config file (defaults to cwd)
 */
export function runForeground(configDir?: string): void {
    let config: SynchrotronConfig;
    let running = true;
    let logger: Logger;

    try {
        config = loadConfig(configDir);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Create a default logger just to record the startup failure
        logger = new Logger();
        logger.error(`Failed to load config: ${message}`);
        console.error(`Error: ${message}`);
        process.exit(1);
    }

    logger = new Logger({
        maxLogSizeMB: config.maxLogSizeMB,
        maxLogFiles: config.maxLogFiles,
    });

    // --- Self-check: kill any existing daemon before claiming PID file ---
    const existingPid = readPidFile();
    if (existingPid !== null && existingPid !== process.pid && isProcessRunning(existingPid)) {
        logger.info(`Found existing daemon (PID: ${existingPid}). Killing before startup...`);
        killProcess(existingPid);
    }

    writePidFile();
    logger.info(`Daemon started (PID: ${process.pid})`);
    logger.info(`Config loaded: ${config.syncSets.length} sync set(s)`);

    const engine = new SyncEngine(config.conflictResolution);

    /**
     * Build a human-readable label for a sync set.
     * Uses the optional name if present, otherwise falls back to index.
     */
    function setLabel(index: number): string {
        const syncSet = config.syncSets[index];
        return syncSet?.name ? `"${syncSet.name}"` : `set[${index}]`;
    }

    /**
     * Log each per-file action from a sync result.
     */
    function logActions(result: import("../sync/engine.js").SyncResult): void {
        for (const action of result.actions) {
            switch (action.type) {
                case "added":
                    logger.info(`  + ${action.sourcePath} → ${action.destPath} (added)`);
                    break;
                case "modified":
                    logger.info(`  ~ ${action.sourcePath} → ${action.destPath} (modified)`);
                    break;
                case "deleted":
                    logger.info(`  - ${action.sourcePath} (deleted)`);
                    break;
                case "conflict":
                    logger.info(
                        `  ! ${action.sourcePath} → ${action.destPath ?? "?"} (conflict: ${action.detail ?? "unknown"})`,
                    );
                    break;
                case "error":
                    logger.error(
                        `  ✗ ${action.sourcePath}${action.destPath ? ` → ${action.destPath}` : ""} (${action.detail ?? "error"})`,
                    );
                    break;
            }
        }
    }

    // Set up graceful shutdown
    const shutdown = (): void => {
        if (!running) return;
        running = false;
        logger.info("Shutdown signal received. Stopping...");
        stopWatchers();
        removePidFile();
        logger.info("Daemon stopped.");
        process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // Track watchers and debounce timers
    const watchers: Watcher[] = [];
    const debounceTimers = new Map<string, NodeJS.Timeout>();
    const DEBOUNCE_MS = 1000;

    function stopWatchers(): void {
        for (const watcher of watchers) {
            watcher.stop();
        }
        watchers.length = 0;
        for (const timer of debounceTimers.values()) {
            clearTimeout(timer);
        }
        debounceTimers.clear();
    }

    // Sync a specific set with debouncing (identified by index)
    function scheduleSyncSet(index: number): void {
        const key = String(index);
        const existing = debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(async () => {
            debounceTimers.delete(key);
            const syncSet = config.syncSets[index];
            if (!syncSet) return;

            const label = setLabel(index);
            logger.info(`Syncing ${label} (${syncSet.type})...`);
            try {
                const result = syncSet.type === "file"
                    ? await engine.syncFileSet(syncSet, index)
                    : await engine.syncSet(syncSet, index);
                logActions(result);
                logger.info(
                    `Sync ${label} complete: ` +
                    `+${result.filesAdded} -${result.filesDeleted} ~${result.filesModified} ` +
                    `conflicts:${result.conflicts} errors:${result.errors.length}`,
                );
                for (const error of result.errors) {
                    logger.error(`  ${error}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error(`Sync ${label} failed: ${message}`);
            }
        }, DEBOUNCE_MS);

        debounceTimers.set(key, timer);
    }

    // Do an initial sync for all sets
    async function initialSync(): Promise<void> {
        for (let i = 0; i < config.syncSets.length; i++) {
            const syncSet = config.syncSets[i];
            const label = setLabel(i);
            logger.info(`Initial sync for ${label} (${syncSet.type})...`);
            try {
                const result = syncSet.type === "file"
                    ? await engine.syncFileSet(syncSet, i)
                    : await engine.syncSet(syncSet, i);
                logActions(result);
                logger.info(
                    `Initial sync ${label} complete: ` +
                    `+${result.filesAdded} -${result.filesDeleted} ~${result.filesModified} ` +
                    `conflicts:${result.conflicts} errors:${result.errors.length}`,
                );
                for (const error of result.errors) {
                    logger.error(`  ${error}`);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error(`Initial sync ${label} failed: ${message}`);
            }
        }
    }

    // Start watchers for each sync set
    function startWatchers(): void {
        for (let i = 0; i < config.syncSets.length; i++) {
            const syncSet = config.syncSets[i];
            const pollInterval = syncSet.pollInterval ?? config.pollInterval;
            const watchMode = syncSet.type === "file" ? "auto" : (syncSet.watchMode ?? "auto");
            const label = setLabel(i);

            // Ensure directories exist before watching.
            // For directory sets: create missing dirs (they are valid fresh peers).
            // For file sets: create parent directories of missing files.
            for (const p of syncSet.paths) {
                const dirToEnsure = syncSet.type === "directory" ? p : path.dirname(p);
                if (!fs.existsSync(dirToEnsure)) {
                    try {
                        fs.mkdirSync(dirToEnsure, { recursive: true });
                        logger.info(`Created missing directory: ${dirToEnsure}`);
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        logger.warn(`Cannot create directory ${dirToEnsure}: ${message}`);
                    }
                }
            }

            const watcher = new Watcher({
                paths: syncSet.paths,
                watchMode,
                pollInterval,
                ignorePatterns: syncSet.type === "directory" ? syncSet.ignore : undefined,
                pathsAreFiles: syncSet.type === "file",
            });

            const idx = i;
            watcher.on("change", (_event: ChangeEvent) => {
                scheduleSyncSet(idx);
            });

            watcher.on("error", (err: { dirPath: string; error: Error }) => {
                logger.warn(`Watcher error for ${label} at ${err.dirPath}: ${err.error.message}`);
            });

            watcher.start();
            watchers.push(watcher);
            logger.info(`Watcher started for ${label} (mode: ${watchMode}, poll: ${pollInterval}ms)`);
        }
    }

    // Run
    initialSync().then(() => {
        if (running) {
            startWatchers();
            logger.info("All watchers started. Daemon is running.");
        }
    });
}
