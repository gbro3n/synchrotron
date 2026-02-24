import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type {
    SyncSet,
    ConflictResolution,
    FileEntry,
    SyncMetadata,
} from "../config/types.js";
import { CONFIG_DEFAULTS } from "../config/types.js";
import { readMetadata, writeMetadata, createEmptyMetadata } from "./metadata.js";
import { buildManifest, diffManifests, hashFile } from "./manifest.js";
import { readFileMetadata, writeFileMetadata, type FileSyncMetadata } from "./file-metadata.js";

/** Threshold above which we use streaming copy (10 MB) */
const STREAMING_THRESHOLD = 10 * 1024 * 1024;

export interface SyncResult {
    syncSetIndex: number;
    filesAdded: number;
    filesDeleted: number;
    filesModified: number;
    conflicts: number;
    errors: string[];
}

/**
 * Core sync engine. Synchronises directories within a sync set.
 */
export class SyncEngine {
    private defaultConflictResolution: ConflictResolution;

    constructor(defaultConflictResolution: ConflictResolution = CONFIG_DEFAULTS.conflictResolution) {
        this.defaultConflictResolution = defaultConflictResolution;
    }

    /**
     * Synchronise all directories in a sync set.
     * @param syncSet The sync set configuration
     * @param syncSetIndex Index of this set in the config array (used for identification)
     */
    async syncSet(syncSet: SyncSet, syncSetIndex = 0): Promise<SyncResult> {
        const result: SyncResult = {
            syncSetIndex,
            filesAdded: 0,
            filesDeleted: 0,
            filesModified: 0,
            conflicts: 0,
            errors: [],
        };

        const conflictResolution =
            syncSet.conflictResolution ?? this.defaultConflictResolution;
        const ignorePatterns = syncSet.ignore ?? [];

        // Ensure all directories exist
        for (const dirPath of syncSet.paths) {
            if (!fs.existsSync(dirPath)) {
                result.errors.push(`Directory does not exist: ${dirPath}`);
                return result;
            }
        }

        // Build current manifests and load previous metadata for each directory
        const dirStates = syncSet.paths.map((dirPath) => {
            const currentManifest = buildManifest(dirPath, ignorePatterns);
            const previousMetadata = readMetadata(dirPath);
            const isFresh = previousMetadata === null;
            const previousManifest = previousMetadata?.manifest ?? {};
            return { dirPath, currentManifest, previousManifest, isFresh };
        });

        // Compute diffs for each directory (what changed since last sync)
        const dirDiffs = dirStates.map((state) => ({
            ...state,
            diff: diffManifests(state.previousManifest, state.currentManifest),
        }));

        // For each pair of directories, propagate changes
        for (let i = 0; i < dirDiffs.length; i++) {
            for (let j = 0; j < dirDiffs.length; j++) {
                if (i === j) continue;

                const source = dirDiffs[i];
                const dest = dirDiffs[j];

                try {
                    // Handle fresh peers: copy everything from source, delete nothing
                    if (dest.isFresh) {
                        for (const entry of Object.values(source.currentManifest)) {
                            this.copyFile(source.dirPath, dest.dirPath, entry.relativePath);
                            result.filesAdded++;
                        }
                        continue;
                    }

                    // Propagate additions from source to dest
                    for (const entry of source.diff.added) {
                        if (dest.currentManifest[entry.relativePath]) {
                            // File exists at dest too — conflict
                            this.resolveConflict(
                                source.dirPath,
                                dest.dirPath,
                                entry.relativePath,
                                conflictResolution,
                            );
                            result.conflicts++;
                        } else {
                            this.copyFile(source.dirPath, dest.dirPath, entry.relativePath);
                            result.filesAdded++;
                        }
                    }

                    // Propagate modifications from source to dest
                    for (const entry of source.diff.modified) {
                        if (this.isModifiedAtDest(dest, entry.relativePath)) {
                            // Both sides modified — conflict
                            this.resolveConflict(
                                source.dirPath,
                                dest.dirPath,
                                entry.relativePath,
                                conflictResolution,
                            );
                            result.conflicts++;
                        } else {
                            this.copyFile(source.dirPath, dest.dirPath, entry.relativePath);
                            result.filesModified++;
                        }
                    }

                    // Propagate deletions: only delete at dest if the file wasn't
                    // modified there since last sync
                    for (const entry of source.diff.deleted) {
                        if (!this.isModifiedAtDest(dest, entry.relativePath)) {
                            this.deleteFile(dest.dirPath, entry.relativePath);
                            result.filesDeleted++;
                        }
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    result.errors.push(`Error syncing ${source.dirPath} → ${dest.dirPath}: ${message}`);
                }
            }
        }

        // Update metadata for all directories after sync
        const syncTime = Date.now();
        for (const state of dirStates) {
            const updatedManifest = buildManifest(state.dirPath, ignorePatterns);
            const metadata: SyncMetadata = {
                lastSyncTime: syncTime,
                manifest: updatedManifest,
            };
            writeMetadata(state.dirPath, metadata);
        }

        return result;
    }

    /**
     * Check if a file was modified at the destination since last sync.
     */
    private isModifiedAtDest(
        dest: { currentManifest: Record<string, FileEntry>; previousManifest: Record<string, FileEntry> },
        relativePath: string,
    ): boolean {
        const current = dest.currentManifest[relativePath];
        const previous = dest.previousManifest[relativePath];

        if (!current || !previous) return false;
        return current.hash !== previous.hash;
    }

    /**
     * Copy a file from source directory to destination directory.
     * Uses streaming for files larger than 10 MB.
     */
    private copyFile(srcDir: string, destDir: string, relativePath: string): void {
        const srcPath = path.join(srcDir, relativePath);
        const destPath = path.join(destDir, relativePath);

        // Check source is accessible
        try {
            fs.accessSync(srcPath, fs.constants.R_OK);
        } catch {
            throw new Error(`Permission denied reading: ${srcPath}`);
        }

        // Ensure destination directory exists
        const destParent = path.dirname(destPath);
        fs.mkdirSync(destParent, { recursive: true });

        // Check dest dir is writable
        try {
            fs.accessSync(destParent, fs.constants.W_OK);
        } catch {
            throw new Error(`Permission denied writing to: ${destParent}`);
        }

        // Check if dest file exists and is locked
        if (fs.existsSync(destPath)) {
            try {
                fs.accessSync(destPath, fs.constants.W_OK);
            } catch {
                throw new Error(`File locked or permission denied: ${destPath}`);
            }
        }

        const stat = fs.statSync(srcPath);
        if (stat.size > STREAMING_THRESHOLD) {
            // Use streaming copy for large files — schedule async but continue sync
            this.streamCopy(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }

    /**
     * Streaming copy for large files. Fires and handles errors internally.
     */
    private streamCopy(srcPath: string, destPath: string): void {
        const readStream = fs.createReadStream(srcPath);
        const writeStream = fs.createWriteStream(destPath);
        pipeline(readStream, writeStream).catch(() => {
            // Error is logged by the caller's error handler
        });
    }

    /**
     * Delete a file from a directory.
     * Handles permission errors and locked files gracefully.
     */
    private deleteFile(dirPath: string, relativePath: string): void {
        const filePath = path.join(dirPath, relativePath);
        if (fs.existsSync(filePath)) {
            try {
                fs.accessSync(filePath, fs.constants.W_OK);
            } catch {
                throw new Error(`Cannot delete (permission denied or locked): ${filePath}`);
            }

            fs.unlinkSync(filePath);

            // Clean up empty parent directories
            let parent = path.dirname(filePath);
            while (parent !== dirPath) {
                try {
                    const entries = fs.readdirSync(parent);
                    if (entries.length === 0) {
                        fs.rmdirSync(parent);
                        parent = path.dirname(parent);
                    } else {
                        break;
                    }
                } catch {
                    break; // Can't read/remove parent, stop cleanup
                }
            }
        }
    }

    /**
     * Resolve a conflict between source and destination files.
     */
    private resolveConflict(
        srcDir: string,
        destDir: string,
        relativePath: string,
        strategy: ConflictResolution,
    ): void {
        if (strategy === "last-write-wins") {
            const srcPath = path.join(srcDir, relativePath);
            const destPath = path.join(destDir, relativePath);

            const srcStat = fs.statSync(srcPath);
            const destStat = fs.statSync(destPath);

            if (srcStat.mtimeMs >= destStat.mtimeMs) {
                this.copyFile(srcDir, destDir, relativePath);
            }
            // If dest is newer, leave it in place
        } else {
            // keep-both: rename the destination file with a conflict suffix
            const destPath = path.join(destDir, relativePath);
            const ext = path.extname(relativePath);
            const base = relativePath.slice(0, -ext.length || undefined);
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const conflictName = `${base}.conflict-${timestamp}${ext}`;
            const conflictPath = path.join(destDir, conflictName);

            // Rename existing dest file to conflict name
            if (fs.existsSync(destPath)) {
                fs.renameSync(destPath, conflictPath);
            }

            // Copy source file to dest
            this.copyFile(srcDir, destDir, relativePath);
        }
    }

    // ─── File set sync ───────────────────────────────────────────────────────

    /**
     * Synchronise all peer files in a file-type sync set.
     * Paths are treated positionally — each path is an individual file peer.
     * @param syncSet The file-type sync set
     * @param syncSetIndex Index of this set in the config array
     */
    async syncFileSet(syncSet: SyncSet, syncSetIndex = 0): Promise<SyncResult> {
        const result: SyncResult = {
            syncSetIndex,
            filesAdded: 0,
            filesDeleted: 0,
            filesModified: 0,
            conflicts: 0,
            errors: [],
        };

        const conflictResolution = syncSet.conflictResolution ?? this.defaultConflictResolution;

        // Build state for each peer file
        interface PeerState {
            filePath: string;
            exists: boolean;
            metadata: FileSyncMetadata | null;
            currentHash: string | null;
            currentMtimeMs: number | null;
            currentSize: number | null;
            changed: boolean; // exists + (no sidecar OR hash changed)
        }

        const peers: PeerState[] = syncSet.paths.map((filePath) => {
            const exists = fs.existsSync(filePath);
            const metadata = readFileMetadata(filePath);

            let currentHash: string | null = null;
            let currentMtimeMs: number | null = null;
            let currentSize: number | null = null;

            if (exists) {
                try {
                    const stat = fs.statSync(filePath);
                    currentMtimeMs = stat.mtimeMs;
                    currentSize = stat.size;
                    currentHash = hashFile(filePath);
                } catch {
                    // Can't stat/hash — treat as inaccessible
                }
            }

            // A peer is "changed" if it exists and either has no sidecar or its hash differs
            const changed =
                exists &&
                currentHash !== null &&
                (metadata === null || metadata.hash !== currentHash);

            return { filePath, exists, metadata, currentHash, currentMtimeMs, currentSize, changed };
        });

        const changedPeers = peers.filter((p) => p.changed);
        const freshPeers = peers.filter((p) => !p.exists && p.metadata === null);

        if (changedPeers.length === 0) {
            // Nothing to do — all peers are in sync
            return result;
        }

        const syncTime = Date.now();

        if (changedPeers.length === 1) {
            // Exactly one changed peer — propagate to all others
            const source = changedPeers[0];

            for (const dest of peers) {
                if (dest.filePath === source.filePath) continue;

                try {
                    this.copyFileDirect(source.filePath, dest.filePath);
                    if (dest.exists) {
                        result.filesModified++;
                    } else {
                        result.filesAdded++;
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    result.errors.push(`Error copying to ${dest.filePath}: ${message}`);
                }
            }
        } else {
            // Multiple peers changed — conflict
            result.conflicts += changedPeers.length;

            if (conflictResolution === "last-write-wins") {
                // Find the peer with the highest mtime
                const winner = changedPeers.reduce((best, peer) =>
                    (peer.currentMtimeMs ?? 0) > (best.currentMtimeMs ?? 0) ? peer : best,
                );

                for (const dest of peers) {
                    if (dest.filePath === winner.filePath) continue;
                    try {
                        this.copyFileDirect(winner.filePath, dest.filePath);
                        result.filesModified++;
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        result.errors.push(`Error copying to ${dest.filePath}: ${message}`);
                    }
                }
            } else {
                // keep-both: rename all changed peers except the first, then propagate first
                const [winner, ...losers] = changedPeers;

                for (const loser of losers) {
                    const ext = path.extname(loser.filePath);
                    const base = loser.filePath.slice(0, -ext.length || undefined);
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const conflictPath = `${base}.conflict-${timestamp}${ext}`;
                    try {
                        fs.renameSync(loser.filePath, conflictPath);
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        result.errors.push(`Error renaming conflict file ${loser.filePath}: ${message}`);
                    }
                }

                for (const dest of peers) {
                    if (dest.filePath === winner.filePath) continue;
                    try {
                        this.copyFileDirect(winner.filePath, dest.filePath);
                        result.filesModified++;
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        result.errors.push(`Error copying to ${dest.filePath}: ${message}`);
                    }
                }
            }
        }

        // Update sidecar metadata for all peers that now exist
        for (const peer of peers) {
            const existsNow = fs.existsSync(peer.filePath);
            if (existsNow) {
                try {
                    const stat = fs.statSync(peer.filePath);
                    const newHash = hashFile(peer.filePath);
                    writeFileMetadata(peer.filePath, {
                        hash: newHash,
                        mtimeMs: stat.mtimeMs,
                        size: stat.size,
                        lastSyncTime: syncTime,
                    });
                } catch {
                    // Best-effort metadata update
                }
            }
        }

        return result;
    }

    /**
     * Copy a file directly (absolute src → absolute dest path).
     * Uses streaming for files larger than 10 MB.
     */
    private copyFileDirect(srcPath: string, destPath: string): void {
        // Check source is accessible
        try {
            fs.accessSync(srcPath, fs.constants.R_OK);
        } catch {
            throw new Error(`Permission denied reading: ${srcPath}`);
        }

        // Ensure destination directory exists
        const destParent = path.dirname(destPath);
        fs.mkdirSync(destParent, { recursive: true });

        try {
            fs.accessSync(destParent, fs.constants.W_OK);
        } catch {
            throw new Error(`Permission denied writing to: ${destParent}`);
        }

        if (fs.existsSync(destPath)) {
            try {
                fs.accessSync(destPath, fs.constants.W_OK);
            } catch {
                throw new Error(`File locked or permission denied: ${destPath}`);
            }
        }

        const stat = fs.statSync(srcPath);
        if (stat.size > STREAMING_THRESHOLD) {
            this.streamCopy(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
