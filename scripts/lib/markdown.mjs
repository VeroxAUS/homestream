/**
 * Fenced code block scanning with the CommonMark rules: a fence is three or more backticks or tildes, and it is
 * closed only by a line of the same character, at least as long as the opener, with nothing but whitespace after it.
 * So a four-backtick block can contain a three-backtick line, and "```n" never closes anything.
 */

const OPENER = /^\s*(`{3,}|~{3,})(.*)$/;
const CLOSER = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * Every line of the document with its 1-based number and kind: `prose`, `open` (the opening fence), `code` (inside a
 * fence, with its info string as `lang`) or `close`. `unclosed` is the line of a fence still open at the end.
 * Leading whitespace is not limited to three spaces, so fences nested in list items are recognised.
 */
export function scanFences(markdown) {
  const lines = [];
  let open = null;
  markdown.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const text = raw.replace(/\r$/, '');
    if (open) {
      const closer = CLOSER.exec(text);
      if (closer && closer[1][0] === open.char && closer[1].length >= open.length) {
        lines.push({ line, text, kind: 'close' });
        open = null;
      } else {
        lines.push({ line, text, kind: 'code', lang: open.lang });
      }
      return;
    }
    const opener = OPENER.exec(text);
    // An info string of a backtick fence cannot contain a backtick, otherwise this is an inline code span.
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      open = { char: opener[1][0], length: opener[1].length, lang: opener[2].trim().split(/\s+/)[0] ?? '', line };
      lines.push({ line, text, kind: 'open', lang: open.lang });
      return;
    }
    lines.push({ line, text, kind: 'prose' });
  });
  return { lines, unclosed: open ? open.line : null };
}

/** `file:<line>: unclosed code fence` when the document ends inside a fence, else an empty list. */
export function fenceProblems(file, markdown) {
  const { unclosed } = scanFences(markdown);
  return unclosed === null ? [] : [`${file}:${unclosed}: unclosed code fence`];
}

/** The body of each fenced block as `{lang, line, lines}`; `line` is the first body line and `lines` keeps the text. */
export function fencedBlocks(markdown) {
  const blocks = [];
  let current = null;
  for (const entry of scanFences(markdown).lines) {
    if (entry.kind === 'open') current = { lang: entry.lang, line: entry.line + 1, lines: [] };
    else if (entry.kind === 'code') current?.lines.push(entry.text);
    else if (entry.kind === 'close' && current) {
      blocks.push(current);
      current = null;
    }
  }
  return blocks;
}
