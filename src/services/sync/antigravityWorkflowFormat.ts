/**
 * Transform slash-command markdown into Google Antigravity workflow format.
 *
 * @see https://antigravity.google/docs/rules-workflows
 * - Workflows require YAML frontmatter with `description` (max 250 chars).
 * - File naming: lowercase with underscores (e.g. init_mcp_only.md).
 * - Invocation: /workflow-name (filename without .md).
 */

const DESCRIPTION_MAX_LENGTH = 250;

/**
 * Convert kebab-case filename to Antigravity convention: lowercase with underscores.
 * e.g. init-mcp-only.md → init_mcp_only.md
 */
export function toAntigravityFilename(filename: string): string {
  const base = filename.replace(/\.md$/i, '');
  const withUnderscores = base.replace(/-/g, '_').toLowerCase();
  return `${withUnderscores}.md`;
}

/**
 * Derive a short description from markdown content (first heading or first line).
 * Truncates to DESCRIPTION_MAX_LENGTH.
 */
function deriveDescription(content: string): string {
  const trimmed = content.trim();
  const headingMatch = trimmed.match(/^#\s+(.+?)(?:\n|$)/m);
  const firstLine = headingMatch
    ? headingMatch[1].trim()
    : trimmed.split(/\n/)[0]?.trim() || 'Workflow';
  const cleaned = firstLine.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= DESCRIPTION_MAX_LENGTH) return cleaned;
  return cleaned.slice(0, DESCRIPTION_MAX_LENGTH - 3) + '...';
}

/**
 * Ensure body has numbered steps if it's plain prose (Antigravity expects steps).
 * If content already has numbered list (1. 2. 3.), leaves as-is.
 * Otherwise wraps the body in a single step so the workflow is valid.
 */
function ensureSteps(body: string): string {
  const trimmed = body.trim();
  if (/^\d+\.\s+/m.test(trimmed)) return trimmed;
  return `1. ${trimmed.split(/\n/).join('\n   ')}`;
}

/**
 * Transform command markdown into Antigravity workflow format:
 * - Prepends YAML frontmatter with description (required, max 250 chars).
 * - Optionally normalizes body to numbered steps.
 */
export function toAntigravityWorkflowContent(
  content: string,
  options?: { description?: string; ensureSteps?: boolean }
): string {
  const description =
    (options?.description && options.description.length <= DESCRIPTION_MAX_LENGTH
      ? options.description
      : undefined) || deriveDescription(content);
  const finalDescription =
    description.length > DESCRIPTION_MAX_LENGTH
      ? description.slice(0, DESCRIPTION_MAX_LENGTH - 3) + '...'
      : description;

  const frontmatter = `---
description: ${finalDescription.replace(/\n/g, ' ')}
---
`;

  const body = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
  const bodyWithSteps = options?.ensureSteps !== false ? ensureSteps(body) : body;

  return frontmatter + '\n' + bodyWithSteps + '\n';
}
