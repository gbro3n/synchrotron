import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { minimatch } from "minimatch";
import type { FileEntry, ManifestDiff, SyncMetadata } from "../config/types.js";
import { CONFIG_DEFAULTS } from "../config/types.js";

/**
 * Compute a SHA-256 hash of a file's contents.
 */
export function hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Recursively walk a directory and collect all file entries.
 * @param dirPath Root directory to walk
 * @param ignorePatterns Glob patterns to ignore
 * @returns Record of relative path → FileEntry
 */
export function buildManifest(
    dirPath: string,
    ignorePatterns: string[] = [],
): Record<string, FileEntry> {
    const manifest: Record<string, FileEntry> = {};

    function shouldIgnore(relativePath: string): boolean {
        // Always ignore the metadata file
        if (path.basename(relativePath) === CONFIG_DEFAULTS.metadataFileName) {
            return true;
        }
        return ignorePatterns.some((pattern) => minimatch(relativePath, pattern, { dot: true }));
    }

    function walk(currentPath: string, relativeTo: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
            // Permission denied or inaccessible directory — skip
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const relativePath = path.relative(relativeTo, fullPath).split(path.sep).join("/");

            if (shouldIgnore(relativePath)) {
                continue;
            }

            // Skip symlinks (we don't follow them by default)
            try {
                const lstat = fs.lstatSync(fullPath);
                if (lstat.isSymbolicLink()) {
                    continue;
                }
            } catch {
                continue; // Can't stat — skip
            }

            if (entry.isDirectory()) {
                walk(fullPath, relativeTo);
            } else if (entry.isFile()) {
                try {
                    fs.accessSync(fullPath, fs.constants.R_OK);
                    const stat = fs.statSync(fullPath);
                    manifest[relativePath] = {
                        relativePath,
                        size: stat.size,
                        mtimeMs: stat.mtimeMs,
                        hash: hashFile(fullPath),
                    };
                } catch {
                    // Permission denied or locked file — skip
                }
            }
        }
    }

    walk(dirPath, dirPath);
    return manifest;
}

/**
 * Diff a previous manifest against the current state of a directory.
 * Detects added, deleted, modified, and unchanged files.
 */
export function diffManifests(
    previousManifest: Record<string, FileEntry>,
    currentManifest: Record<string, FileEntry>,
): ManifestDiff {
    const added: FileEntry[] = [];
    const deleted: FileEntry[] = [];
    const modified: FileEntry[] = [];
    const unchanged: FileEntry[] = [];

    // Check current files against previous manifest
    for (const [relativePath, currentEntry] of Object.entries(currentManifest)) {
        const previousEntry = previousManifest[relativePath];
        if (!previousEntry) {
            added.push(currentEntry);
        } else if (previousEntry.hash !== currentEntry.hash) {
            modified.push(currentEntry);
        } else {
            unchanged.push(currentEntry);
        }
    }

    // Check for deleted files (in previous but not in current)
    for (const [relativePath, previousEntry] of Object.entries(previousManifest)) {
        if (!currentManifest[relativePath]) {
            deleted.push(previousEntry);
        }
    }

    return { added, deleted, modified, unchanged };
}

/**
 * Build a SyncMetadata object from the current state of a directory.
 */
export function buildMetadataFromDir(
    dirPath: string,
    ignorePatterns: string[] = [],
): SyncMetadata {
    return {
        lastSyncTime: Date.now(),
        manifest: buildManifest(dirPath, ignorePatterns),
    };
}
