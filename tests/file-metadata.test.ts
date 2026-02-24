import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
    readFileMetadata,
    writeFileMetadata,
    getSidecarPath,
    type FileSyncMetadata,
} from "../src/sync/file-metadata.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-fm-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("File Metadata (Sidecar)", () => {
    let tempDir: string;
    let testFile: string;

    beforeEach(() => {
        tempDir = createTempDir();
        testFile = path.join(tempDir, "test.txt");
        fs.writeFileSync(testFile, "hello world");
    });

    afterEach(() => {
        cleanupDir(tempDir);
    });

    describe("getSidecarPath", () => {
        it("should append .synchrotron to the file path", () => {
            expect(getSidecarPath("/etc/hosts")).toBe("/etc/hosts.synchrotron");
            expect(getSidecarPath("/home/user/file.txt")).toBe("/home/user/file.txt.synchrotron");
            expect(getSidecarPath("/path/to/file.yaml")).toBe("/path/to/file.yaml.synchrotron");
        });
    });

    describe("readFileMetadata", () => {
        it("should return null when sidecar does not exist", () => {
            const result = readFileMetadata(testFile);
            expect(result).toBeNull();
        });

        it("should return null for invalid sidecar content", () => {
            fs.writeFileSync(getSidecarPath(testFile), "invalid json");
            expect(readFileMetadata(testFile)).toBeNull();
        });

        it("should return null for sidecar with missing fields", () => {
            fs.writeFileSync(getSidecarPath(testFile), JSON.stringify({ hash: "abc" }));
            expect(readFileMetadata(testFile)).toBeNull();
        });
    });

    describe("writeFileMetadata / readFileMetadata round-trip", () => {
        it("should write and read back metadata", () => {
            const metadata: FileSyncMetadata = {
                hash: "abc123",
                mtimeMs: 1700000000000,
                size: 11,
                lastSyncTime: 1700000001000,
            };

            writeFileMetadata(testFile, metadata);

            const sidecarPath = getSidecarPath(testFile);
            expect(fs.existsSync(sidecarPath)).toBe(true);

            const read = readFileMetadata(testFile);
            expect(read).not.toBeNull();
            expect(read!.hash).toBe("abc123");
            expect(read!.mtimeMs).toBe(1700000000000);
            expect(read!.size).toBe(11);
            expect(read!.lastSyncTime).toBe(1700000001000);
        });

        it("should overwrite existing sidecar on write", () => {
            writeFileMetadata(testFile, { hash: "old", mtimeMs: 1, size: 1, lastSyncTime: 1 });
            writeFileMetadata(testFile, { hash: "new", mtimeMs: 2, size: 2, lastSyncTime: 2 });

            const read = readFileMetadata(testFile);
            expect(read!.hash).toBe("new");
        });
    });
});
