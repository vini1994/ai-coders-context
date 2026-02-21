/**
 * Quick Sync Service
 *
 * Unified sync operation that synchronizes agents, exports skills,
 * and optionally updates documentation in one command.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import type { CLIInterface } from '../../utils/cliUI';
import type { TranslateFn } from '../../utils/i18n';
import { SyncService } from '../sync';
import {
  toAntigravityFilename,
  toAntigravityWorkflowContent,
} from '../sync/antigravityWorkflowFormat';
import { SkillExportService, ExportRulesService } from '../export';
import { StateDetector } from '../state';
import { createSkillRegistry } from '../../workflow/skills';
import { getCommandsSyncPresets } from '../shared';

export interface QuickSyncServiceDependencies {
  ui: CLIInterface;
  t: TranslateFn;
  version: string;
  defaultModel?: string;
}

export interface QuickSyncOptions {
  /** Skip agents sync */
  skipAgents?: boolean;
  /** Skip skills export */
  skipSkills?: boolean;
  /** Skip docs update prompt */
  skipDocs?: boolean;
  /** Force overwrite */
  force?: boolean;
  /** Dry run mode */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Selected agent sync targets (e.g., ['claude', 'github']). If not set, syncs to all. */
  agentTargets?: string[];
  /** Selected skill export targets (e.g., ['claude', 'gemini']). If not set, exports to all. */
  skillTargets?: string[];
  /** Selected doc export targets (e.g., ['cursor', 'claude']). If not set, exports to all. */
  docTargets?: string[];
  /** Skip commands sync (slash commands → .cursor/commands, .agent/workflows) */
  skipCommands?: boolean;
  /** Selected command sync targets (e.g., ['cursor', 'antigravity']). If not set, syncs to all. */
  commandTargets?: string[];
  /** LLM config for docs update */
  llmConfig?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

export interface QuickSyncResult {
  agentsSynced: number;
  skillsExported: number;
  commandsSynced: number;
  docsUpdated: boolean;
  errors: string[];
}

export class QuickSyncService {
  private readonly ui: CLIInterface;
  private readonly t: TranslateFn;
  private readonly version: string;
  private readonly defaultModel: string;

  constructor(deps: QuickSyncServiceDependencies) {
    this.ui = deps.ui;
    this.t = deps.t;
    this.version = deps.version;
    this.defaultModel = deps.defaultModel || 'anthropic/claude-sonnet-4';
  }

