import * as fs from "node:fs";
import { readPidFile, getPidFilePath } from "../../daemon/pid.js";
import { loadConfig, getConfigHome } from "../../config/loader.js";
import { readMetadata } from "../../sync/metadata.js";

interface StatusOptions {
    config?: string;
}

export function statusCommand(options: StatusOptions = {}): void {
    try {
        const configDir = options.config ?? getConfigHome();
        const pid = readPidFile();
        const running = pid !== null && isProcessRunning(pid);

        console.log("=== Synchrotron Status ===\n");

        if (running) {
            console.log(`Daemon: running (PID: ${pid})`);
        } else if (pid !== null) {
            console.log(`Daemon: not running (stale PID file: ${pid})`);
        } else {
            console.log("Daemon: not running");
        }

        console.log(`PID file: ${getPidFilePath()}`);
        console.log(`Config dir: ${configDir}`);
        console.log();

        // Try to load config and show sync set info
        try {
            const config = loadConfig(configDir);
            console.log(`Config: loaded (${config.syncSets.length} sync set(s))`);
            console.log(`Default poll interval: ${config.pollInterval}ms`);
            console.log(`Default conflict resolution: ${config.conflictResolution}`);
            console.log();

            if (config.syncSets.length > 0) {
                console.log("Sync Sets:");
                for (let i = 0; i < config.syncSets.length; i++) {
                    const set = config.syncSets[i];
                    const label = set.name
                        ? `[${i}] "${set.name}" (${set.type})`
                        : `[${i}] type: ${set.type}`;
                    console.log(`  ${label}`);
                    for (const p of set.paths) {
                        const exists = fs.existsSync(p);
                        if (set.type === "directory") {
                            const meta = exists ? readMetadata(p) : null;
                            const lastSync = meta
                                ? new Date(meta.lastSyncTime).toLocaleString()
                                : "never";
                            const fileCount = meta ? Object.keys(meta.manifest).length : 0;
                            const statusIcon = exists ? "✓" : "✗";
                            console.log(
                                `    ${statusIcon} ${p} (last sync: ${lastSync}, files: ${fileCount})`,
                            );
                        } else {
                            const statusIcon = exists ? "✓" : "✗";
                            console.log(`    ${statusIcon} ${p}`);
                        }
                    }
                }
            }
        } catch {
            console.log("Config: not found (run 'synchrotron init' to create one)");
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
    }
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
