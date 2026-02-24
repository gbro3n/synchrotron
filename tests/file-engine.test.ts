import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SyncEngine } from "../src/sync/engine.js";
import { readFileMetadata } from "../src/sync/file-metadata.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-fe-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("SyncEngine — file sets", () => {
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
        it("should copy source file to empty peer", async () => {
            const src = path.join(dir1, "hosts");
            const dest = path.join(dir2, "hosts.bak");
            fs.writeFileSync(src, "127.0.0.1 localhost");

            const result = await engine.syncFileSet({
                type: "file",
                paths: [src, dest],
            });

            expect(result.errors).toHaveLength(0);
            expect(fs.existsSync(dest)).toBe(true);
            expect(fs.readFileSync(dest, "utf-8")).toBe("127.0.0.1 localhost");
            expect(result.filesAdded).toBe(1);
        });

        it("should write sidecar metadata after sync", async () => {
            const src = path.join(dir1, "config.json");
            const dest = path.join(dir2, "config.json");
            fs.writeFileSync(src, '{"key":"value"}');

            await engine.syncFileSet({ type: "file", paths: [src, dest] });

            const srcMeta = readFileMetadata(src);
            const destMeta = readFileMetadata(dest);
            expect(srcMeta).not.toBeNull();
            expect(destMeta).not.toBeNull();
            expect(srcMeta!.hash).toBe(destMeta!.hash);
        });

        it("should do nothing when no peers have changed", async () => {
            const src = path.join(dir1, "file.txt");
            const dest = path.join(dir2, "file.txt");
            fs.writeFileSync(src, "hello");
            fs.writeFileSync(dest, "hello");

            // First sync to establish sidecars
            await engine.syncFileSet({ type: "file", paths: [src, dest] });

            // Second sync — nothing should change
            const result = await engine.syncFileSet({ type: "file", paths: [src, dest] });
            expect(result.filesAdded).toBe(0);
            expect(result.filesModified).toBe(0);
        });
    });

    describe("modifications", () => {
        it("should propagate a changed file to all peers", async () => {
            const f1 = path.join(dir1, "data.txt");
            const f2 = path.join(dir2, "data.txt");
            fs.writeFileSync(f1, "original");
            fs.writeFileSync(f2, "original");

            // Establish sidecars
            await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            // Modify f1
            fs.writeFileSync(f1, "updated content");

            const result = await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            expect(result.errors).toHaveLength(0);
            expect(result.filesModified).toBe(1);
            expect(fs.readFileSync(f2, "utf-8")).toBe("updated content");
        });

        it("should support different filenames across peers", async () => {
            const f1 = path.join(dir1, "settings.json");
            const f2 = path.join(dir2, "settings.yaml");
            fs.writeFileSync(f1, '{"env":"prod"}');

            const result = await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            expect(result.errors).toHaveLength(0);
            expect(fs.readFileSync(f2, "utf-8")).toBe('{"env":"prod"}');
        });
    });

    describe("conflict resolution", () => {
        it("should keep both files on conflict with keep-both strategy", async () => {
            const f1 = path.join(dir1, "shared.txt");
            const f2 = path.join(dir2, "shared.txt");
            fs.writeFileSync(f1, "v1");
            fs.writeFileSync(f2, "v1");

            // Establish sidecars
            await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            // Both peers change independently
            fs.writeFileSync(f1, "f1 change");
            fs.writeFileSync(f2, "f2 change");

            const result = await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            expect(result.conflicts).toBeGreaterThan(0);

            // The conflict file should have been renamed for f2
            const dir2Files = fs.readdirSync(dir2);
            const conflictFiles = dir2Files.filter((f) => f.includes("conflict"));
            expect(conflictFiles.length).toBeGreaterThan(0);
        });

        it("should use last-write-wins when configured", async () => {
            const lwwEngine = new SyncEngine("last-write-wins");
            const f1 = path.join(dir1, "data.txt");
            const f2 = path.join(dir2, "data.txt");
            fs.writeFileSync(f1, "original");
            fs.writeFileSync(f2, "original");

            await lwwEngine.syncFileSet({
                type: "file",
                paths: [f1, f2],
            });

            // Write f2 first (older), then f1 (newer)
            fs.writeFileSync(f2, "older version");
            await new Promise((r) => setTimeout(r, 50));
            fs.writeFileSync(f1, "newer version");

            const result = await lwwEngine.syncFileSet({
                type: "file",
                paths: [f1, f2],
                conflictResolution: "last-write-wins",
            });

            expect(result.conflicts).toBeGreaterThan(0);
            // f1 is newer so f2 should become "newer version"
            expect(fs.readFileSync(f2, "utf-8")).toBe("newer version");
        });
    });

    describe("sync actions tracking (file sets)", () => {
        it("should record added actions for fresh peer copy", async () => {
            const src = path.join(dir1, "data.txt");
            const dest = path.join(dir2, "data.txt");
            fs.writeFileSync(src, "hello");

            const result = await engine.syncFileSet({
                type: "file",
                paths: [src, dest],
            });

            const addedActions = result.actions.filter((a) => a.type === "added");
            expect(addedActions.length).toBe(1);
            expect(addedActions[0].sourcePath).toBe(src);
            expect(addedActions[0].destPath).toBe(dest);
        });

        it("should record modified actions when a peer changes", async () => {
            const f1 = path.join(dir1, "data.txt");
            const f2 = path.join(dir2, "data.txt");
            fs.writeFileSync(f1, "original");
            fs.writeFileSync(f2, "original");

            await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            fs.writeFileSync(f1, "changed");
            const result = await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            const modifiedActions = result.actions.filter((a) => a.type === "modified");
            expect(modifiedActions.length).toBe(1);
        });

        it("should record conflict actions when both peers change", async () => {
            const f1 = path.join(dir1, "shared.txt");
            const f2 = path.join(dir2, "shared.txt");
            fs.writeFileSync(f1, "v1");
            fs.writeFileSync(f2, "v1");

            await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            fs.writeFileSync(f1, "f1 change");
            fs.writeFileSync(f2, "f2 change");

            const result = await engine.syncFileSet({ type: "file", paths: [f1, f2] });

            const conflictActions = result.actions.filter((a) => a.type === "conflict");
            expect(conflictActions.length).toBeGreaterThan(0);
        });
    });
});
