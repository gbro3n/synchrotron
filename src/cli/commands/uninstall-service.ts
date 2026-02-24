import { detectPlatform } from "../../service/platform.js";
import { uninstallSystemdService } from "../../service/linux.js";
import { uninstallLaunchdAgent } from "../../service/macos.js";
import { uninstallTaskScheduler } from "../../service/windows.js";

export function uninstallServiceCommand(): void {
    try {
        const platform = detectPlatform();

        console.log(`Uninstalling synchrotron startup service for ${platform}...`);

        switch (platform) {
            case "linux": {
                const removed = uninstallSystemdService();
                if (removed) {
                    console.log("Systemd service file removed.");
                    console.log("Run 'systemctl --user daemon-reload' to apply changes.");
                } else {
                    console.log("No systemd service file found.");
                }
                break;
            }
            case "darwin": {
                const removed = uninstallLaunchdAgent();
                if (removed) {
                    console.log("Launch agent plist removed.");
                    console.log(
                        "Run 'launchctl unload ~/Library/LaunchAgents/com.synchrotron.daemon.plist' if the agent is still loaded.",
                    );
                } else {
                    console.log("No launch agent plist found.");
                }
                break;
            }
            case "win32": {
                uninstallTaskScheduler();
                console.log("Scheduled task removed successfully.");
                break;
            }
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
    }
}
