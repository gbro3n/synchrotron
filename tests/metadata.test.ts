import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
    readMetadata,
    writeMetadata,
    isFreshPeer,
    createEmptyMetadata,
} from "../src/sync/metadata.js";
import type { SyncMetadata } from "../src/config/types.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("Sync Metadata", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        cleanupDir(tempDir);
    });

    describe("readMetadata", () => {
        it("should return null for directory without metadata", () => {
            expect(readMetadata(tempDir)).toBeNull();
        });

        it("should read valid metadata", () => {
            const metadata: SyncMetadata = {
                lastSyncTime: 1234567890,
                manifest: {
                    "file.txt": {
                        relativePath: "file.txt",
                        size: 100,
                        mtimeMs: 1234567890,
                        hash: "abc123",
                    },
                },
            };
            writeMetadata(tempDir, metadata);
            const loaded = readMetadata(tempDir);
            expect(loaded).toEqual(metadata);
        });
    });

    describe("writeMetadata", () => {
        it("should write metadata to .sync file", () => {
            const metadata = createEmptyMetadata();
            writeMetadata(tempDir, metadata);
            const metaPath = path.join(tempDir, ".sync");
            expect(fs.existsSync(metaPath)).toBe(true);
        });
    });

    describe("isFreshPeer", () => {
        it("should return true for directory without metadata", () => {
            expect(isFreshPeer(tempDir)).toBe(true);
        });

        it("should return false for directory with metadata", () => {
            writeMetadata(tempDir, createEmptyMetadata());
            expect(isFreshPeer(tempDir)).toBe(false);
        });
    });

    describe("createEmptyMetadata", () => {
        it("should create metadata with zero timestamp and empty manifest", () => {
            const metadata = createEmptyMetadata();
            expect(metadata.lastSyncTime).toBe(0);
            expect(metadata.manifest).toEqual({});
        });
    });
});
