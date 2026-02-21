/**
 * Generates .context/commands with predefined slash-command files
 * (e.g. init-mcp-only) for sync to .cursor/commands and .agent/workflows.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { PREDEFINED_COMMANDS } from './commandTemplates';

export interface GenerateCommandsOptions {
  /** Overwrite existing command files (default: false) */
  force?: boolean;
}

export interface GenerateCommandsResult {
  commandsDir: string;
  generated: string[];
  skipped: string[];
}

/**
 * Write predefined command markdown files into outputDir/commands.
 * Returns list of generated and skipped filenames.
 */
export async function generateCommands(
  outputDir: string,
  options: GenerateCommandsOptions = {}
): Promise<GenerateCommandsResult> {
  const commandsDir = path.join(outputDir, 'commands');
  await fs.ensureDir(commandsDir);

  const generated: string[] = [];
  const skipped: string[] = [];
  const force = options.force ?? false;

  for (const cmd of PREDEFINED_COMMANDS) {
    const filePath = path.join(commandsDir, cmd.filename);
    const exists = await fs.pathExists(filePath);
    if (exists && !force) {
      skipped.push(cmd.filename);
      continue;
    }
    await fs.writeFile(filePath, cmd.content.trimEnd() + '\n', 'utf8');
    generated.push(cmd.filename);
  }

  return { commandsDir, generated, skipped };
}
