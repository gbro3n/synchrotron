import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SERVICE_LABEL = "com.synchrotron.daemon";
const SERVICE_DESCRIPTION = "Synchrotron file synchronisation daemon";

/**
 * Generate a launchd plist for macOS.
 */
export function generateLaunchdPlist(configDir: string, nodePath?: string): string {
    const node = nodePath ?? process.execPath;
    const cliPath = path.resolve(__dirname, "..", "cli", "index.js");
    const logDir = path.join(os.homedir(), ".synchrotron", "logs");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>Comment</key>
    <string>${SERVICE_DESCRIPTION}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node}</string>
        <string>${cliPath}</string>
        <string>start</string>
        <string>--foreground</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${configDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logDir}/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/launchd-stderr.log</string>
</dict>
</plist>
`;
}

/**
 * Install the launchd agent on macOS.
 * @returns Path to the installed plist file
 */
export function installLaunchdAgent(configDir: string): string {
    const agentDir = path.join(os.homedir(), "Library", "LaunchAgents");
    fs.mkdirSync(agentDir, { recursive: true });

    const plistFile = path.join(agentDir, `${SERVICE_LABEL}.plist`);
    const content = generateLaunchdPlist(configDir);
    fs.writeFileSync(plistFile, content, "utf-8");

    return plistFile;
}

/**
 * Uninstall the launchd agent on macOS.
 */
export function uninstallLaunchdAgent(): boolean {
    const agentDir = path.join(os.homedir(), "Library", "LaunchAgents");
    const plistFile = path.join(agentDir, `${SERVICE_LABEL}.plist`);

    if (fs.existsSync(plistFile)) {
        fs.unlinkSync(plistFile);
        return true;
    }
    return false;
}

/**
 * Get instructions for managing the launchd agent.
 */
export function getLaunchdInstructions(): string {
    return `To load the agent:
  launchctl load ~/Library/LaunchAgents/${SERVICE_LABEL}.plist

To unload the agent:
  launchctl unload ~/Library/LaunchAgents/${SERVICE_LABEL}.plist

To check if the agent is running:
  launchctl list | grep ${SERVICE_LABEL}`;
}
