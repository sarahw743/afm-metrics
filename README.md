# afm-metrics

A parser for Adobe Font Metrics (AFM) files.

## Why

If you're laying out text yourself — wrapping lines, justifying paragraphs,
generating a PDF — you need to know how wide each glyph is before you draw
it. Loading the actual font program (TTF/OTF) just to read advance widths is
overkill, and most PostScript fonts ship (or can be exported with) an AFM
file: a plain text sidecar listing exactly that, one line per glyph:

```
StartFontMetrics 4.1
FontName Helvetica
FullName Helvetica
FamilyName Helvetica
Weight Medium
ItalicAngle 0
IsFixedPitch false
FontBBox -166 -225 1000 931
UnderlinePosition -100
UnderlineThickness 50
CapHeight 718
XHeight 523
Ascender 718
Descender -207
StartCharMetrics 3
C 32 ; WX 278 ; N space ;
C 65 ; WX 667 ; N A ;
C 97 ; WX 556 ; N a ;
EndCharMetrics
EndFontMetrics
```

AFM is a forgiving, hand-editable format, which also means it's easy to
introduce a typo — a missing `;`, a width that got pasted in as `WX -` with
nothing after it, a `FontBBox` with three numbers instead of four. Most
parsers for this kind of thing report "invalid character metrics line" and
leave you to find it yourself in a file with a few thousand lines. This one
reports exactly where the problem is.

## Usage

```typescript
import { readFileSync } from "node:fs";
import { parseAfm, buildWidthIndex, measureText, AfmParseError } from "afm-metrics";

const source = readFileSync("Helvetica.afm", "utf8");

try {
  const metrics = parseAfm(source);
  const widths = buildWidthIndex(metrics);

  const glyph = widths.byName.get("A");
  console.log(glyph?.width); // 667, in 1000-unit glyph space

  // Render at 12pt: width in points = (glyphWidth / unitsPerEm) * fontSize
  const pointWidth = (glyph!.width / metrics.unitsPerEm) * 12;

  // Or measure a whole string at once, with kerning applied:
  const width = measureText("AVA", widths, { kerningPairs: metrics.kerningPairs });
} catch (error) {
  if (error instanceof AfmParseError) {
    console.error(error.message);
    console.error(`failed at line ${error.line}, column ${error.column}`);
  }
  throw error;
}
```

Given a broken line like this (a stray `-` where a width should be):

```
C 97 ; WX - ; N a ;
```

`parseAfm` throws with:

```
expected a number after "WX", found "-" (line 18, column 11)

  C 97 ; WX - ; N a ;
            ^
```

## API

- `parseAfm(source: string): FontMetrics` — parses a full AFM document.
  Throws `AfmParseError` on malformed input.
- `buildWidthIndex(metrics: FontMetrics): WidthIndex` — builds `Map`s for
  looking glyphs up by character code or by PostScript name.
- `measureText(text: string, index: WidthIndex, options?: MeasureOptions): number`
  — sums glyph widths for a string, in the same glyph-space units as
  `CharacterMetric.width`. Looks glyphs up by Unicode code point against the
  AFM character code, so it works directly for ASCII text under
  StandardEncoding/WinAnsiEncoding fonts. Pass `options.kerningPairs` (e.g.
  `metrics.kerningPairs`) to apply kerning between adjacent glyphs, and
  `options.fallbackWidth` to control the width used for characters the font
  doesn't have (default `0`).
- `AfmParseError` — thrown by `parseAfm`. Has `message`, `line`, `column`,
  and `sourceLine` properties in addition to the usual `Error` fields.

`FontMetrics` covers the font-level fields (`fontName`, `fontBBox`,
`capHeight`, `ascender`, `descender`, ...) plus a `characters` array of
`{ code, width, name }` entries — one per glyph the AFM file describes — and
a `kerningPairs` array of `{ first, second, adjustment }` entries parsed from
the file's `StartKernData`/`KPX` section, if it has one.

## Scope

This library only reads the text-based AFM format. It doesn't parse TTF,
OTF, or any binary font program, and it doesn't do any rendering or layout
of its own — it hands you the numbers so you can do that part.

## Install

Not published yet. Copy `src/` into your project or add this repo as a git
dependency until it lands on npm.

## License

MIT
