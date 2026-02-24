import * as fs from "node:fs";
import * as path from "node:path";
import type { SyncMetadata } from "../config/types.js";
import { CONFIG_DEFAULTS } from "../config/types.js";

/**
 * Read sync metadata from a directory.
 * Returns null if no metadata file exists (fresh peer).
 */
export function readMetadata(dirPath: string): SyncMetadata | null {
    const metaPath = path.join(dirPath, CONFIG_DEFAULTS.metadataFileName);

    if (!fs.existsSync(metaPath)) {
        return null;
    }

    const raw = fs.readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as SyncMetadata;

    // Basic validation
    if (typeof parsed.lastSyncTime !== "number") {
        throw new Error(`Invalid metadata in ${metaPath}: missing lastSyncTime`);
    }

    if (typeof parsed.manifest !== "object" || parsed.manifest === null) {
        throw new Error(`Invalid metadata in ${metaPath}: missing manifest`);
    }

    return parsed;
}

/**
 * Write sync metadata to a directory.
 */
export function writeMetadata(dirPath: string, metadata: SyncMetadata): void {
    const metaPath = path.join(dirPath, CONFIG_DEFAULTS.metadataFileName);
    const content = JSON.stringify(metadata, null, 2);
    fs.writeFileSync(metaPath, content, "utf-8");
}

/**
 * Check if a directory is a fresh peer (no metadata file).
 */
export function isFreshPeer(dirPath: string): boolean {
    return readMetadata(dirPath) === null;
}

/**
 * Create initial empty metadata for a fresh peer.
 */
export function createEmptyMetadata(): SyncMetadata {
    return {
        lastSyncTime: 0,
        manifest: {},
    };
}
