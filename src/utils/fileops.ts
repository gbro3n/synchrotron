import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";

/** Threshold above which we use streaming copy (10 MB) */
const STREAMING_THRESHOLD = 10 * 1024 * 1024;

/**
 * Copy a file, using streaming for large files.
 * Creates parent directories as needed.
 */
export async function copyFileRobust(srcPath: string, destPath: string): Promise<void> {
    const destParent = path.dirname(destPath);
    fs.mkdirSync(destParent, { recursive: true });

    const stat = fs.statSync(srcPath);

    if (stat.size > STREAMING_THRESHOLD) {
        // Use streaming copy for large files
        const readStream = fs.createReadStream(srcPath);
        const writeStream = fs.createWriteStream(destPath);
        await pipeline(readStream, writeStream);
    } else {
        fs.copyFileSync(srcPath, destPath);
    }

    // Preserve mtime
    try {
        const srcStat = fs.statSync(srcPath);
        fs.utimesSync(destPath, srcStat.atime, srcStat.mtime);
    } catch {
        // Non-fatal: mtime preservation failure
    }
}

/**
 * Check if a file is accessible (readable).
 */
export function isFileAccessible(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a file is locked (not writable).
 */
export function isFileLocked(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.W_OK);
        return false;
    } catch {
        return true;
    }
}

/**
 * Safely delete a file, handling permission and lock errors.
 * Returns true if deleted, false if skipped due to error.
 */
export function safeDelete(filePath: string): { deleted: boolean; error?: string } {
    try {
        if (!fs.existsSync(filePath)) {
            return { deleted: true };
        }
        fs.unlinkSync(filePath);
        return { deleted: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
            return { deleted: false, error: `Permission denied: ${filePath}` };
        }
        if (code === "EBUSY") {
            return { deleted: false, error: `File locked/in use: ${filePath}` };
        }
        return { deleted: false, error: `Failed to delete ${filePath}: ${message}` };
    }
}

/**
 * Check if a path is a symlink.
 */
export function isSymlink(filePath: string): boolean {
    try {
        const lstat = fs.lstatSync(filePath);
        return lstat.isSymbolicLink();
    } catch {
        return false;
    }
}
