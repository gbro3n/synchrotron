import { writeDefaultConfig } from "../../config/loader.js";

interface InitOptions {
    config?: string;
}

export function initCommand(options: InitOptions): void {
    try {
        const configPath = writeDefaultConfig(options.config);
        console.log(`Created configuration file: ${configPath}`);
        console.log("Edit the file to add your sync sets, then run 'synchrotron start'.");
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
    }
}
