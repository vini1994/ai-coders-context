import * as path from 'path';
import * as fs from 'fs-extra';
import inquirer from 'inquirer';

import { colors } from '../../utils/theme';
import { FileMapper } from '../../utils/fileMapper';
import { DocumentationGenerator } from '../../generators/documentation/documentationGenerator';
import { AgentGenerator } from '../../generators/agents/agentGenerator';
import { SkillGenerator } from '../../generators/skills/skillGenerator';
import { generateCommands } from '../../generators/commands';
import { StackDetector, classifyProject, getFilteredScaffolds } from '../stack';
import type { CLIInterface } from '../../utils/cliUI';
import type { TranslateFn, TranslationKey } from '../../utils/i18n';
import type { RepoStructure } from '../../types';

export interface InitCommandFlags {
  output?: string;
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
  docsOnly?: boolean;
  agentsOnly?: boolean;
  semantic?: boolean;
  contentStubs?: boolean;
  /** Fill scaffolds with semantic data (no LLM required) */
  autoFill?: boolean;
}

export interface InitServiceDependencies {
  ui: CLIInterface;
  t: TranslateFn;
  version: string;
  documentationGenerator?: DocumentationGenerator;
  agentGenerator?: AgentGenerator;
  fileMapperFactory?: (exclude: string[] | undefined) => FileMapper;
}

interface InitOptions {
  repoPath: string;
  outputDir: string;
  include?: string[];
  exclude?: string[];
  verbose: boolean;
  scaffoldDocs: boolean;
  scaffoldAgents: boolean;
  scaffoldSkills: boolean;
  semantic: boolean;
  includeContentStubs: boolean;
  /** Fill scaffolds with semantic data (no LLM required) */
  autoFill: boolean;
}

export class InitService {
  private readonly ui: CLIInterface;
  private readonly t: TranslateFn;
  private readonly version: string;
  private readonly documentationGenerator: DocumentationGenerator;
  private readonly agentGenerator: AgentGenerator;
  private readonly fileMapperFactory: (exclude: string[] | undefined) => FileMapper;

  constructor(dependencies: InitServiceDependencies) {
    this.ui = dependencies.ui;
    this.t = dependencies.t;
    this.version = dependencies.version;
    this.documentationGenerator = dependencies.documentationGenerator ?? new DocumentationGenerator();
    this.agentGenerator = dependencies.agentGenerator ?? new AgentGenerator();
    this.fileMapperFactory = dependencies.fileMapperFactory ?? ((exclude?: string[]) => new FileMapper(exclude ?? []));
  }

  async run(repoPath: string, type: string, rawOptions: InitCommandFlags): Promise<void> {
    const resolvedType = resolveScaffoldType(type, rawOptions, this.t);

    const options: InitOptions = {
      repoPath: path.resolve(repoPath),
      outputDir: path.resolve(rawOptions.output || './.context'),
      include: rawOptions.include,
      exclude: rawOptions.exclude || [],
      verbose: Boolean(rawOptions.verbose),
      scaffoldDocs: resolvedType === 'docs' || resolvedType === 'both',
      scaffoldAgents: resolvedType === 'agents' || resolvedType === 'both',
      scaffoldSkills: resolvedType === 'both',
      semantic: rawOptions.semantic !== false,
      includeContentStubs: rawOptions.contentStubs !== false,
      autoFill: rawOptions.autoFill ?? false
    };

    if (!options.scaffoldDocs && !options.scaffoldAgents) {
      this.ui.displayWarning(this.t('warnings.scaffold.noneSelected'));
      return;
    }

    await this.ensurePaths(options);
    const skipOverwrites = await this.confirmOverwriteIfNeeded(options);

    this.ui.displayWelcome(this.version);
    this.ui.displayProjectInfo(options.repoPath, options.outputDir, resolvedType);

    const fileMapper = this.fileMapperFactory(options.exclude);

    this.ui.displayStep(1, 3, this.t('steps.init.analyze'));
    this.ui.startSpinner(this.t('spinner.repo.scanning'));

    const repoStructure = await fileMapper.mapRepository(options.repoPath, options.include);
    this.ui.updateSpinner(
      this.t('spinner.repo.scanComplete', {
        fileCount: repoStructure.totalFiles,
        directoryCount: repoStructure.directories.length
      }),
      'success'
    );

    const { docsGenerated, agentsGenerated, skillsGenerated, commandsGenerated } =
      await this.generateScaffolds(options, repoStructure, skipOverwrites);

    this.ui.displayGenerationSummary(docsGenerated, agentsGenerated, skillsGenerated, commandsGenerated);
    this.ui.displaySuccess(this.t('success.scaffold.ready', { path: colors.accent(options.outputDir) }));
  }

