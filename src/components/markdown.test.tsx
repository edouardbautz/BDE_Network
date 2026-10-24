// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('Markdown', () => {
  it('draws what a description says', () => {
    const { container } = render(
      <Markdown
        source={
          '## Soirée\n\nViens **jouer**\navec nous\n\n- a\n- b\n\n[le site](https://example.org)'
        }
      />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('Soirée');
    expect(container.querySelector('strong')?.textContent).toBe('jouer');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.org/');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('builds no element from what is typed: no script, no handler, no picture, no javascript address', () => {
    const { container } = render(
      <Markdown
        source={
          '<script>window.x=1</script>\n<img src=x onerror="window.x=1">\n![p](https://evil.example/p.png)\n[a](javascript:alert(1))\n<a href="javascript:alert(1)">b</a>'
        }
      />,
    );
    expect(container.querySelector('script, img, iframe, form, style')).toBeNull();
    expect(container.querySelector('[onerror], [onclick]')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    // what was typed stays visible, as text
    expect(container.textContent).toContain('<script>window.x=1</script>');
  });
});
