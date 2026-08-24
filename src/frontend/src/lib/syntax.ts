import type { BundledLanguage } from 'shiki/bundle/web';

/**
 * Shared language detection for shiki syntax highlighting. Extracted from
 * MarkdownContent (P0.2) so the file CodeViewer (P3.1) uses the exact same
 * supported-language set and fence-tag alias table — one source of truth.
 */

// Languages available in shiki/bundle/web — curated subset for common web/dev use
export const SUPPORTED_LANGS = new Set<string>([
  'javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx',
  'python', 'py', 'bash', 'sh', 'shell', 'shellscript', 'zsh',
  'json', 'json5', 'jsonc', 'yaml', 'yml', 'css', 'html', 'xml',
  'sql', 'c', 'cpp', 'c++', 'java', 'markdown', 'md', 'mdx',
  'less', 'scss', 'sass', 'svelte', 'vue', 'php',
  'graphql', 'gql', 'http', 'hurl', 'julia', 'jl', 'r',
]);

const FENCE_ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'yaml', rb: 'ruby', md: 'markdown',
};

/** Resolve a markdown fence-tag language (e.g. "```py") to a shiki language id. */
export function normalizeLanguage(lang: string | undefined): BundledLanguage | null {
  if (!lang) return null;
  const l = lang.toLowerCase().replace('language-', '');
  const resolved = FENCE_ALIASES[l] || l;
  return SUPPORTED_LANGS.has(l) || SUPPORTED_LANGS.has(resolved)
    ? (resolved as BundledLanguage)
    : null;
}

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', tsx: 'tsx',
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml',
  css: 'css', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  java: 'java', md: 'markdown', mdx: 'mdx',
  less: 'less', scss: 'scss', sass: 'sass', svelte: 'svelte',
  vue: 'vue', php: 'php', graphql: 'graphql', gql: 'graphql',
  r: 'r', jl: 'julia', toml: 'yaml', // toml has no bundled grammar; yaml is close enough
};

/** Resolve a filename's extension to a shiki language id, if supported. */
export function languageFromFilename(name: string): BundledLanguage | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  const lang = EXT_TO_LANG[ext];
  return lang && SUPPORTED_LANGS.has(lang) ? (lang as BundledLanguage) : null;
}