  /**
   * Run unified sync operation
   */
  async run(repoPath: string, options: QuickSyncOptions = {}): Promise<QuickSyncResult> {
    const absolutePath = path.resolve(repoPath);

    const result: QuickSyncResult = {
      agentsSynced: 0,
      skillsExported: 0,
      commandsSynced: 0,
      docsUpdated: false,
      errors: [],
    };

    // Step 1: Sync agents
    if (!options.skipAgents) {
      // Skip if user explicitly selected zero targets (empty array)
      const shouldSkipAgents = Array.isArray(options.agentTargets) && options.agentTargets.length === 0;
      if (!shouldSkipAgents) {
        try {
          this.ui.startSpinner(this.t('prompts.quickSync.syncing.agents'));

          const agentsPath = path.join(absolutePath, '.context', 'agents');
          if (await fs.pathExists(agentsPath)) {
            const syncService = new SyncService({
              ui: this.ui,
              t: this.t,
              version: this.version,
            });

            // Use selected targets (preset names) or default to 'all' preset
            // SyncService now understands preset names in the target array
            const hasCustomTargets = options.agentTargets && options.agentTargets.length > 0;

            await syncService.run({
              source: agentsPath,
              preset: hasCustomTargets ? undefined : 'all',
              target: hasCustomTargets ? options.agentTargets : undefined,
            force: options.force,
            dryRun: options.dryRun,
            verbose: false,
          });

          // Count synced files
          const files = await fs.readdir(agentsPath);
          result.agentsSynced = files.filter(f => f.endsWith('.md')).length;

          const targetInfo = hasCustomTargets
            ? `to ${options.agentTargets!.join(', ')}`
            : 'to all targets';
          this.ui.updateSpinner(`${result.agentsSynced} agents synced ${targetInfo}`, 'success');
          } else {
            this.ui.updateSpinner('No agents to sync', 'info');
          }
        } catch (error) {
          this.ui.updateSpinner('Failed to sync agents', 'fail');
          result.errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          this.ui.stopSpinner();
        }
      }
    }

    // Step 2: Export skills
    if (!options.skipSkills) {
      // Skip if user explicitly selected zero targets (empty array)
      const shouldSkipSkills = Array.isArray(options.skillTargets) && options.skillTargets.length === 0;
      if (!shouldSkipSkills) {
        try {
          this.ui.startSpinner(this.t('prompts.quickSync.syncing.skills'));

          const skillsPath = path.join(absolutePath, '.context', 'skills');
          if (await fs.pathExists(skillsPath)) {
            const skillExportService = new SkillExportService({
              ui: this.ui,
              t: this.t,
              version: this.version,
            });

            // Use selected targets (preset names) or default to 'all' preset
            // SkillExportService now understands preset names in the targets array
            const hasCustomTargets = options.skillTargets && options.skillTargets.length > 0;

            const exportResult = await skillExportService.run(absolutePath, {
              preset: hasCustomTargets ? undefined : 'all',
              targets: hasCustomTargets ? options.skillTargets : undefined,
              force: options.force,
              dryRun: options.dryRun,
              verbose: false,
              includeBuiltIn: true,
            });

            result.skillsExported = exportResult.skillsExported.length;
            const targetInfo = hasCustomTargets
              ? `to ${options.skillTargets!.join(', ')}`
              : 'to all targets';
            this.ui.updateSpinner(`${result.skillsExported} skills exported ${targetInfo}`, 'success');
          } else {
            this.ui.updateSpinner('No skills to export', 'info');
          }
        } catch (error) {
          this.ui.updateSpinner('Failed to export skills', 'fail');
          result.errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          this.ui.stopSpinner();
        }
      }
    }

    // Step 3: Sync commands (slash commands → .cursor/commands, .agent/workflows)
    if (!options.skipCommands) {
      const shouldSkipCommands = Array.isArray(options.commandTargets) && options.commandTargets.length === 0;
      if (!shouldSkipCommands) {
        try {
          this.ui.startSpinner(this.t('prompts.quickSync.syncing.commands'));

          const commandsPath = path.join(absolutePath, '.context', 'commands');
          if (await fs.pathExists(commandsPath)) {
            const commandsPresets = getCommandsSyncPresets();
            const hasCustomTargets = options.commandTargets && options.commandTargets.length > 0;
            const targetIds = hasCustomTargets ? options.commandTargets! : Object.keys(commandsPresets);
            const antigravityPreset = commandsPresets['antigravity'];
            const antigravityPath =
              antigravityPreset && targetIds.includes('antigravity')
                ? path.resolve(absolutePath, antigravityPreset.path)
                : null;
            const otherTargetIds = targetIds.filter((id) => id !== 'antigravity');
            const otherTargetPaths = otherTargetIds
              .map((id) => commandsPresets[id])
              .filter(Boolean)
              .map((p) => path.resolve(absolutePath, p.path));

            const commandFiles = (await fs.readdir(commandsPath)).filter((f) => f.endsWith('.md'));

            if (otherTargetPaths.length > 0) {
              const syncService = new SyncService({
                ui: this.ui,
                t: this.t,
                version: this.version,
              });
              await syncService.run({
                source: commandsPath,
                target: otherTargetPaths,
                force: options.force,
                dryRun: options.dryRun,
                verbose: false,
              });
            }

            if (antigravityPath && commandFiles.length > 0) {
              await this.exportCommandsToAntigravity(commandsPath, antigravityPath, commandFiles, {
                force: options.force ?? false,
                dryRun: options.dryRun ?? false,
              });
            }

            result.commandsSynced = commandFiles.length;

            const targetInfo = hasCustomTargets
              ? `to ${options.commandTargets!.join(', ')}`
              : 'to all targets';
            this.ui.updateSpinner(`${result.commandsSynced} commands synced ${targetInfo}`, 'success');
          } else {
            this.ui.updateSpinner('No commands to sync', 'info');
          }
        } catch (error) {
          this.ui.updateSpinner('Failed to sync commands', 'fail');
          result.errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          this.ui.stopSpinner();
        }
      }
    }

    // Step 4: Export docs/rules
    if (!options.skipDocs) {
      // Skip if user explicitly selected zero targets (empty array)
      const shouldSkipDocs = Array.isArray(options.docTargets) && options.docTargets.length === 0;
      if (!shouldSkipDocs) {
        try {
          this.ui.startSpinner(this.t('prompts.quickSync.syncing.rules'));

          const docsPath = path.join(absolutePath, '.context', 'docs');
          if (await fs.pathExists(docsPath)) {
            const exportRulesService = new ExportRulesService({
              ui: this.ui,
              t: this.t,
              version: this.version,
            });

            const hasCustomTargets = options.docTargets && options.docTargets.length > 0;

            await exportRulesService.run(absolutePath, {
              source: docsPath,
              preset: hasCustomTargets ? undefined : 'all',
              targets: hasCustomTargets ? options.docTargets : undefined,
              force: options.force,
              dryRun: options.dryRun,
            });

            const targetInfo = hasCustomTargets
              ? `to ${options.docTargets!.join(', ')}`
              : 'to all targets';
            this.ui.updateSpinner(`Rules exported ${targetInfo}`, 'success');
          } else {
            this.ui.updateSpinner('No docs to export', 'info');
          }
        } catch (error) {
          this.ui.updateSpinner('Failed to export rules', 'fail');
          result.errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          this.ui.stopSpinner();
        }
      }
    }

    // Step 5: Check docs status
    if (!options.skipDocs) {
      try {
        this.ui.startSpinner(this.t('prompts.quickSync.syncing.docs'));

        const detector = new StateDetector({ projectPath: absolutePath });
        const state = await detector.detect();

        if (state.state === 'outdated' && state.details.daysBehind) {
          this.ui.updateSpinner(
            this.t('prompts.quickSync.docsOutdated', { days: state.details.daysBehind }),
            'warn'
          );
          this.ui.stopSpinner();

          // Return info about outdated docs - caller can handle prompting
          result.docsUpdated = false;
        } else {
          this.ui.updateSpinner('Docs up to date', 'success');
          result.docsUpdated = true;
        }
      } catch (error) {
        this.ui.updateSpinner('Failed to check docs', 'fail');
        result.errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        this.ui.stopSpinner();
      }
    }

    return result;
  }

