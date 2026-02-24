import { detectPlatform } from "../../service/platform.js";
import { installSystemdService, getSystemdInstructions } from "../../service/linux.js";
import { installLaunchdAgent, getLaunchdInstructions } from "../../service/macos.js";
import { installTaskScheduler, getTaskSchedulerInstructions } from "../../service/windows.js";

export function installServiceCommand(): void {
    try {
        const platform = detectPlatform();
        const configDir = process.cwd();

        console.log(`Installing synchrotron startup service for ${platform}...`);

        switch (platform) {
            case "linux": {
                const serviceFile = installSystemdService(configDir);
                console.log(`Service file created: ${serviceFile}`);
                console.log();
                console.log(getSystemdInstructions());
                break;
            }
            case "darwin": {
                const plistFile = installLaunchdAgent(configDir);
                console.log(`Launch agent created: ${plistFile}`);
                console.log();
                console.log(getLaunchdInstructions());
                break;
            }
            case "win32": {
                installTaskScheduler(configDir);
                console.log("Scheduled task created successfully.");
                console.log();
                console.log(getTaskSchedulerInstructions());
                break;
            }
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
    }
}
