import * as path from "node:path";
import * as child_process from "node:child_process";

const TASK_NAME = "Synchrotron";

/**
 * Build the schtasks command arguments for creating a Task Scheduler entry on Windows.
 * Runs synchrotron in foreground mode at logon.
 */
export function buildTaskSchedulerArgs(configDir: string, nodePath?: string): string[] {
    const node = nodePath ?? process.execPath;
    const cliPath = path.resolve(__dirname, "..", "cli", "index.js");

    return [
        "/Create",
        "/TN",
        TASK_NAME,
        "/TR",
        `"${node}" "${cliPath}" start --foreground`,
        "/SC",
        "ONLOGON",
        "/RL",
        "LIMITED",
        "/F", // Force overwrite if exists
    ];
}

/**
 * Install a Task Scheduler entry on Windows.
 * Requires the current user to have permission to create scheduled tasks.
 */
export function installTaskScheduler(configDir: string): void {
    const args = buildTaskSchedulerArgs(configDir);

    const result = child_process.spawnSync("schtasks", args, {
        encoding: "utf-8",
        shell: true,
    });

    if (result.status !== 0) {
        const errorMsg = result.stderr?.trim() || result.stdout?.trim() || "Unknown error";
        throw new Error(`Failed to create scheduled task: ${errorMsg}`);
    }
}

/**
 * Uninstall the Task Scheduler entry on Windows.
 */
export function uninstallTaskScheduler(): void {
    const result = child_process.spawnSync(
        "schtasks",
        ["/Delete", "/TN", TASK_NAME, "/F"],
        {
            encoding: "utf-8",
            shell: true,
        },
    );

    if (result.status !== 0) {
        const errorMsg = result.stderr?.trim() || result.stdout?.trim() || "Unknown error";
        throw new Error(`Failed to delete scheduled task: ${errorMsg}`);
    }
}

/**
 * Get instructions for managing the Windows scheduled task.
 */
export function getTaskSchedulerInstructions(): string {
    return `Task Scheduler entry "${TASK_NAME}" has been configured.

To view the task:
  schtasks /Query /TN ${TASK_NAME}

To run the task manually:
  schtasks /Run /TN ${TASK_NAME}

To delete the task:
  schtasks /Delete /TN ${TASK_NAME} /F

Or manage it via Task Scheduler GUI (taskschd.msc).`;
}
