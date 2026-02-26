import { describe, it, expect } from "vitest";
import {
    findSynchrotronProcesses,
    isProcessRunning,
    killProcess,
} from "../src/daemon/process.js";

describe("Process Discovery & Management", () => {
    describe("isProcessRunning", () => {
        it("should return true for the current process", () => {
            expect(isProcessRunning(process.pid)).toBe(true);
        });

        it("should return false for a non-existent PID", () => {
            // Use a very high PID unlikely to exist
            expect(isProcessRunning(999999)).toBe(false);
        });
    });

    describe("findSynchrotronProcesses", () => {
        it("should return an array (may be empty if no daemons running)", () => {
            const procs = findSynchrotronProcesses();
            expect(Array.isArray(procs)).toBe(true);
        });

        it("should not include the current process", () => {
            const procs = findSynchrotronProcesses();
            const pids = procs.map((p) => p.pid);
            expect(pids).not.toContain(process.pid);
        });

        it("should return objects with pid and commandLine", () => {
            const procs = findSynchrotronProcesses();
            for (const proc of procs) {
                expect(typeof proc.pid).toBe("number");
                expect(typeof proc.commandLine).toBe("string");
            }
        });
    });

    describe("killProcess", () => {
        it("should return true for a non-existent PID (already dead)", () => {
            expect(killProcess(999999)).toBe(true);
        });
    });
});
