/**
 * Daemon entry point — spawned as a detached child process.
 * The first argument is the config directory (defaults to ~/.synchrotron).
 */
import { runForeground } from "./runner.js";
import { getConfigHome } from "../config/loader.js";

const configDir = process.argv[2] ?? getConfigHome();
runForeground(configDir);
