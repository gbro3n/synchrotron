import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SyncEngine } from "../src/sync/engine.js";
import { readMetadata } from "../src/sync/metadata.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("SyncEngine", () => {
    let dir1: string;
    let dir2: string;
    let engine: SyncEngine;

    beforeEach(() => {
        dir1 = createTempDir();
        dir2 = createTempDir();
        engine = new SyncEngine("keep-both");
    });

    afterEach(() => {
        cleanupDir(dir1);
        cleanupDir(dir2);
    });

    describe("fresh peer sync", () => {
        it("should copy all files from seed to empty peer", async () => {
            // Create files in dir1 (seed)
            fs.writeFileSync(path.join(dir1, "file1.txt"), "hello");
            fs.writeFileSync(path.join(dir1, "file2.txt"), "world");

            // dir2 is empty (fresh peer)
            const result = await engine.syncSet({
                type: "directory",
                paths: [dir1, dir2],
            });

            expect(fs.existsSync(path.join(dir2, "file1.txt"))).toBe(true);
            expect(fs.existsSync(path.join(dir2, "file2.txt"))).toBe(true);
            expect(fs.readFileSync(path.join(dir2, "file1.txt"), "utf-8")).toBe("hello");
            expect(fs.readFileSync(path.join(dir2, "file2.txt"), "utf-8")).toBe("world");
            expect(result.errors).toHaveLength(0);
        });

        it("should not delete files from seed when peer is empty", async () => {
            fs.writeFileSync(path.join(dir1, "important.txt"), "keep me");

            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(fs.existsSync(path.join(dir1, "important.txt"))).toBe(true);
            expect(fs.readFileSync(path.join(dir1, "important.txt"), "utf-8")).toBe("keep me");
        });
    });

    describe("new files", () => {
        it("should propagate new files after initial sync", async () => {
            // Initial sync with some files
            fs.writeFileSync(path.join(dir1, "existing.txt"), "exists");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            // Add new file to dir1
            fs.writeFileSync(path.join(dir1, "new.txt"), "new content");

            // Sync again
            const result = await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(fs.existsSync(path.join(dir2, "new.txt"))).toBe(true);
            expect(fs.readFileSync(path.join(dir2, "new.txt"), "utf-8")).toBe("new content");
            expect(result.errors).toHaveLength(0);
        });
    });

    describe("deletions", () => {
        it("should propagate deletions after initial sync", async () => {
            // Initial sync
            fs.writeFileSync(path.join(dir1, "toDelete.txt"), "delete me");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(fs.existsSync(path.join(dir2, "toDelete.txt"))).toBe(true);

            // Delete from dir1
            fs.unlinkSync(path.join(dir1, "toDelete.txt"));

            // Sync again
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(fs.existsSync(path.join(dir2, "toDelete.txt"))).toBe(false);
        });
    });

    describe("modifications", () => {
        it("should propagate modifications", async () => {
            fs.writeFileSync(path.join(dir1, "file.txt"), "original");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            // Modify in dir1
            fs.writeFileSync(path.join(dir1, "file.txt"), "modified content");

            // Sync again
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(fs.readFileSync(path.join(dir2, "file.txt"), "utf-8")).toBe("modified content");
        });
    });

    describe("conflict resolution", () => {
        it("should keep both files on conflict with keep-both strategy", async () => {
            // Initial sync
            fs.writeFileSync(path.join(dir1, "conflict.txt"), "version1");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            // Modify in both dirs
            fs.writeFileSync(path.join(dir1, "conflict.txt"), "dir1 changes");
            fs.writeFileSync(path.join(dir2, "conflict.txt"), "dir2 changes");

            // Sync
            const result = await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(result.conflicts).toBeGreaterThan(0);

            // Both versions should exist in some form
            const dir2Files = fs.readdirSync(dir2);
            const conflictFiles = dir2Files.filter((f) => f.includes("conflict"));
            expect(conflictFiles.length).toBeGreaterThanOrEqual(2);
        });

        it("should use last-write-wins when configured", async () => {
            const lwwEngine = new SyncEngine("last-write-wins");

            // Initial sync
            fs.writeFileSync(path.join(dir1, "file.txt"), "original");
            await lwwEngine.syncSet({ type: "directory", paths: [dir1, dir2] });

            // Modify in both dirs with slight time gap
            fs.writeFileSync(path.join(dir2, "file.txt"), "older");

            // Wait a bit to ensure different mtimes
            await new Promise((r) => setTimeout(r, 50));
            fs.writeFileSync(path.join(dir1, "file.txt"), "newer");

            const result = await lwwEngine.syncSet({
                type: "directory",
                paths: [dir1, dir2],
                conflictResolution: "last-write-wins",
            });

            expect(result.conflicts).toBeGreaterThan(0);
        });
    });

    describe("metadata", () => {
        it("should create metadata files after sync", async () => {
            fs.writeFileSync(path.join(dir1, "file.txt"), "test");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            const meta1 = readMetadata(dir1);
            const meta2 = readMetadata(dir2);
            expect(meta1).not.toBeNull();
            expect(meta2).not.toBeNull();
            expect(meta1!.lastSyncTime).toBeGreaterThan(0);
        });
    });

    describe("nested directories", () => {
        it("should sync nested directory structures", async () => {
            fs.mkdirSync(path.join(dir1, "sub", "deep"), { recursive: true });
            fs.writeFileSync(path.join(dir1, "sub", "deep", "file.txt"), "nested");

            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            expect(fs.existsSync(path.join(dir2, "sub", "deep", "file.txt"))).toBe(true);
            expect(fs.readFileSync(path.join(dir2, "sub", "deep", "file.txt"), "utf-8")).toBe("nested");
        });
    });

    describe("error handling", () => {
        it("should create non-existent directory as fresh peer", async () => {
            const newDir = path.join(dir2, "subdir", "deep");
            fs.writeFileSync(path.join(dir1, "file.txt"), "data");

            const result = await engine.syncSet({
                type: "directory",
                paths: [dir1, newDir],
            });

            expect(result.errors).toHaveLength(0);
            expect(fs.existsSync(newDir)).toBe(true);
            expect(fs.readFileSync(path.join(newDir, "file.txt"), "utf-8")).toBe("data");
        });
    });

    describe("sync actions tracking", () => {
        it("should record added actions for fresh peer sync", async () => {
            fs.writeFileSync(path.join(dir1, "a.txt"), "hello");
            fs.writeFileSync(path.join(dir1, "b.txt"), "world");

            const result = await engine.syncSet({
                type: "directory",
                paths: [dir1, dir2],
            });

            expect(result.actions).toBeDefined();
            const addedActions = result.actions.filter((a) => a.type === "added");
            expect(addedActions.length).toBeGreaterThan(0);
            // Each added action should have sourcePath and destPath
            for (const action of addedActions) {
                expect(action.sourcePath).toBeTruthy();
                expect(action.destPath).toBeTruthy();
            }
        });

        it("should record modified actions when a file changes", async () => {
            fs.writeFileSync(path.join(dir1, "file.txt"), "original");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            fs.writeFileSync(path.join(dir1, "file.txt"), "changed");
            const result = await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            const modifiedActions = result.actions.filter((a) => a.type === "modified");
            expect(modifiedActions.length).toBeGreaterThan(0);
        });

        it("should record deleted actions when a file is removed", async () => {
            fs.writeFileSync(path.join(dir1, "file.txt"), "data");
            await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            fs.unlinkSync(path.join(dir1, "file.txt"));
            const result = await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

            const deletedActions = result.actions.filter((a) => a.type === "deleted");
            expect(deletedActions.length).toBeGreaterThan(0);
        });

        it("should create missing directories and record added actions", async () => {
            const newDir = path.join(dir2, "auto-created");
            fs.writeFileSync(path.join(dir1, "test.txt"), "hello");

            const result = await engine.syncSet({
                type: "directory",
                paths: [dir1, newDir],
            });

            expect(result.errors).toHaveLength(0);
            const addedActions = result.actions.filter((a) => a.type === "added");
            expect(addedActions.length).toBeGreaterThan(0);
            expect(fs.existsSync(path.join(newDir, "test.txt"))).toBe(true);
        });
    });
});
