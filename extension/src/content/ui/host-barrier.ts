const BARRIER: Record<string, string> = {
  all: 'initial',
  direction: 'ltr',
  'unicode-bidi': 'isolate',
  'color-scheme': 'dark',
};

export function applyHostBarrier(host: HTMLElement, extra: Record<string, string>): void {
  for (const [prop, value] of Object.entries({ ...BARRIER, ...extra })) {
    host.style.setProperty(prop, value, 'important');
  }
}
