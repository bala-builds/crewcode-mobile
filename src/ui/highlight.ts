// Tiny syntax tokenizer for the Code tab. No dependencies: a single regex pass
// per language, emitting (type, text) spans the stylesheet colors. This is a
// display aid only - it never changes the file content.

export type Tok = { t: 'kw' | 'str' | 'com' | 'num' | 'tag' | 'attr' | 'prop' | 'plain'; s: string };

const JS_KW = 'await|async|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|of|return|static|super|switch|this|throw|try|type|typeof|var|void|while|yield|true|false|null|undefined';

const JS_RE = new RegExp(
  [
    String.raw`(\/\*[\s\S]*?\*\/|\/\/[^\n]*)`, // 1 comment
    String.raw`('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\`(?:\\.|[^\`\\])*\`)`, // 2 string
    String.raw`\b(\d+(?:\.\d+)?)\b`, // 3 number
    String.raw`\b(${JS_KW})\b`, // 4 keyword
  ].join('|'),
  'g',
);

const HTML_RE = new RegExp(
  [
    String.raw`(<!--[\s\S]*?-->)`, // 1 comment
    String.raw`(<\/?[a-zA-Z][\w-]*)`, // 2 tag open
    String.raw`(\/?>)`, // 3 tag close
    String.raw`([a-zA-Z-]+)(=)("(?:[^"]*)"|'(?:[^']*)')`, // 4 attr, 5 eq, 6 value
  ].join('|'),
  'g',
);

const CSS_RE = new RegExp(
  [
    String.raw`(\/\*[\s\S]*?\*\/)`, // 1 comment
    String.raw`('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")`, // 2 string
    String.raw`([a-zA-Z-]+)(?:\s*:)`, // 3 property (colon non-capturing)
    String.raw`\b(\d+(?:\.\d+)?(?:px|rem|em|%|s|ms)?)\b`, // 4 number
  ].join('|'),
  'g',
);

function run(code: string, re: RegExp, map: (m: RegExpExecArray) => Tok[]): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(code)) && guard++ < 20000) {
    if (m.index > last) out.push({ t: 'plain', s: code.slice(last, m.index) });
    out.push(...map(m));
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // never loop on a zero-width hit
  }
  if (last < code.length) out.push({ t: 'plain', s: code.slice(last) });
  return out;
}

export function highlight(code: string, path: string): Tok[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html' || ext === 'htm' || ext === 'svg') {
    return run(code, HTML_RE, (m) => {
      if (m[1]) return [{ t: 'com', s: m[1] }];
      if (m[2]) return [{ t: 'tag', s: m[2] }];
      if (m[3]) return [{ t: 'tag', s: m[3] }];
      return [{ t: 'attr', s: m[4] }, { t: 'plain', s: m[5] }, { t: 'str', s: m[6] }];
    });
  }
  if (ext === 'css') {
    return run(code, CSS_RE, (m) => {
      if (m[1]) return [{ t: 'com', s: m[1] }];
      if (m[2]) return [{ t: 'str', s: m[2] }];
      if (m[3]) return [{ t: 'prop', s: m[3] }, { t: 'plain', s: m[0].slice(m[3].length) }];
      return [{ t: 'num', s: m[4] }];
    });
  }
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'mjs', 'cjs'].includes(ext)) {
    return run(code, JS_RE, (m) => {
      if (m[1]) return [{ t: 'com', s: m[1] }];
      if (m[2]) return [{ t: 'str', s: m[2] }];
      if (m[3]) return [{ t: 'num', s: m[3] }];
      return [{ t: 'kw', s: m[4] }];
    });
  }
  return [{ t: 'plain', s: code }];
}