  private async confirmOverwriteIfNeeded(
    options: InitOptions
  ): Promise<{ skipDocs: boolean; skipAgents: boolean; skipSkills: boolean }> {
    const skipOverwrites = { skipDocs: false, skipAgents: false, skipSkills: false };

    if (options.scaffoldDocs) {
      const docsPath = path.join(options.outputDir, 'docs');
      if (await this.directoryHasContent(docsPath)) {
        const answer = await inquirer.prompt<{ overwrite: boolean }>([
          {
            type: 'confirm',
            name: 'overwrite',
            default: false,
            message: this.t('prompts.init.confirmOverwriteDocs', { path: docsPath })
          }
        ]);
        if (!answer.overwrite) skipOverwrites.skipDocs = true;
      }
    }

    if (options.scaffoldAgents) {
      const agentsPath = path.join(options.outputDir, 'agents');
      if (await this.directoryHasContent(agentsPath)) {
        const answer = await inquirer.prompt<{ overwrite: boolean }>([
          {
            type: 'confirm',
            name: 'overwrite',
            default: false,
            message: this.t('prompts.init.confirmOverwriteAgents', { path: agentsPath })
          }
        ]);
        if (!answer.overwrite) skipOverwrites.skipAgents = true;
      }
    }

    if (options.scaffoldSkills) {
      const skillsPath = path.join(options.outputDir, 'skills');
      if (await this.directoryHasContent(skillsPath)) {
        const answer = await inquirer.prompt<{ overwrite: boolean }>([
          {
            type: 'confirm',
            name: 'overwrite',
            default: false,
            message: this.t('prompts.init.confirmOverwriteSkills', { path: skillsPath })
          }
        ]);
        if (!answer.overwrite) skipOverwrites.skipSkills = true;
      }
    }

    return skipOverwrites;
  }

  private async directoryHasContent(dirPath: string): Promise<boolean> {
    const exists = await fs.pathExists(dirPath);
    if (!exists) {
      return false;
    }

    const entries = await fs.readdir(dirPath);
    return entries.length > 0;
  }

