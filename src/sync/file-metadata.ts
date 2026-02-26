import * as fs from "node:fs";

/**
 * Metadata stored in a sidecar file alongside each peer file in a file-type sync set.
 * Sidecar path: <filePath>.sync (e.g. /etc/hosts.sync)
 */
export interface FileSyncMetadata {
    /** SHA-256 hash of the file at last sync */
    hash: string;
    /** Last modified time (ms since epoch) at last sync */
    mtimeMs: number;
    /** File size in bytes at last sync */
    size: number;
    /** Timestamp of the last completed sync (ms since epoch) */
    lastSyncTime: number;
}

/**
 * Returns the sidecar metadata path for a given file path.
 * e.g. /etc/hosts → /etc/hosts.sync
 */
export function getSidecarPath(filePath: string): string {
    return filePath + ".sync";
}

/**
 * Read sidecar metadata for a file. Returns null if the sidecar does not exist or is invalid.
 */
export function readFileMetadata(filePath: string): FileSyncMetadata | null {
    const sidecarPath = getSidecarPath(filePath);
    if (!fs.existsSync(sidecarPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(sidecarPath, "utf-8");
        const parsed = JSON.parse(raw) as FileSyncMetadata;
        if (
            typeof parsed.hash === "string" &&
            typeof parsed.mtimeMs === "number" &&
            typeof parsed.size === "number" &&
            typeof parsed.lastSyncTime === "number"
        ) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Write sidecar metadata for a file.
 */
export function writeFileMetadata(filePath: string, metadata: FileSyncMetadata): void {
    const sidecarPath = getSidecarPath(filePath);
    fs.writeFileSync(sidecarPath, JSON.stringify(metadata, null, 2), "utf-8");
}
