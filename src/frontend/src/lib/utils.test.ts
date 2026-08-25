import { describe, it, expect } from 'vitest';
import { cn, getAgentBadgeLabel, getAgentBadgeColor, formatTokenCount, parseMessagePrefix } from './utils';

describe('cn', () => {
  it('merges class names and resolves tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', undefined, false, 'font-bold')).toBe('text-sm font-bold');
  });
});

describe('getAgentBadgeLabel', () => {
  it('labels a supervisor as SUP', () => {
    expect(getAgentBadgeLabel({ type: 'supervisor', role: undefined, permanent: false })).toBe('SUP');
  });

  it('labels a project supervisor as P-SUP, distinct from a plain supervisor', () => {
    expect(getAgentBadgeLabel({ type: 'supervisor', role: 'project-supervisor', permanent: false })).toBe('P-SUP');
  });

  it('labels a permanent non-supervisor agent as PERM', () => {
    expect(getAgentBadgeLabel({ type: 'worker', role: undefined, permanent: true })).toBe('PERM');
  });

  it('labels an ordinary worker as WRK', () => {
    expect(getAgentBadgeLabel({ type: 'worker', role: undefined, permanent: false })).toBe('WRK');
  });
});

describe('getAgentBadgeColor', () => {
  // P5.8 regression guard: each of these badges has no background fill (the
  // text sits directly on the page background), so it needs a shade that's
  // legible in BOTH themes via a dark: variant — a plain single-shade class
  // here would silently reintroduce the contrast bug that P5.8 fixed.
  it('always pairs a light-mode shade with an explicit dark: variant', () => {
    for (const label of ['SUP', 'P-SUP', 'PERM'] as const) {
      const classes = getAgentBadgeColor(label);
      expect(classes).toMatch(/\bdark:text-\w+-\d+\b/);
    }
  });

  it('gives WRK a neutral border with no color-coded text', () => {
    expect(getAgentBadgeColor('WRK')).toBe('border-muted');
  });
});

describe('formatTokenCount', () => {
  it('shows small counts as-is', () => {
    expect(formatTokenCount(842)).toBe('842');
  });

  it('abbreviates thousands with one decimal, dropping trailing .0', () => {
    expect(formatTokenCount(12_400)).toBe('12.4k');
    expect(formatTokenCount(5_000)).toBe('5k');
  });

  it('abbreviates millions', () => {
    expect(formatTokenCount(1_200_000)).toBe('1.2M');
  });
});

describe('parseMessagePrefix', () => {
  it('returns null for content with no known prefix', () => {
    expect(parseMessagePrefix('just a normal message')).toBeNull();
  });

  it('parses a known bracket tag and strips it from the remainder', () => {
    const result = parseMessagePrefix('[DONE] fixed the bug');
    expect(result).not.toBeNull();
    expect(result?.label).toBe('DONE');
    expect(result?.rest).toBe('fixed the bug');
  });

  it('handles leading whitespace before the tag', () => {
    const result = parseMessagePrefix('   [BLOCKED] waiting on review');
    expect(result?.label).toBe('BLOCKED');
    expect(result?.rest).toBe('waiting on review');
  });

  it('parses [photo] with no filename', () => {
    const result = parseMessagePrefix('[photo] see attached');
    expect(result?.label).toBe('PHOTO');
    expect(result?.photoFilename).toBeUndefined();
    expect(result?.rest).toBe('see attached');
  });

  it('parses [photo:filename] and extracts the filename', () => {
    const result = parseMessagePrefix('[photo:screenshot.png] look at this');
    expect(result?.label).toBe('PHOTO');
    expect(result?.photoFilename).toBe('screenshot.png');
    expect(result?.rest).toBe('look at this');
  });
});
