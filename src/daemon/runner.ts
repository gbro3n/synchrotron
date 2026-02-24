import { loadConfig } from "../config/loader.js";
import type { SynchrotronConfig } from "../config/types.js";
import { SyncEngine } from "../sync/engine.js";
import { Watcher, type ChangeEvent } from "../sync/watcher.js";
import { Logger } from "./logger.js";
import { writePidFile, removePidFile } from "./pid.js";

/**
 * Run the sync daemon in the foreground (also used by the detached daemon entry).
 * @param configDir Directory containing the config file (defaults to cwd)
 */
export function runForeground(configDir?: string): void {
    const logger = new Logger();
    let config: SynchrotronConfig;
    let running = true;

    try {
        config = loadConfig(configDir);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to load config: ${message}`);
        console.error(`Error: ${message}`);
        process.exit(1);
    }

    writePidFile();
    logger.info(`Daemon started (PID: ${process.pid})`);
    logger.info(`Config loaded: ${config.syncSets.length} sync set(s)`);

    const engine = new SyncEngine(config.conflictResolution);

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

            const label = `set[${index}]`;
            logger.info(`Syncing ${label}...`);
            try {
                const result = syncSet.type === "file"
                    ? await engine.syncFileSet(syncSet, index)
                    : await engine.syncSet(syncSet, index);
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
            const label = `set[${i}]`;
            logger.info(`Initial sync for ${label}...`);
            try {
                const result = syncSet.type === "file"
                    ? await engine.syncFileSet(syncSet, i)
                    : await engine.syncSet(syncSet, i);
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
            const label = `set[${i}]`;

            const watcher = new Watcher({
                paths: syncSet.paths,
                watchMode,
                pollInterval,
                ignorePatterns: syncSet.type === "directory" ? syncSet.ignore : undefined,
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
