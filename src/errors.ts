/**
 * Raised whenever an AFM document does not match the grammar the parser
 * expects. The point of this type is the location info: `line`/`column`
 * are 1-based, matching what a text editor shows, so a caller can jump
 * straight to the offending byte instead of grepping the file by hand.
 */
export class AfmParseError extends Error {
  readonly line: number;
  readonly column: number;
  readonly sourceLine: string;

  constructor(reason: string, line: number, column: number, sourceLine: string) {
    super(formatMessage(reason, line, column, sourceLine));
    this.name = "AfmParseError";
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
  }
}

function formatMessage(reason: string, line: number, column: number, sourceLine: string): string {
  const location = `line ${line}, column ${column}`;
  if (sourceLine.length === 0) {
    return `${reason} (${location})`;
  }
  const caret = " ".repeat(Math.max(0, column - 1)) + "^";
  return `${reason} (${location})\n\n  ${sourceLine}\n  ${caret}\n`;
}

/**
 * Finds where `needle` sits inside `content` (which has already had its
 * surrounding whitespace trimmed off `rawLine`) and converts that into a
 * 1-based column within `rawLine` itself. `searchFrom` lets callers avoid
 * matching an earlier, unrelated occurrence of the same text on one line.
 */
export function columnOf(rawLine: string, content: string, leadingWhitespace: number, needle: string, searchFrom = 0): number {
  const index = content.indexOf(needle, searchFrom);
  if (index === -1) {
    return leadingWhitespace + 1;
  }
  return leadingWhitespace + index + 1;
}
