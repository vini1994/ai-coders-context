/**
 * Predefined slash-command templates for .context/commands.
 * Cursor: .cursor/commands (filename → /command-name).
 * Agent: .agent/workflows (same markdown, no frontmatter).
 */

export interface CommandTemplate {
  /** Filename (kebab-case), e.g. init-mcp-only.md */
  filename: string;
  /** Markdown body (no frontmatter for Cursor compatibility) */
  content: string;
}

export const PREDEFINED_COMMANDS: CommandTemplate[] = [
  {
    filename: 'init-mcp-only.md',
    content: `# Init context (MCP only)

Initialize the project context **only via MCP** — do not run init from the CLI.

Use the context tool with action \`init\` in your MCP-enabled client (e.g. Cursor, Claude). Suggested parameters:

- **type**: \`both\` (docs + agents)
- **semantic**: \`true\`
- **autoFill**: \`true\`
- **generateSkills**: \`true\`

This ensures the scaffolding is created and filled using the MCP server attached to this repo.`,
  },
];
