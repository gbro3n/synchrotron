import { readPidFile, removePidFile } from "../../daemon/pid.js";
import {
    findSynchrotronProcesses,
    isProcessRunning,
    killProcess,
    killAllSynchrotronProcesses,
} from "../../daemon/process.js";

export function stopCommand(): void {
    try {
        const pid = readPidFile();
        let pidHandled = false;

        if (pid !== null) {
            if (isProcessRunning(pid)) {
                console.log(`Stopping synchrotron daemon (PID: ${pid})...`);
                const killed = killProcess(pid);
                if (killed) {
                    console.log("Daemon stopped successfully.");
                } else {
                    console.error(`Failed to stop daemon (PID: ${pid}).`);
                }
            } else {
                console.log(`Daemon process (PID: ${pid}) is no longer running. Cleaning up PID file.`);
            }
            removePidFile();
            pidHandled = true;
        }

        // Scan for orphaned processes the PID file doesn't know about
        const orphans = findSynchrotronProcesses();
        if (orphans.length > 0) {
            console.log(`Found ${orphans.length} orphaned daemon process(es). Killing...`);
            const killed = killAllSynchrotronProcesses();
            for (const orphanPid of killed) {
                console.log(`  Killed orphaned process (PID: ${orphanPid}).`);
            }
        } else if (!pidHandled) {
            console.log("No synchrotron daemon is running.");
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
    }
}
