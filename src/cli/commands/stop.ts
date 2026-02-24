import { readPidFile, removePidFile } from "../../daemon/pid.js";

export function stopCommand(): void {
    try {
        const pid = readPidFile();

        if (pid === null) {
            console.log("No synchrotron daemon is running (no PID file found).");
            return;
        }

        if (!isProcessRunning(pid)) {
            console.log(`Daemon process (PID: ${pid}) is no longer running. Cleaning up PID file.`);
            removePidFile();
            return;
        }

        // Send SIGTERM for graceful shutdown
        try {
            process.kill(pid, "SIGTERM");
            console.log(`Sent stop signal to synchrotron daemon (PID: ${pid}).`);

            // Wait for process to exit (up to 5 seconds)
            let attempts = 0;
            const maxAttempts = 50;
            const checkInterval = 100;

            const waitForExit = (): void => {
                if (!isProcessRunning(pid)) {
                    removePidFile();
                    console.log("Daemon stopped successfully.");
                    return;
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    console.log("Daemon did not stop within 5 seconds. Sending force kill...");
                    try {
                        process.kill(pid, "SIGKILL");
                    } catch {
                        // Process may have already exited
                    }
                    removePidFile();
                    console.log("Daemon force killed.");
                    return;
                }
                setTimeout(waitForExit, checkInterval);
            };

            waitForExit();
        } catch {
            console.error(`Failed to send stop signal to PID ${pid}.`);
            removePidFile();
            process.exit(1);
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