  /**
   * Export .context/commands to .agent/workflows in Google Antigravity format:
   * YAML frontmatter with description (max 250 chars) and filename with underscores.
   */
  private async exportCommandsToAntigravity(
    sourceDir: string,
    targetDir: string,
    filenames: string[],
    options: { force: boolean; dryRun: boolean }
  ): Promise<number> {
    if (options.dryRun) return filenames.length;
    await fs.ensureDir(targetDir);
    let written = 0;
    for (const filename of filenames) {
      const srcPath = path.join(sourceDir, filename);
      const content = await fs.readFile(srcPath, 'utf8');
      const workflowContent = toAntigravityWorkflowContent(content);
      const outFilename = toAntigravityFilename(filename);
      const outPath = path.join(targetDir, outFilename);
      // Sempre sobrescrever para o destino ficar igual à origem (sync = espelho)
      await fs.writeFile(outPath, workflowContent, 'utf8');
      written++;
    }
    return written;
  }

  /**
   * Get quick stats for project
   */
  async getStats(repoPath: string): Promise<{
    docs: number;
    agents: number;
    skills: number;
    commands: number;
    daysOld?: number;
  }> {
    const absolutePath = path.resolve(repoPath);

    let docs = 0;
    let agents = 0;
    let skills = 0;
    let commands = 0;
    let daysOld: number | undefined;

    // Count docs
    const docsPath = path.join(absolutePath, '.context', 'docs');
    if (await fs.pathExists(docsPath)) {
      const files = await fs.readdir(docsPath);
      docs = files.filter(f => f.endsWith('.md')).length;
    }

    // Count agents
    const agentsPath = path.join(absolutePath, '.context', 'agents');
    if (await fs.pathExists(agentsPath)) {
      const files = await fs.readdir(agentsPath);
      agents = files.filter(f => f.endsWith('.md')).length;
    }

    // Count skills
    const skillsPath = path.join(absolutePath, '.context', 'skills');
    if (await fs.pathExists(skillsPath)) {
      try {
        const registry = createSkillRegistry(absolutePath);
        const discovered = await registry.discoverAll();
        skills = discovered.all.length;
      } catch {
        // Fallback to directory count
        const dirs = await fs.readdir(skillsPath);
        skills = dirs.filter(d => !d.startsWith('.') && d !== 'README.md').length;
      }
    }

    // Count commands
    const commandsPath = path.join(absolutePath, '.context', 'commands');
    if (await fs.pathExists(commandsPath)) {
      const files = await fs.readdir(commandsPath);
      commands = files.filter(f => f.endsWith('.md')).length;
    }

    // Get days old
    const detector = new StateDetector({ projectPath: absolutePath });
    const state = await detector.detect();
    if (state.state === 'outdated') {
      daysOld = state.details.daysBehind;
    }

    return { docs, agents, skills, commands, daysOld };
  }
}

/**
 * Factory function
 */
export function createQuickSyncService(deps: QuickSyncServiceDependencies): QuickSyncService {
  return new QuickSyncService(deps);
}
