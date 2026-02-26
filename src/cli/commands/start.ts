import * as child_process from "node:child_process";
import * as path from "node:path";
import { loadConfig, getConfigHome } from "../../config/loader.js";
import { getPidFilePath, readPidFile, removePidFile } from "../../daemon/pid.js";
import { runForeground } from "../../daemon/runner.js";
import {
    findSynchrotronProcesses,
    isProcessRunning,
    killProcess,
    killAllSynchrotronProcesses,
} from "../../daemon/process.js";

interface StartOptions {
    foreground?: boolean;
    config?: string;
}

export function startCommand(options: StartOptions): void {
    try {
        const configDir = options.config ?? getConfigHome();

        // Verify config exists and is valid before starting
        loadConfig(configDir);

        // --- Zombie prevention: kill ALL existing synchrotron daemon processes ---
        // 1. Kill process from PID file (fast path)
        const existingPid = readPidFile();
        if (existingPid !== null) {
            if (isProcessRunning(existingPid)) {
                console.log(`Stopping existing daemon (PID: ${existingPid})...`);
                killProcess(existingPid);
            }
            removePidFile();
        }

        // 2. Scan for orphaned processes the PID file doesn't know about
        const orphans = findSynchrotronProcesses();
        if (orphans.length > 0) {
            console.log(`Found ${orphans.length} orphaned daemon process(es). Killing...`);
            killAllSynchrotronProcesses();
        }

        if (options.foreground) {
            console.log("Starting synchrotron in foreground mode...");
            runForeground(configDir);
            return;
        }

        // Spawn detached daemon process
        const daemonScript = path.join(__dirname, "..", "..", "daemon", "entry.js");

        const child = child_process.spawn(process.execPath, [daemonScript, configDir], {
            detached: true,
            stdio: "ignore",
            cwd: configDir,
            windowsHide: true,
        });

        child.unref();

        console.log(`Synchrotron daemon started (PID: ${child.pid}).`);
        console.log(`Config: ${configDir}`);
        console.log(`PID file: ${getPidFilePath()}`);
        console.log("Use 'synchrotron status' to check the daemon status.");
        console.log("Use 'synchrotron stop' to stop the daemon.");
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
    }
}
