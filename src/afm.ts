import { AfmParseError, columnOf } from "./errors";

/** A single glyph's metrics, as read from a "C ... ; WX ... ; N ... ;" line. */
export interface CharacterMetric {
  /** The character's code in the font's built-in encoding, or -1 if unencoded. */
  code: number;
  /** Advance width in glyph space units (see FontMetrics.unitsPerEm). */
  width: number;
  /** PostScript glyph name, e.g. "space", "A", "aacute". */
  name: string;
}

/** The parsed contents of an AFM file, covering the fields most layout code needs. */
export interface FontMetrics {
  fontName: string;
  fullName?: string;
  familyName?: string;
  weight?: string;
  italicAngle: number;
  isFixedPitch: boolean;
  fontBBox: [number, number, number, number];
  underlinePosition?: number;
  underlineThickness?: number;
  capHeight?: number;
  xHeight?: number;
  ascender?: number;
  descender?: number;
  /** AFM glyph-space coordinates are always expressed per 1000 units. */
  unitsPerEm: number;
  characters: CharacterMetric[];
}

/** Fast lookup structure built from a parsed FontMetrics's character list. */
export interface WidthIndex {
  byCode: Map<number, CharacterMetric>;
  byName: Map<string, CharacterMetric>;
}

export function buildWidthIndex(metrics: FontMetrics): WidthIndex {
  const byCode = new Map<number, CharacterMetric>();
  const byName = new Map<string, CharacterMetric>();
  for (const char of metrics.characters) {
    if (char.code >= 0) {
      byCode.set(char.code, char);
    }
    byName.set(char.name, char);
  }
  return { byCode, byName };
}

interface LineContext {
  raw: string;
  content: string;
  leading: number;
  number: number;
}

function lineContext(raw: string, lineNumber: number): LineContext {
  const content = raw.trim();
  const leading = raw.length - raw.replace(/^\s+/, "").length;
  return { raw, content, leading, number: lineNumber };
}

function splitKeyValue(content: string): { key: string; value: string } {
  const spaceIndex = content.indexOf(" ");
  if (spaceIndex === -1) {
    return { key: content, value: "" };
  }
  return { key: content.slice(0, spaceIndex), value: content.slice(spaceIndex + 1).trim() };
}

function requireNumber(ctx: LineContext, key: string, value: string): number {
  const parsed = Number(value);
  if (value.length === 0 || !Number.isFinite(parsed)) {
    const column = columnOf(ctx.raw, ctx.content, ctx.leading, value.length > 0 ? value : key);
    throw new AfmParseError(`expected a number for "${key}", found "${value || "(nothing)"}"`, ctx.number, column, ctx.raw);
  }
  return parsed;
}

function parseBBox(ctx: LineContext, value: string): [number, number, number, number] {
  const parts = value.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length !== 4) {
    const column = columnOf(ctx.raw, ctx.content, ctx.leading, value);
    throw new AfmParseError(`expected 4 numbers for "FontBBox", found ${parts.length}`, ctx.number, column, ctx.raw);
  }
  const numbers: number[] = [];
  let searchFrom = ctx.content.indexOf(value);
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) {
      const column = columnOf(ctx.raw, ctx.content, ctx.leading, part, Math.max(0, searchFrom));
      throw new AfmParseError(`expected a number in "FontBBox", found "${part}"`, ctx.number, column, ctx.raw);
    }
    numbers.push(n);
    searchFrom = ctx.content.indexOf(part, searchFrom) + part.length;
  }
  return numbers as [number, number, number, number];
}

function parseCharMetricsLine(ctx: LineContext): CharacterMetric {
  const fields = ctx.content.split(";").map((f) => f.trim()).filter((f) => f.length > 0);

  let code: number | undefined;
  let width: number | undefined;
  let name: string | undefined;
  let searchFrom = 0;

  for (const field of fields) {
    const fieldStart = ctx.content.indexOf(field, searchFrom);
    searchFrom = fieldStart + field.length;
    const { key, value } = splitKeyValue(field);

    switch (key) {
      case "C": {
        const n = Number(value);
        if (value.length === 0 || !Number.isInteger(n)) {
          const column = columnOf(ctx.raw, ctx.content, ctx.leading, value || key, fieldStart);
          throw new AfmParseError(`expected an integer character code after "C", found "${value || "(nothing)"}"`, ctx.number, column, ctx.raw);
        }
        code = n;
        break;
      }
      case "WX": {
        const n = Number(value);
        if (value.length === 0 || !Number.isFinite(n)) {
          const column = columnOf(ctx.raw, ctx.content, ctx.leading, value || key, fieldStart);
          throw new AfmParseError(`expected a number after "WX", found "${value || "(nothing)"}"`, ctx.number, column, ctx.raw);
        }
        width = n;
        break;
      }
      case "N": {
        if (value.length === 0) {
          const column = columnOf(ctx.raw, ctx.content, ctx.leading, key, fieldStart);
          throw new AfmParseError('expected a glyph name after "N"', ctx.number, column, ctx.raw);
        }
        name = value;
        break;
      }
      default:
        // B (bbox), L (ligature), and vendor extensions aren't needed for
        // width lookups, so they're accepted but not recorded.
        break;
    }
  }

  if (width === undefined) {
    throw new AfmParseError('character metric line is missing a "WX" (width) field', ctx.number, ctx.leading + 1, ctx.raw);
  }
  if (name === undefined) {
    throw new AfmParseError('character metric line is missing an "N" (glyph name) field', ctx.number, ctx.leading + 1, ctx.raw);
  }

  return { code: code ?? -1, width, name };
}

