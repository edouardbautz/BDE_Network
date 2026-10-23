import { describe, expect, it } from 'vitest';
import { documentsOf } from './templates';

const HTML = '<!doctype html>\n<html><body><p>Bonjour</p></body>\n</html>';

describe('the e-mail documents in the answer of an action', () => {
  it('finds one that travels raw, as a text row', () => {
    const body = `0:{"a":"$@1"}\n2:T40,${HTML}\n1:{"ok":true,"preview":"$2"}\n`;
    expect(documentsOf(body)).toEqual([HTML]);
  });

  it('finds one that travels as the JSON string of a row, and decodes it', () => {
    const body = `0:{"a":"$@1"}\n1:${JSON.stringify({ ok: true, preview: { mail: { html: HTML } } })}\n`;
    expect(documentsOf(body)).toEqual([HTML]);
  });

  it('finds none in an answer that holds only codes', () => {
    expect(documentsOf('1:{"ok":false,"code":"invalid"}\n')).toEqual([]);
  });
});
