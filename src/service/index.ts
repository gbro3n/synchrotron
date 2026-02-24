export { detectPlatform, type Platform } from "./platform.js";
export {
    installSystemdService,
    uninstallSystemdService,
    getSystemdInstructions,
    generateSystemdUnit,
} from "./linux.js";
export {
    installLaunchdAgent,
    uninstallLaunchdAgent,
    getLaunchdInstructions,
    generateLaunchdPlist,
} from "./macos.js";
export {
    installTaskScheduler,
    uninstallTaskScheduler,
    getTaskSchedulerInstructions,
    buildTaskSchedulerArgs,
} from "./windows.js";
