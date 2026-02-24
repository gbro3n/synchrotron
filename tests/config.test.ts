import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, writeDefaultConfig, validateConfig } from "../src/config/loader.js";
import type { SynchrotronConfig } from "../src/config/types.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("Config Loader", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        cleanupDir(tempDir);
    });

    describe("writeDefaultConfig", () => {
        it("should create a default config file", () => {
            const configPath = writeDefaultConfig(tempDir);
            expect(fs.existsSync(configPath)).toBe(true);

            const content = fs.readFileSync(configPath, "utf-8");
            expect(content).toContain("pollInterval");
            expect(content).toContain("conflictResolution");
            expect(content).toContain("syncSets");
        });

        it("should throw if config already exists", () => {
            writeDefaultConfig(tempDir);
            expect(() => writeDefaultConfig(tempDir)).toThrow("already exists");
        });
    });

    describe("loadConfig", () => {
        it("should load a valid config", () => {
            writeDefaultConfig(tempDir);
            const config = loadConfig(tempDir);
            expect(config.pollInterval).toBe(5000);
            expect(config.conflictResolution).toBe("keep-both");
            expect(config.syncSets).toEqual([]);
        });

        it("should throw if config file does not exist", () => {
            expect(() => loadConfig(tempDir)).toThrow("Config file not found");
        });
    });

    describe("validateConfig", () => {
        it("should accept a valid config", () => {
            const dir1 = createTempDir();
            const dir2 = createTempDir();
            try {
                const config = validateConfig({
                    pollInterval: 3000,
                    conflictResolution: "last-write-wins",
                    syncSets: [
                        {
                            type: "directory",
                            paths: [dir1, dir2],
                            ignore: ["*.tmp"],
                            watchMode: "poll",
                        },
                    ],
                });
                expect(config.pollInterval).toBe(3000);
                expect(config.conflictResolution).toBe("last-write-wins");
                expect(config.syncSets).toHaveLength(1);
                expect(config.syncSets[0].watchMode).toBe("poll");
            } finally {
                cleanupDir(dir1);
                cleanupDir(dir2);
            }
        });

        it("should use defaults for missing optional fields", () => {
            const config = validateConfig({
                syncSets: [
                    { type: "directory", paths: ["/a", "/b"] },
                ],
            });
            expect(config.pollInterval).toBe(5000);
            expect(config.conflictResolution).toBe("keep-both");
        });

        it("should reject non-object config", () => {
            expect(() => validateConfig("string")).toThrow("must be a YAML object");
        });

        it("should reject missing syncSets", () => {
            expect(() => validateConfig({})).toThrow("syncSets must be an array");
        });

        it("should reject sync set without type", () => {
            expect(() =>
                validateConfig({ syncSets: [{ paths: ["/a", "/b"] }] }),
            ).toThrow('type must be');
        });

        it("should reject invalid type value", () => {
            expect(() =>
                validateConfig({ syncSets: [{ type: "invalid", paths: ["/a", "/b"] }] }),
            ).toThrow('type must be');
        });

        it("should reject sync set with fewer than 2 paths", () => {
            expect(() =>
                validateConfig({ syncSets: [{ type: "directory", paths: ["/a"] }] }),
            ).toThrow("at least 2 paths");
        });

        it("should accept type: file sync set", () => {
            const config = validateConfig({
                syncSets: [{ type: "file", paths: ["/a/file.txt", "/b/file.txt"] }],
            });
            expect(config.syncSets[0].type).toBe("file");
        });
    });
});
