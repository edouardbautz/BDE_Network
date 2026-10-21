import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO, logoSource } from './image-source';

describe('logoSource', () => {
  it('is the preview of a file just chosen, then the logo in use', () => {
    expect(logoSource('blob:http://localhost/abc', '/api/logo?v=0123456789abcdef')).toBe(
      'blob:http://localhost/abc',
    );
    expect(logoSource(null, '/api/logo?v=0123456789abcdef')).toBe('/api/logo?v=0123456789abcdef');
    expect(logoSource(null, '/logo.svg')).toBe('/logo.svg');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/x.png',
    'https://evil.example/x.png',
    '',
  ])('never uses %s, as the preview or as the path of the logo', (address) => {
    expect(logoSource(address, '/api/logo?v=0123456789abcdef')).toBe(
      '/api/logo?v=0123456789abcdef',
    );
    expect(logoSource(null, address)).toBe(DEFAULT_LOGO);
    expect(logoSource(address, address)).toBe(DEFAULT_LOGO);
  });
});
