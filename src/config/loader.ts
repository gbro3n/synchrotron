import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "yaml";
import type { SynchrotronConfig, SyncSet } from "./types.js";
import { CONFIG_DEFAULTS } from "./types.js";

/**
 * Returns the Synchrotron config home directory: ~/.synchrotron
 * This is where the default config file and daemon PID are stored.
 */
export function getConfigHome(): string {
    return path.join(os.homedir(), ".synchrotron");
}

/**
 * Validate a loaded configuration object. Throws on invalid config.
 */
export function validateConfig(config: unknown): SynchrotronConfig {
    if (typeof config !== "object" || config === null) {
        throw new Error("Configuration must be a YAML object");
    }

    const raw = config as Record<string, unknown>;

    const pollInterval =
        typeof raw.pollInterval === "number" ? raw.pollInterval : CONFIG_DEFAULTS.pollInterval;

    if (pollInterval <= 0) {
        throw new Error("pollInterval must be a positive number");
    }

    const validConflictResolutions = ["keep-both", "last-write-wins"];
    const conflictResolution =
        typeof raw.conflictResolution === "string" &&
            validConflictResolutions.includes(raw.conflictResolution)
            ? (raw.conflictResolution as SynchrotronConfig["conflictResolution"])
            : CONFIG_DEFAULTS.conflictResolution;

    const maxLogSizeMB =
        typeof raw.maxLogSizeMB === "number" ? raw.maxLogSizeMB : CONFIG_DEFAULTS.maxLogSizeMB;
    if (maxLogSizeMB <= 0) {
        throw new Error("maxLogSizeMB must be a positive number");
    }

    const maxLogFiles =
        typeof raw.maxLogFiles === "number" ? raw.maxLogFiles : CONFIG_DEFAULTS.maxLogFiles;
    if (maxLogFiles <= 0 || !Number.isInteger(maxLogFiles)) {
        throw new Error("maxLogFiles must be a positive integer");
    }

    // null means the key exists but has no items (e.g. "syncSets:" with only commented examples below)
    // undefined means the key is missing entirely — that is an error
    if (!("syncSets" in raw)) {
        throw new Error("syncSets must be an array");
    }
    const rawSyncSets = raw.syncSets ?? [];
    if (!Array.isArray(rawSyncSets)) {
        throw new Error("syncSets must be an array");
    }

    const syncSets: SyncSet[] = rawSyncSets.map((set: unknown, index: number) => {
        if (typeof set !== "object" || set === null) {
            throw new Error(`syncSets[${index}] must be an object`);
        }
        const s = set as Record<string, unknown>;

        const validTypes = ["directory", "file"];
        if (typeof s.type !== "string" || !validTypes.includes(s.type)) {
            throw new Error(`syncSets[${index}].type must be "directory" or "file"`);
        }
        const type = s.type as SyncSet["type"];

        if (!Array.isArray(s.paths) || s.paths.length < 2) {
            throw new Error(`syncSets[${index}].paths must be an array with at least 2 paths`);
        }

        for (const p of s.paths) {
            if (typeof p !== "string" || p.trim() === "") {
                throw new Error(`syncSets[${index}].paths entries must be non-empty strings`);
            }
        }

        const syncSet: SyncSet = {
            type,
            paths: s.paths as string[],
        };

        if (typeof s.name === "string" && s.name.trim() !== "") {
            syncSet.name = s.name.trim();
        }

        if (type === "directory") {
            if (Array.isArray(s.ignore)) {
                syncSet.ignore = s.ignore.filter((i): i is string => typeof i === "string");
            }

            const validWatchModes = ["auto", "watch", "poll"];
            if (typeof s.watchMode === "string" && validWatchModes.includes(s.watchMode)) {
                syncSet.watchMode = s.watchMode as SyncSet["watchMode"];
            }
        }

        if (typeof s.pollInterval === "number" && s.pollInterval > 0) {
            syncSet.pollInterval = s.pollInterval;
        }

        if (
            typeof s.conflictResolution === "string" &&
            validConflictResolutions.includes(s.conflictResolution)
        ) {
            syncSet.conflictResolution = s.conflictResolution as SyncSet["conflictResolution"];
        }

        return syncSet;
    });

    return { pollInterval, conflictResolution, maxLogSizeMB, maxLogFiles, syncSets };
}

/**
 * Load and validate a Synchrotron config from a YAML file.
 * @param configDir Directory containing the config file (defaults to ~/.synchrotron)
 */
export function loadConfig(configDir?: string): SynchrotronConfig {
    const dir = configDir ?? getConfigHome();
    const configPath = path.join(dir, CONFIG_DEFAULTS.configFileName);

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = yaml.parse(raw);
    return validateConfig(parsed);
}

/**
 * Write a default .synchrotron.yml configuration file.
 * @param configDir Directory to write the config file to (defaults to ~/.synchrotron)
 * @returns The path of the created file
 */
export function writeDefaultConfig(configDir?: string): string {
    const dir = configDir ?? getConfigHome();
    const configPath = path.join(dir, CONFIG_DEFAULTS.configFileName);

    if (fs.existsSync(configPath)) {
        throw new Error(`Config file already exists: ${configPath}`);
    }

    fs.mkdirSync(dir, { recursive: true });

    const template = [
        "# Synchrotron configuration",
        "# https://github.com/gbro3n/synchrotron",
        "",
        "# Default poll interval in milliseconds",
        "pollInterval: 5000",
        "",
        "# Default conflict resolution strategy: keep-both | last-write-wins",
        "conflictResolution: keep-both",
        "",
        "# Log rotation settings (optional)",
        "# maxLogSizeMB: 10    # Max log file size in MB before rotation (default: 10)",
        "# maxLogFiles: 5      # Max number of rotated log files to keep (default: 5)",
        "",
        "# Sync sets — each entry syncs a group of paths",
        "# Each set must declare a type: directory (syncs full trees) or file (syncs individual files)",
        "# An optional 'name' field labels the set in logs and status output.",
        "# Add your sets below. Remove the '#' from the examples to get started.",
        "syncSets:",
        "# Directory sync example:",
        "# - name: documents",
        "#   type: directory",
        "#   paths:",
        "#     - /home/user/documents",
        "#     - /mnt/backup/documents",
        "#   ignore:",
        "#     - \"*.tmp\"",
        "#     - \".DS_Store\"",
        "#   watchMode: auto   # auto | watch | poll",
        "#   pollInterval: 5000",
        "#",
        "# File sync example (syncs individual files by content, regardless of filename):",
        "# - name: hosts",
        "#   type: file",
        "#   paths:",
        "#     - /etc/hosts",
        "#     - /mnt/backup/hosts",
    ].join("\n") + "\n";

    fs.writeFileSync(configPath, template, "utf-8");
    return configPath;
}

