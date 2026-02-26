/**
 * Platform-specific process discovery and management.
 *
 * Finds all Node.js processes running synchrotron's daemon entry point,
 * regardless of PID file state — the primary defense against zombie daemons.
 */
import * as child_process from "node:child_process";

export interface ProcessInfo {
    pid: number;
    commandLine: string;
}

/**
 * Find all Node.js processes whose command line contains the synchrotron
 * daemon entry point. Returns an array of { pid, commandLine }.
 *
 * Excludes the current process (if running inside a daemon).
 */
export function findSynchrotronProcesses(): ProcessInfo[] {
    try {
        if (process.platform === "win32") {
            return findProcessesWindows();
        }
        return findProcessesUnix();
    } catch {
        // If process scanning fails (permissions, missing tools), return empty.
        // Callers still have PID-file-based fallback.
        return [];
    }
}

function findProcessesWindows(): ProcessInfo[] {
    // Try wmic first (fast, available on most Windows versions)
    // Fall back to PowerShell Get-CimInstance if wmic is unavailable (removed in some Windows 11 builds)
    try {
        return findProcessesWmic();
    } catch {
        return findProcessesPowerShell();
    }
}

function findProcessesWmic(): ProcessInfo[] {
    const output = child_process.execSync(
        'wmic process where "name=\'node.exe\'" get processid,commandline /format:list',
        { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );

    const results: ProcessInfo[] = [];
    let currentCommandLine = "";
    let currentPid = 0;

    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("CommandLine=")) {
            currentCommandLine = trimmed.slice("CommandLine=".length);
        } else if (trimmed.startsWith("ProcessId=")) {
            currentPid = parseInt(trimmed.slice("ProcessId=".length), 10);
            if (currentCommandLine && currentPid && !isNaN(currentPid)) {
                results.push({ pid: currentPid, commandLine: currentCommandLine });
            }
            currentCommandLine = "";
            currentPid = 0;
        }
    }

    return filterSynchrotronProcesses(results);
}

function findProcessesPowerShell(): ProcessInfo[] {
    const output = child_process.execSync(
        "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"name='node.exe'\\\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }\"",
        { encoding: "utf-8", timeout: 10000, windowsHide: true },
    );

    const results: ProcessInfo[] = [];
    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const separatorIndex = trimmed.indexOf("|");
        if (separatorIndex === -1) continue;
        const pid = parseInt(trimmed.slice(0, separatorIndex), 10);
        const commandLine = trimmed.slice(separatorIndex + 1);
        if (!isNaN(pid) && commandLine) {
            results.push({ pid, commandLine });
        }
    }

    return filterSynchrotronProcesses(results);
}

function findProcessesUnix(): ProcessInfo[] {
    // Use ps to get all node processes with full command lines
    const output = child_process.execSync(
        "ps -eo pid,args",
        { encoding: "utf-8", timeout: 5000 },
    );

    const results: ProcessInfo[] = [];
    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        if (match) {
            const pid = parseInt(match[1], 10);
            const commandLine = match[2];
            if (!isNaN(pid)) {
                results.push({ pid, commandLine });
            }
        }
    }

    return filterSynchrotronProcesses(results);
}

/**
 * Filter to only synchrotron daemon entry processes, excluding the current PID.
 */
function filterSynchrotronProcesses(processes: ProcessInfo[]): ProcessInfo[] {
    const currentPid = process.pid;
    return processes.filter((p) => {
        if (p.pid === currentPid) return false;
        // Match the daemon entry point pattern — handles both dist/ and src/ paths
        return /synchrotron[/\\].*(?:daemon[/\\]entry|daemon\/entry)/i.test(p.commandLine);
    });
}

/**
 * Check whether a process with the given PID is alive.
 */
export function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Kill a process by PID: SIGTERM first, then SIGKILL after a timeout.
 * Returns true if the process was successfully killed or was already dead.
 */
export function killProcess(pid: number, timeoutMs: number = 5000): boolean {
    if (!isProcessRunning(pid)) {
        return true;
    }

    try {
        process.kill(pid, "SIGTERM");
    } catch {
        return true; // Process already gone
    }

    // Wait for the process to exit
    const deadline = Date.now() + timeoutMs;
    const checkInterval = 100;

    while (Date.now() < deadline) {
        if (!isProcessRunning(pid)) {
            return true;
        }
        // Synchronous sleep — acceptable for a short startup operation
        child_process.execSync(
            process.platform === "win32"
                ? `ping -n 1 -w ${checkInterval} 127.0.0.1 >nul`
                : `sleep 0.1`,
            { stdio: "ignore", timeout: checkInterval + 500 },
        );
    }

    // Force kill if still alive
    if (isProcessRunning(pid)) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // Process may have exited between check and kill
        }
    }

    return !isProcessRunning(pid);
}

/**
 * Kill all synchrotron daemon processes found on the system (except self).
 * Returns the list of PIDs that were targeted.
 */
export function killAllSynchrotronProcesses(): number[] {
    const processes = findSynchrotronProcesses();
    const killed: number[] = [];

    for (const proc of processes) {
        killProcess(proc.pid);
        killed.push(proc.pid);
    }

    return killed;
}
