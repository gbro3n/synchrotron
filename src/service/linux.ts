import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SERVICE_NAME = "synchrotron";
const SERVICE_DESCRIPTION = "Synchrotron file synchronisation daemon";

/**
 * Generate a systemd unit file for Linux.
 */
export function generateSystemdUnit(configDir: string, nodePath?: string): string {
    const node = nodePath ?? process.execPath;
    const cliPath = path.resolve(__dirname, "..", "cli", "index.js");

    return `[Unit]
Description=${SERVICE_DESCRIPTION}
After=network.target

[Service]
Type=simple
ExecStart=${node} ${cliPath} start --foreground
WorkingDirectory=${configDir}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

/**
 * Install the systemd user service on Linux.
 * @returns Path to the installed service file
 */
export function installSystemdService(configDir: string): string {
    const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
    fs.mkdirSync(serviceDir, { recursive: true });

    const serviceFile = path.join(serviceDir, `${SERVICE_NAME}.service`);
    const content = generateSystemdUnit(configDir);
    fs.writeFileSync(serviceFile, content, "utf-8");

    return serviceFile;
}

/**
 * Uninstall the systemd user service on Linux.
 */
export function uninstallSystemdService(): boolean {
    const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
    const serviceFile = path.join(serviceDir, `${SERVICE_NAME}.service`);

    if (fs.existsSync(serviceFile)) {
        fs.unlinkSync(serviceFile);
        return true;
    }
    return false;
}

/**
 * Get instructions for enabling the systemd service.
 */
export function getSystemdInstructions(): string {
    return `To enable the service:
  systemctl --user daemon-reload
  systemctl --user enable ${SERVICE_NAME}
  systemctl --user start ${SERVICE_NAME}

To check service status:
  systemctl --user status ${SERVICE_NAME}

To disable the service:
  systemctl --user stop ${SERVICE_NAME}
  systemctl --user disable ${SERVICE_NAME}`;
}
