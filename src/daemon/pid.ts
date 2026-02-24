import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const PID_DIR = path.join(os.homedir(), ".synchrotron");
const PID_FILE = path.join(PID_DIR, "daemon.pid");

/**
 * Get the path to the PID file.
 */
export function getPidFilePath(): string {
    return PID_FILE;
}

/**
 * Write the current process PID to the PID file.
 */
export function writePidFile(pid?: number): void {
    fs.mkdirSync(PID_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid ?? process.pid), "utf-8");
}

/**
 * Read the PID from the PID file.
 * Returns null if no PID file exists.
 */
export function readPidFile(): number | null {
    if (!fs.existsSync(PID_FILE)) {
        return null;
    }

    const content = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);

    if (isNaN(pid)) {
        return null;
    }

    return pid;
}

/**
 * Remove the PID file.
 */
export function removePidFile(): void {
    if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
    }
}
