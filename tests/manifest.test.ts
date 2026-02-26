import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildManifest, diffManifests } from "../src/sync/manifest.js";
import type { FileEntry } from "../src/config/types.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("Manifest", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        cleanupDir(tempDir);
    });

    describe("buildManifest", () => {
        it("should build manifest for empty directory", () => {
            const manifest = buildManifest(tempDir);
            expect(Object.keys(manifest)).toHaveLength(0);
        });

        it("should include files in manifest", () => {
            fs.writeFileSync(path.join(tempDir, "file.txt"), "hello world");
            const manifest = buildManifest(tempDir);
            expect(manifest["file.txt"]).toBeDefined();
            expect(manifest["file.txt"].relativePath).toBe("file.txt");
            expect(manifest["file.txt"].size).toBe(11);
            expect(manifest["file.txt"].hash).toBeTruthy();
        });

        it("should include nested files", () => {
            fs.mkdirSync(path.join(tempDir, "sub"));
            fs.writeFileSync(path.join(tempDir, "sub", "nested.txt"), "data");
            const manifest = buildManifest(tempDir);
            expect(manifest["sub/nested.txt"]).toBeDefined();
        });

        it("should ignore .sync metadata file", () => {
            fs.writeFileSync(path.join(tempDir, ".sync"), "{}");
            fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
            const manifest = buildManifest(tempDir);
            expect(manifest[".sync"]).toBeUndefined();
            expect(manifest["file.txt"]).toBeDefined();
        });

        it("should ignore files matching ignore patterns", () => {
            fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
            fs.writeFileSync(path.join(tempDir, "file.tmp"), "temp");
            const manifest = buildManifest(tempDir, ["*.tmp"]);
            expect(manifest["file.txt"]).toBeDefined();
            expect(manifest["file.tmp"]).toBeUndefined();
        });
    });

    describe("diffManifests", () => {
        it("should detect added files", () => {
            const prev: Record<string, FileEntry> = {};
            const curr: Record<string, FileEntry> = {
                "new.txt": {
                    relativePath: "new.txt",
                    size: 5,
                    mtimeMs: 1000,
                    hash: "abc",
                },
            };
            const diff = diffManifests(prev, curr);
            expect(diff.added).toHaveLength(1);
            expect(diff.added[0].relativePath).toBe("new.txt");
            expect(diff.deleted).toHaveLength(0);
            expect(diff.modified).toHaveLength(0);
        });

        it("should detect deleted files", () => {
            const prev: Record<string, FileEntry> = {
                "old.txt": {
                    relativePath: "old.txt",
                    size: 5,
                    mtimeMs: 1000,
                    hash: "abc",
                },
            };
            const curr: Record<string, FileEntry> = {};
            const diff = diffManifests(prev, curr);
            expect(diff.deleted).toHaveLength(1);
            expect(diff.deleted[0].relativePath).toBe("old.txt");
            expect(diff.added).toHaveLength(0);
        });

        it("should detect modified files", () => {
            const prev: Record<string, FileEntry> = {
                "file.txt": {
                    relativePath: "file.txt",
                    size: 5,
                    mtimeMs: 1000,
                    hash: "abc",
                },
            };
            const curr: Record<string, FileEntry> = {
                "file.txt": {
                    relativePath: "file.txt",
                    size: 10,
                    mtimeMs: 2000,
                    hash: "def",
                },
            };
            const diff = diffManifests(prev, curr);
            expect(diff.modified).toHaveLength(1);
            expect(diff.modified[0].hash).toBe("def");
        });

        it("should detect unchanged files", () => {
            const entry: FileEntry = {
                relativePath: "file.txt",
                size: 5,
                mtimeMs: 1000,
                hash: "abc",
            };
            const prev: Record<string, FileEntry> = { "file.txt": entry };
            const curr: Record<string, FileEntry> = { "file.txt": { ...entry } };
            const diff = diffManifests(prev, curr);
            expect(diff.unchanged).toHaveLength(1);
            expect(diff.added).toHaveLength(0);
            expect(diff.deleted).toHaveLength(0);
            expect(diff.modified).toHaveLength(0);
        });
    });
});
