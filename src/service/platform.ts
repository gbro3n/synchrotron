import * as os from "node:os";

export type Platform = "linux" | "darwin" | "win32";

/**
 * Detect the current platform.
 */
export function detectPlatform(): Platform {
    const platform = os.platform();
    if (platform === "linux" || platform === "darwin" || platform === "win32") {
        return platform;
    }
    throw new Error(`Unsupported platform: ${platform}`);
}
