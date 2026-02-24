import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOG_DIR = path.join(os.homedir(), ".synchrotron", "logs");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5;

export class Logger {
    private logDir: string;
    private logFile: string;

    constructor(logDir?: string) {
        this.logDir = logDir ?? LOG_DIR;
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
            if (stat.size < MAX_LOG_SIZE) return;

            // Rotate: shift existing numbered logs
            for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
                const from = path.join(this.logDir, `synchrotron.${i}.log`);
                const to = path.join(this.logDir, `synchrotron.${i + 1}.log`);
                if (fs.existsSync(from)) {
                    if (i + 1 >= MAX_LOG_FILES) {
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
