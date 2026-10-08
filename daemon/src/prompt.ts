export interface ComponentInfo {
  name?: string | null;
  file?: string | null;
  line?: number | null;
}

export interface PromptTarget {
  selector: string;
  html: string;
  component?: ComponentInfo | null;
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

function describeComponent(c: ComponentInfo | null | undefined): string | null {
  if (!c?.name) return null;
  return `${c.name}${c.file ? ` (${c.file}${c.line ? `:${c.line}` : ''})` : ''}`;
}

export function buildPrompt(input: PromptInput): string {
  const targets = input.targets?.length ? input.targets : [input];
  const lines = targets.length === 1 ? describeSingle(input.url, targets[0]!, input.stack) : describeGroup(input.url, targets, input.stack);
  lines.push(`Task: ${input.instruction.trim()}`);
  return lines.join('\n');
}

function describeSingle(url: string, target: PromptTarget, stack: PromptInput['stack']): string[] {
  const component = describeComponent(target.component);
  return [
    `Change the element \`${target.selector}\` on ${url}.`,
    ...(component ? [`Component: ${component}`] : []),
    ...stackLine(stack),
    ...htmlBlock(target.html),
  ];
}

function describeGroup(url: string, targets: PromptTarget[], stack: PromptInput['stack']): string[] {
  return [
    `Change these ${targets.length} elements on ${url}.`,
    ...stackLine(stack),
    ...targets.flatMap((t, i) => {
      const component = describeComponent(t.component);
      return [`${i + 1}. \`${t.selector}\`${component ? ` (component: ${component})` : ''}`, ...htmlBlock(t.html)];
    }),
  ];
}

const stackLine = (stack: PromptInput['stack']): string[] => (stack?.length ? [`Stack: ${stack.join(', ')}`] : []);
const htmlBlock = (html: string): string[] => ['```html', compactHtml(html), '```'];
