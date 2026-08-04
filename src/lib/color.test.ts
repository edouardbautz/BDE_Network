import { describe, expect, it } from 'vitest';
import { buildAccentStyle, getContrastingTextColor } from './color';

describe('getContrastingTextColor', () => {
  it('picks black text on a light color', () => {
    expect(getContrastingTextColor('#ffffff')).toBe('#000000');
    expect(getContrastingTextColor('#ffd700')).toBe('#000000');
  });

  it('picks white text on a dark color', () => {
    expect(getContrastingTextColor('#000000')).toBe('#ffffff');
    expect(getContrastingTextColor('#0f172a')).toBe('#ffffff');
  });

  it('handles 3-digit shorthand hex', () => {
    expect(getContrastingTextColor('#fff')).toBe('#000000');
    expect(getContrastingTextColor('#000')).toBe('#ffffff');
  });
});

describe('buildAccentStyle', () => {
  it('overrides the primary/ring/sidebar tokens with the given color', () => {
    const style = buildAccentStyle('#0f766e');
    expect(style['--primary']).toBe('#0f766e');
    expect(style['--ring']).toBe('#0f766e');
    expect(style['--sidebar-primary']).toBe('#0f766e');
    expect(style['--primary-foreground']).toBe('#ffffff');
  });
});
