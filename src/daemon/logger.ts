import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_LOG_DIR = path.join(os.homedir(), ".synchrotron", "logs");
const DEFAULT_MAX_LOG_SIZE_MB = 10;
const DEFAULT_MAX_LOG_FILES = 5;

export interface LoggerOptions {
    logDir?: string;
    maxLogSizeMB?: number;
    maxLogFiles?: number;
}

export class Logger {
    private logDir: string;
    private logFile: string;
    private maxLogSize: number;
    private maxLogFiles: number;

    constructor(options: LoggerOptions = {}) {
        this.logDir = options.logDir ?? DEFAULT_LOG_DIR;
        this.maxLogSize = (options.maxLogSizeMB ?? DEFAULT_MAX_LOG_SIZE_MB) * 1024 * 1024;
        this.maxLogFiles = options.maxLogFiles ?? DEFAULT_MAX_LOG_FILES;
        this.logFile = path.join(this.logDir, "synchrotron.log");
        fs.mkdirSync(this.logDir, { recursive: true });
    }

    /**
     * Get the path to the current log file.
     */
    getLogFilePath(): string {
        return this.logFile;
    }

    /**
     * Write an info log message.
     */
    info(message: string): void {
        this.write("INFO", message);
    }

    /**
     * Write a warning log message.
     */
    warn(message: string): void {
        this.write("WARN", message);
    }

    /**
     * Write an error log message.
     */
    error(message: string): void {
        this.write("ERROR", message);
    }

    private write(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] [${level}] ${message}\n`;

        this.rotateIfNeeded();
        fs.appendFileSync(this.logFile, line, "utf-8");
    }

    private rotateIfNeeded(): void {
        try {
            if (!fs.existsSync(this.logFile)) return;

            const stat = fs.statSync(this.logFile);
            if (stat.size < this.maxLogSize) return;

            // Rotate: shift existing numbered logs
            for (let i = this.maxLogFiles - 1; i > 0; i--) {
                const from = path.join(this.logDir, `synchrotron.${i}.log`);
                const to = path.join(this.logDir, `synchrotron.${i + 1}.log`);
                if (fs.existsSync(from)) {
                    if (i + 1 >= this.maxLogFiles) {
                        fs.unlinkSync(from);
                    } else {
                        fs.renameSync(from, to);
                    }
                }
            }

            // Move current log to .1
            const rotatedPath = path.join(this.logDir, "synchrotron.1.log");
            fs.renameSync(this.logFile, rotatedPath);
        } catch {
            // If rotation fails, continue writing to current log
        }
    }
}
