export interface PromptTarget {
  selector: string;
  html: string;
  component?: { name?: string | null; file?: string | null; line?: number | null } | null;
}

export interface PromptInput extends PromptTarget {
  url: string;
  instruction: string;
  stack?: string[] | null;
  targets?: PromptTarget[] | null;
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

function describeComponent(c: PromptTarget['component']): string | null {
  if (!c?.name) return null;
  return `${c.name}${c.file ? ` (${c.file}${c.line ? `:${c.line}` : ''})` : ''}`;
}

export function buildPrompt(input: PromptInput): string {
  const targets = input.targets?.length ? input.targets : [input];
  if (targets.length === 1) {
    const t = targets[0]!;
    const lines = [`Change the element \`${t.selector}\` on ${input.url}.`];
    const component = describeComponent(t.component);
    if (component) lines.push(`Component: ${component}`);
    if (input.stack?.length) lines.push(`Stack: ${input.stack.join(', ')}`);
    lines.push('```html', compactHtml(t.html), '```', `Task: ${input.instruction.trim()}`);
    return lines.join('\n');
  }
  const lines = [`Change these ${targets.length} elements on ${input.url}.`];
  if (input.stack?.length) lines.push(`Stack: ${input.stack.join(', ')}`);
  targets.forEach((t, i) => {
    const component = describeComponent(t.component);
    lines.push(`${i + 1}. \`${t.selector}\`${component ? ` (component: ${component})` : ''}`, '```html', compactHtml(t.html), '```');
  });
  lines.push(`Task: ${input.instruction.trim()}`);
  return lines.join('\n');
}