/**
 * Parses the text of an AFM (Adobe Font Metrics) file into structured
 * metrics. Throws AfmParseError, with a line and column pointing at the
 * exact field that didn't match the grammar, if the document is malformed.
 */
export function parseAfm(source: string): FontMetrics {
  const lines = source.split(/\r\n|\r|\n/);

  let sawStart = false;
  let inCharMetrics = false;
  let fontName: string | undefined;
  let fullName: string | undefined;
  let familyName: string | undefined;
  let weight: string | undefined;
  let italicAngle = 0;
  let isFixedPitch = false;
  let fontBBox: [number, number, number, number] | undefined;
  let underlinePosition: number | undefined;
  let underlineThickness: number | undefined;
  let capHeight: number | undefined;
  let xHeight: number | undefined;
  let ascender: number | undefined;
  let descender: number | undefined;
  const characters: CharacterMetric[] = [];

  for (let i = 0; i < lines.length; i++) {
    const ctx = lineContext(lines[i] ?? "", i + 1);
    if (ctx.content.length === 0 || ctx.content.startsWith("Comment")) {
      continue;
    }

    if (inCharMetrics) {
      if (ctx.content === "EndCharMetrics") {
        inCharMetrics = false;
        continue;
      }
      characters.push(parseCharMetricsLine(ctx));
      continue;
    }

    const { key, value } = splitKeyValue(ctx.content);
    switch (key) {
      case "StartFontMetrics":
        sawStart = true;
        break;
      case "FontName":
        fontName = value;
        break;
      case "FullName":
        fullName = value;
        break;
      case "FamilyName":
        familyName = value;
        break;
      case "Weight":
        weight = value;
        break;
      case "ItalicAngle":
        italicAngle = requireNumber(ctx, key, value);
        break;
      case "IsFixedPitch":
        isFixedPitch = value === "true";
        break;
      case "FontBBox":
        fontBBox = parseBBox(ctx, value);
        break;
      case "UnderlinePosition":
        underlinePosition = requireNumber(ctx, key, value);
        break;
      case "UnderlineThickness":
        underlineThickness = requireNumber(ctx, key, value);
        break;
      case "CapHeight":
        capHeight = requireNumber(ctx, key, value);
        break;
      case "XHeight":
        xHeight = requireNumber(ctx, key, value);
        break;
      case "Ascender":
        ascender = requireNumber(ctx, key, value);
        break;
      case "Descender":
        descender = requireNumber(ctx, key, value);
        break;
      case "StartCharMetrics":
        inCharMetrics = true;
        break;
      default:
        // Kerning data, composite-character data, and anything else the
        // spec allows but this library doesn't model yet is skipped.
        break;
    }
  }

  if (!sawStart) {
    throw new AfmParseError('file does not start with "StartFontMetrics"', 1, 1, lines[0] ?? "");
  }
  if (fontName === undefined) {
    throw new AfmParseError('missing required "FontName" entry', lines.length, 1, "");
  }
  if (fontBBox === undefined) {
    throw new AfmParseError('missing required "FontBBox" entry', lines.length, 1, "");
  }

  const metrics: FontMetrics = {
    fontName,
    italicAngle,
    isFixedPitch,
    fontBBox,
    unitsPerEm: 1000,
    characters,
  };
  if (fullName !== undefined) metrics.fullName = fullName;
  if (familyName !== undefined) metrics.familyName = familyName;
  if (weight !== undefined) metrics.weight = weight;
  if (underlinePosition !== undefined) metrics.underlinePosition = underlinePosition;
  if (underlineThickness !== undefined) metrics.underlineThickness = underlineThickness;
  if (capHeight !== undefined) metrics.capHeight = capHeight;
  if (xHeight !== undefined) metrics.xHeight = xHeight;
  if (ascender !== undefined) metrics.ascender = ascender;
  if (descender !== undefined) metrics.descender = descender;
  return metrics;
}