  private async generateScaffolds(
    options: InitOptions,
    repoStructure: RepoStructure,
    skipOverwrites: { skipDocs: boolean; skipAgents: boolean; skipSkills: boolean }
  ): Promise<{ docsGenerated: number; agentsGenerated: number; skillsGenerated: number; commandsGenerated: number }> {
    let docsGenerated = 0;
    let agentsGenerated = 0;
    let skillsGenerated = 0;
    let commandsGenerated = 0;
    let currentStep = 1;
    const totalSteps =
      (options.scaffoldDocs && !skipOverwrites.skipDocs ? 1 : 0) +
      (options.scaffoldAgents && !skipOverwrites.skipAgents ? 1 : 0) +
      (options.scaffoldSkills && !skipOverwrites.skipSkills ? 1 : 0) +
      1; // commands when docs or agents

    // Detect project type for filtering scaffolds
    let filteredDocs: string[] | undefined;
    let filteredAgents: string[] | undefined;
    try {
      const stackDetector = new StackDetector();
      const stackInfo = await stackDetector.detect(options.repoPath);
      const classification = classifyProject(stackInfo);
      const filtered = getFilteredScaffolds(classification.primaryType);
      filteredDocs = filtered.docs;
      filteredAgents = filtered.agents;
    } catch {
      // If classification fails, use all scaffolds (no filtering)
    }

    if (options.scaffoldDocs && !skipOverwrites.skipDocs) {
      this.ui.displayStep(currentStep, totalSteps, this.t('steps.init.docs'));
      this.ui.startSpinner(options.semantic
        ? this.t('spinner.docs.creatingWithSemantic')
        : this.t('spinner.docs.creating')
      );
      docsGenerated = await this.documentationGenerator.generateDocumentation(
        repoStructure,
        options.outputDir,
        {
          semantic: options.semantic,
          includeContentStubs: options.includeContentStubs,
          autoFill: options.autoFill,
          filteredDocs
        },
        options.verbose
      );
      this.ui.updateSpinner(this.t('spinner.docs.created', { count: docsGenerated }), 'success');
      currentStep++;
    }

    if (options.scaffoldAgents && !skipOverwrites.skipAgents) {
      this.ui.displayStep(currentStep, totalSteps, this.t('steps.init.agents'));
      this.ui.startSpinner(options.semantic
        ? this.t('spinner.agents.creatingWithSemantic')
        : this.t('spinner.agents.creating')
      );
      agentsGenerated = await this.agentGenerator.generateAgentPrompts(
        repoStructure,
        options.outputDir,
        {
          semantic: options.semantic,
          includeContentStubs: options.includeContentStubs,
          autoFill: options.autoFill,
          filteredAgents: filteredAgents as import('../../generators/agents/agentTypes').AgentType[] | undefined
        },
        options.verbose
      );
      this.ui.updateSpinner(this.t('spinner.agents.created', { count: agentsGenerated }), 'success');
      currentStep++;
    }

    if (options.scaffoldSkills && !skipOverwrites.skipSkills) {
      this.ui.displayStep(currentStep, totalSteps, this.t('steps.init.skills'));
      this.ui.startSpinner(this.t('spinner.skills.creating'));
      try {
        const relativeOutputDir = path.relative(options.repoPath, options.outputDir);
        const skillGenerator = new SkillGenerator({
          repoPath: options.repoPath,
          outputDir: relativeOutputDir || '.context',
        });
        const skillResult = await skillGenerator.generate({ force: true });
        skillsGenerated = skillResult.generatedSkills.length;
      } catch {
        // Skills generation is optional, continue if it fails
      }
      this.ui.updateSpinner(this.t('spinner.skills.created', { count: skillsGenerated }), 'success');
      currentStep++;
    }

    // Slash commands (e.g. init-mcp-only) for .cursor/commands and .agent/workflows
    if (options.scaffoldDocs || options.scaffoldAgents) {
      this.ui.displayStep(currentStep, totalSteps, this.t('steps.init.commands'));
      this.ui.startSpinner(this.t('spinner.commands.creating'));
      try {
        const result = await generateCommands(options.outputDir, { force: false });
        commandsGenerated = result.generated.length;
        this.ui.updateSpinner(this.t('spinner.commands.created', { count: commandsGenerated }), 'success');
      } catch {
        // Commands generation is optional
      }
    }

    return { docsGenerated, agentsGenerated, skillsGenerated, commandsGenerated };
  }

  private async ensurePaths(options: InitOptions): Promise<void> {
    const exists = await fs.pathExists(options.repoPath);
    if (!exists) {
      throw new Error(this.t('errors.common.repoMissing', { path: options.repoPath }));
    }

    await fs.ensureDir(options.outputDir);
  }
}

export function resolveScaffoldType(type: string, rawOptions: InitCommandFlags, t: TranslateFn): 'docs' | 'agents' | 'both' {
  const normalized = (type || 'both').toLowerCase();
  const allowed = ['docs', 'agents', 'both'];

  if (!allowed.includes(normalized)) {
    throw new Error(t('errors.init.invalidType', { value: type, allowed: allowed.join(', ') }));
  }

  if (rawOptions.docsOnly) {
    return 'docs';
  }
  if (rawOptions.agentsOnly) {
    return 'agents';
  }

  return normalized as 'docs' | 'agents' | 'both';
}
