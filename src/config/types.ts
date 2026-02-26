/**
 * Conflict resolution strategy.
 * - `keep-both`: renames the conflicting file with a timestamp suffix
 * - `last-write-wins`: the file with the most recent mtime wins
 */
export type ConflictResolution = "keep-both" | "last-write-wins";

/**
 * Watch mode for a sync set.
 * - `auto`: tries fs.watch, falls back to polling on error
 * - `watch`: fs.watch only
 * - `poll`: polling only
 */
export type WatchMode = "auto" | "watch" | "poll";

/**
 * Sync set type.
 * - `directory`: syncs entire directory trees (existing behaviour)
 * - `file`: syncs individual files positionally (paths[0] ↔ paths[1], etc.)
 */
export type SyncSetType = "directory" | "file";

/**
 * A sync set — a group of paths (directories or files) to keep in sync.
 */
export interface SyncSet {
    /** Optional label for log readability and status display */
    name?: string;
    /** Whether the set syncs directories or individual files */
    type: SyncSetType;
    /** Absolute paths to sync. For directory sets: directories. For file sets: individual files. */
    paths: string[];
    /** Glob patterns to ignore (directory sets only) */
    ignore?: string[];
    /** Override the global poll interval (ms) */
    pollInterval?: number;
    /** Override the global conflict resolution strategy */
    conflictResolution?: ConflictResolution;
    /** Watch mode override (directory sets only) */
    watchMode?: WatchMode;
}

/**
 * Top-level Synchrotron configuration (maps to .synchrotron.yml).
 */
export interface SynchrotronConfig {
    /** Default poll interval in milliseconds */
    pollInterval: number;
    /** Default conflict resolution strategy */
    conflictResolution: ConflictResolution;
    /** Maximum size of a single log file in MB before rotation (default: 10) */
    maxLogSizeMB: number;
    /** Maximum number of rotated log files to keep (default: 5) */
    maxLogFiles: number;
    /** List of sync sets */
    syncSets: SyncSet[];
}

/**
 * File entry in a sync manifest.
 */
export interface FileEntry {
    /** Relative path from the sync root */
    relativePath: string;
    /** File size in bytes */
    size: number;
    /** Last modified time (ms since epoch) */
    mtimeMs: number;
    /** Content hash (sha256 hex) */
    hash: string;
}

/**
 * Sync metadata stored in each synced directory (.sync file).
 */
export interface SyncMetadata {
    /** Timestamp of the last completed sync (ms since epoch) */
    lastSyncTime: number;
    /** File manifest at last sync */
    manifest: Record<string, FileEntry>;
}

/**
 * Result of diffing two manifests.
 */
export interface ManifestDiff {
    /** Files that are new (exist in current but not in previous) */
    added: FileEntry[];
    /** Files that were removed (exist in previous but not in current) */
    deleted: FileEntry[];
    /** Files that were modified (exist in both but differ) */
    modified: FileEntry[];
    /** Files that are unchanged */
    unchanged: FileEntry[];
}

/** Default configuration values */
export const CONFIG_DEFAULTS = {
    pollInterval: 5000,
    conflictResolution: "keep-both" as ConflictResolution,
    maxLogSizeMB: 10,
    maxLogFiles: 5,
    configFileName: ".synchrotron.yml",
    metadataFileName: ".sync",
    sidecarExtension: ".sync",
} as const;

/**
 * A per-file action recorded during sync, for verbose logging.
 */
export interface SyncAction {
    /** What happened: added, modified, deleted, conflict, or error */
    type: "added" | "modified" | "deleted" | "conflict" | "error";
    /** Absolute source path (or the path acted upon for deletes) */
    sourcePath: string;
    /** Absolute destination path (absent for deletes) */
    destPath?: string;
    /** Extra detail, e.g. conflict strategy used, error message */
    detail?: string;
}
