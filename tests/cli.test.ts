import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeDefaultConfig, loadConfig } from "../src/config/loader.js";
import { readPidFile, writePidFile, removePidFile, getPidFilePath } from "../src/daemon/pid.js";
import { readMetadata } from "../src/sync/metadata.js";

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "synchrotron-cli-test-"));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("CLI Integration Tests", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        cleanupDir(tempDir);
    });

    describe("init command", () => {
        it("should create .synchrotron.yml in the specified directory", () => {
            const configPath = writeDefaultConfig(tempDir);
            expect(fs.existsSync(configPath)).toBe(true);

            const content = fs.readFileSync(configPath, "utf-8");
            expect(content).toContain("pollInterval");
            expect(content).toContain("conflictResolution");
            expect(content).toContain("syncSets");
        });

        it("should fail if config already exists", () => {
            writeDefaultConfig(tempDir);
            expect(() => writeDefaultConfig(tempDir)).toThrow("already exists");
        });
    });

    describe("status command logic", () => {
        it("should report no daemon when no PID file exists", () => {
            const pid = readPidFile();
            expect(pid).toBeNull();
        });

        it("should load config and show sync set info", () => {
            writeDefaultConfig(tempDir);
            const config = loadConfig(tempDir);
            expect(config.syncSets).toHaveLength(0);
            expect(config.pollInterval).toBe(5000);
            expect(config.conflictResolution).toBe("keep-both");
        });

        it("should show sync set details with metadata", () => {
            const dir1 = createTempDir();
            const dir2 = createTempDir();

            try {
                // Write a config file directly as a YAML string
                const configPath = path.join(tempDir, ".synchrotron.yml");
                const content = [
                    "pollInterval: 5000",
                    "conflictResolution: keep-both",
                    "syncSets:",
                    "  - type: directory",
                    "    paths:",
                    `      - ${dir1}`,
                    `      - ${dir2}`,
                ].join("\n") + "\n";
                fs.writeFileSync(configPath, content, "utf-8");

                const config = loadConfig(tempDir);
                expect(config.syncSets).toHaveLength(1);

                // Check directory existence and metadata (pre-sync, no metadata)
                for (const dirPath of config.syncSets[0].paths) {
                    expect(fs.existsSync(dirPath)).toBe(true);
                    expect(readMetadata(dirPath)).toBeNull();
                }
            } finally {
                cleanupDir(dir1);
                cleanupDir(dir2);
            }
        });
    });

    describe("stop command logic", () => {
        it("should detect no daemon running when no PID file exists", () => {
            const pid = readPidFile();
            expect(pid).toBeNull();
        });

        it("should detect stale PID file", () => {
            // Write a PID that doesn't exist
            writePidFile(999999);
            const pid = readPidFile();
            expect(pid).toBe(999999);

            // Process should not be running
            let running = false;
            try {
                process.kill(999999, 0);
                running = true;
            } catch {
                running = false;
            }
            expect(running).toBe(false);

            // Clean up
            removePidFile();
            expect(readPidFile()).toBeNull();
        });
    });

    describe("PID file management", () => {
        it("should write and read PID file", () => {
            writePidFile(12345);
            expect(readPidFile()).toBe(12345);
            removePidFile();
        });

        it("should remove PID file", () => {
            writePidFile(12345);
            removePidFile();
            expect(readPidFile()).toBeNull();
        });

        it("should return consistent PID file path", () => {
            const pidPath = getPidFilePath();
            expect(pidPath).toContain(".synchrotron");
            expect(pidPath).toContain("daemon.pid");
        });
    });
});
