import * as child_process from "node:child_process";
import * as path from "node:path";
import { loadConfig, getConfigHome } from "../../config/loader.js";
import { getPidFilePath, readPidFile } from "../../daemon/pid.js";
import { runForeground } from "../../daemon/runner.js";

interface StartOptions {
    foreground?: boolean;
    config?: string;
}

export function startCommand(options: StartOptions): void {
    try {
        const configDir = options.config ?? getConfigHome();

        // Verify config exists and is valid before starting
        loadConfig(configDir);

        // Check if already running
        const existingPid = readPidFile();
        if (existingPid !== null) {
            if (isProcessRunning(existingPid)) {
                console.error(`Synchrotron daemon is already running (PID: ${existingPid}).`);
                process.exit(1);
            }
            // Stale PID file — will be overwritten
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

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
