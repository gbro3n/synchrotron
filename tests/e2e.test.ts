import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SyncEngine } from "../src/sync/engine.js";
import { readMetadata } from "../src/sync/metadata.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-e2e-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("End-to-End Sync Tests", () => {
    let dir1: string;
    let dir2: string;
    let dir3: string;
    let engine: SyncEngine;

    beforeEach(() => {
        dir1 = createTempDir();
        dir2 = createTempDir();
        dir3 = createTempDir();
        engine = new SyncEngine("keep-both");
    });

    afterEach(() => {
        cleanupDir(dir1);
        cleanupDir(dir2);
        cleanupDir(dir3);
    });

    it("should perform full sync lifecycle: seed → sync → modify → sync → delete → sync", async () => {
        // Step 1: Seed files in dir1
        fs.writeFileSync(path.join(dir1, "readme.txt"), "Welcome to synchrotron");
        fs.mkdirSync(path.join(dir1, "docs"));
        fs.writeFileSync(path.join(dir1, "docs", "guide.md"), "# User Guide");

        // Step 2: First sync — dir2 and dir3 are fresh peers
        const result1 = await engine.syncSet({
            type: "directory",
            paths: [dir1, dir2, dir3],
        });

        expect(result1.errors).toHaveLength(0);
        expect(fs.readFileSync(path.join(dir2, "readme.txt"), "utf-8")).toBe("Welcome to synchrotron");
        expect(fs.readFileSync(path.join(dir3, "docs", "guide.md"), "utf-8")).toBe("# User Guide");

        // All dirs should have metadata
        expect(readMetadata(dir1)).not.toBeNull();
        expect(readMetadata(dir2)).not.toBeNull();
        expect(readMetadata(dir3)).not.toBeNull();

        // Step 3: Modify a file in dir2
        fs.writeFileSync(path.join(dir2, "readme.txt"), "Updated from dir2");

        // Step 4: Sync — changes should propagate
        const result2 = await engine.syncSet({
            type: "directory",
            paths: [dir1, dir2, dir3],
        });

        expect(result2.errors).toHaveLength(0);
        expect(fs.readFileSync(path.join(dir1, "readme.txt"), "utf-8")).toBe("Updated from dir2");
        expect(fs.readFileSync(path.join(dir3, "readme.txt"), "utf-8")).toBe("Updated from dir2");

        // Step 5: Delete a file from dir3
        fs.unlinkSync(path.join(dir3, "docs", "guide.md"));

        // Step 6: Sync — deletion should propagate
        const result3 = await engine.syncSet({
            type: "directory",
            paths: [dir1, dir2, dir3],
        });

        expect(result3.errors).toHaveLength(0);
        expect(fs.existsSync(path.join(dir1, "docs", "guide.md"))).toBe(false);
        expect(fs.existsSync(path.join(dir2, "docs", "guide.md"))).toBe(false);
    });

    it("should handle adding a new file in one dir and syncing to all peers", async () => {
        // Initial sync with one file
        fs.writeFileSync(path.join(dir1, "base.txt"), "base");
        await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

        // Add new file in dir2
        fs.writeFileSync(path.join(dir2, "added.txt"), "added from dir2");
        await engine.syncSet({ type: "directory", paths: [dir1, dir2] });

        expect(fs.readFileSync(path.join(dir1, "added.txt"), "utf-8")).toBe("added from dir2");
    });

    it("should handle multiple sync sets independently", async () => {
        const setADir1 = createTempDir();
        const setADir2 = createTempDir();
        const setBDir1 = createTempDir();
        const setBDir2 = createTempDir();

        try {
            fs.writeFileSync(path.join(setADir1, "a.txt"), "set A file");
            fs.writeFileSync(path.join(setBDir1, "b.txt"), "set B file");

            await engine.syncSet({ name: "setA", paths: [setADir1, setADir2] });
            await engine.syncSet({ name: "setB", paths: [setBDir1, setBDir2] });

            // setA files should not appear in setB dirs and vice versa
            expect(fs.existsSync(path.join(setADir2, "a.txt"))).toBe(true);
            expect(fs.existsSync(path.join(setBDir2, "b.txt"))).toBe(true);
            expect(fs.existsSync(path.join(setADir2, "b.txt"))).toBe(false);
            expect(fs.existsSync(path.join(setBDir2, "a.txt"))).toBe(false);
        } finally {
            cleanupDir(setADir1);
            cleanupDir(setADir2);
            cleanupDir(setBDir1);
            cleanupDir(setBDir2);
        }
    });
});
