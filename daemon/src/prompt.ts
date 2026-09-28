export interface PromptInput {
  url: string;
  selector: string;
  html: string;
  instruction: string;
  component?: { name?: string | null; file?: string | null; line?: number | null } | null;
  stack?: string[] | null;
}

export const HTML_LIMIT = 1200;

export function compactHtml(html: string, limit = HTML_LIMIT): string {
  const compact = (html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/="(data:[^;,"]{0,40})[^"]*"/g, '="$1…"')
    .replace(/\s(d|points|style|srcset)="([^"]{80})[^"]*"/g, ' $1="$2…"')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

export function buildPrompt(input: PromptInput): string {
  const lines = [`Change the element \`${input.selector}\` on ${input.url}.`];
  const c = input.component;
  if (c?.name) lines.push(`Component: ${c.name}${c.file ? ` (${c.file}${c.line ? `:${c.line}` : ''})` : ''}`);
  if (input.stack?.length) lines.push(`Stack: ${input.stack.join(', ')}`);
  lines.push('```html', compactHtml(input.html), '```', `Task: ${input.instruction.trim()}`);
  return lines.join('\n');
}
