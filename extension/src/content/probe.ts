import { componentHint, pageInfo } from './detect.js';

export const ASK = 'dev-in-situ:ask';
export const ANSWER = 'dev-in-situ:answer';
export const MARK = 'data-dev-in-situ-target';

export function installProbe(win: Window = window): void {
  const doc = win.document;
  doc.addEventListener(ASK, (event) => {
    const kind = (event as CustomEvent<string>).detail;
    let result: unknown = null;
    if (kind === 'page') result = pageInfo(win);
    if (kind === 'component') {
      const el = doc.querySelector(`[${MARK}]`);
      result = el ? componentHint(el) : null;
    }
    doc.dispatchEvent(new CustomEvent(ANSWER, { detail: JSON.stringify(result) }));
  });
}

export function ask<T>(kind: 'page' | 'component', target?: Element, doc: Document = document): T | null {
  let answer: string | null = null;
  const listen = (event: Event) => {
    answer = (event as CustomEvent<string>).detail;
  };
  doc.addEventListener(ANSWER, listen);
  target?.setAttribute(MARK, '');
  try {
    doc.dispatchEvent(new CustomEvent(ASK, { detail: kind }));
  } finally {
    target?.removeAttribute(MARK);
    doc.removeEventListener(ANSWER, listen);
  }
  try {
    return answer ? (JSON.parse(answer) as T) : null;
  } catch {
    return null;
  }
}
