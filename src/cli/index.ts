#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { installServiceCommand } from "./commands/install-service.js";
import { uninstallServiceCommand } from "./commands/uninstall-service.js";

const program = new Command();

program
    .name("synchrotron")
    .description("A local, platform-agnostic file synchronisation tool")
    .version("0.1.0");

program
    .command("init")
    .description("Create a .synchrotron.yml configuration file in ~/.synchrotron")
    .option("--config <dir>", "Directory to write the config file to (defaults to ~/.synchrotron)")
    .action(initCommand);

program
    .command("start")
    .description("Start the sync daemon in the background")
    .option("--foreground", "Run in the foreground instead of as a daemon")
    .option("--config <dir>", "Directory containing the config file (defaults to ~/.synchrotron)")
    .action(startCommand);

program
    .command("stop")
    .description("Stop the running sync daemon")
    .action(stopCommand);

program
    .command("status")
    .description("Show the current status of the sync daemon")
    .option("--config <dir>", "Directory containing the config file (defaults to ~/.synchrotron)")
    .action(statusCommand);

program
    .command("install-service")
    .description("Install synchrotron as a startup service for the current platform")
    .action(installServiceCommand);

program
    .command("uninstall-service")
    .description("Remove the synchrotron startup service")
    .action(uninstallServiceCommand);

program.parse();
