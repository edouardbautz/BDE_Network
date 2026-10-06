// @vitest-environment node
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AbortedError, createTerminalReader, InputClosedError, Prompts } from './prompts';
import { scriptedReader } from './test-helpers';
import { validateColor, validateName } from './validate';

describe('Prompts.ask', () => {
  it('returns the validated value of the first valid answer', async () => {
    const reader = scriptedReader(['BDE Lynx']);
    await expect(new Prompts(reader).ask('Nom', validateName)).resolves.toBe('BDE Lynx');
  });

  it('says what is wrong, in the chosen language, and asks again until the answer is valid', async () => {
    const reader = scriptedReader(['red', '#12', 'ABC']);
    const prompts = new Prompts(reader);
    prompts.setLanguage('en');

    await expect(prompts.ask('Colour', validateColor)).resolves.toBe('#aabbcc');

    const text = reader.transcript();
    expect(text.match(/✗ A hexadecimal colour is expected/g)).toHaveLength(2);
    expect(text.match(/Colour: /g)).toHaveLength(3);
  });

  it('explains in French by default', async () => {
    const reader = scriptedReader(['', 'ok']);
    await new Prompts(reader).ask('Nom', validateName);
    expect(reader.transcript()).toContain('✗ Le nom doit faire entre 1 et 60 caractères');
  });

  it('takes the default when the answer is empty, and shows it in brackets', async () => {
    const reader = scriptedReader(['']);
    await expect(
      new Prompts(reader).ask('Couleur', validateColor, { default: '#0f766e' }),
    ).resolves.toBe('#0f766e');
    expect(reader.transcript()).toContain('Couleur [#0f766e]: ');
  });

  it('validates the default too, so a bad saved value is not accepted silently', async () => {
    const reader = scriptedReader(['', '#fff']);
    await expect(
      new Prompts(reader).ask('Couleur', validateColor, { default: 'nope' }),
    ).resolves.toBe('#ffffff');
  });

  it('asks for a secret without ever showing it or its default', async () => {
    const reader = scriptedReader(['']);
    const secret = await new Prompts(reader).ask(
      'Secret',
      (input) => ({ ok: true as const, value: input }),
      { secret: true, default: 'topsecret-value' },
    );

    expect(secret).toBe('topsecret-value');
    expect(reader.secretPrompts).toEqual(['Secret: ']);
    expect(reader.transcript()).not.toContain('topsecret-value');
  });

  it('does not use the default when something was typed', async () => {
    const reader = scriptedReader(['#fff']);
    await expect(
      new Prompts(reader).ask('Couleur', validateColor, { default: '#000' }),
    ).resolves.toBe('#ffffff');
  });

  it('stops with InputClosedError when the answers run out', async () => {
    await expect(new Prompts(scriptedReader([])).ask('Nom', validateName)).rejects.toBeInstanceOf(
      InputClosedError,
    );
  });
});

describe('Prompts.confirm', () => {
  it.each([
    ['o', true],
    ['oui', true],
    ['OUI', true],
    ['y', true],
    ['yes', true],
    ['n', false],
    ['non', false],
    ['No', false],
  ])('reads %j as %s', async (answer, expected) => {
    await expect(new Prompts(scriptedReader([answer])).confirm('Ok ?', !expected)).resolves.toBe(
      expected,
    );
  });

  it('takes the default on an empty answer, and shows it in capitals', async () => {
    const yes = scriptedReader(['']);
    await expect(new Prompts(yes).confirm('Ok ?', true)).resolves.toBe(true);
    expect(yes.transcript()).toContain('Ok ? (O/n) ');

    const no = scriptedReader(['']);
    await expect(new Prompts(no).confirm('Ok ?', false)).resolves.toBe(false);
    expect(no.transcript()).toContain('Ok ? (o/N) ');
  });

  it('shows y/n in English', async () => {
    const reader = scriptedReader(['']);
    const prompts = new Prompts(reader);
    prompts.setLanguage('en');
    await prompts.confirm('Ok?', true);
    expect(reader.transcript()).toContain('Ok? (Y/n) ');
  });

  it('asks again when the answer is neither yes nor no', async () => {
    const reader = scriptedReader(['peut-être', 'o']);
    await expect(new Prompts(reader).confirm('Ok ?')).resolves.toBe(true);
    expect(reader.transcript()).toContain('Répondez par « o » (oui) ou « n » (non).');
  });
});

describe('Prompts.choose', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ] as const;

  it('lists the options numbered, and returns the one whose number is typed', async () => {
    const reader = scriptedReader(['2']);
    await expect(new Prompts(reader).choose('Lettre', options)).resolves.toBe('b');
    expect(reader.transcript()).toMatch(/1\) Alpha[\s\S]*2\) Beta[\s\S]*3\) Gamma/);
  });

  it('takes the default option on an empty answer, and shows its number', async () => {
    const reader = scriptedReader(['']);
    await expect(new Prompts(reader).choose('Lettre', options, 2)).resolves.toBe('c');
    expect(reader.transcript()).toContain('> [3] ');
  });

  it.each(['0', '4', 'x', '1.5', '-1'])(
    'asks again for %j, saying which numbers exist',
    async (bad) => {
      const reader = scriptedReader([bad, '3']);
      await expect(new Prompts(reader).choose('Lettre', options)).resolves.toBe('c');
      expect(reader.transcript()).toContain('Tapez un numéro entre 1 et 3.');
    },
  );
});

describe('Prompts.step', () => {
  it('writes the numbered title of a step', () => {
    const reader = scriptedReader([]);
    new Prompts(reader).step(3, 9, 'stepOAuth');
    expect(reader.transcript()).toContain('Étape 3/9 — Application OAuth 42');
  });
});

describe('createTerminalReader', () => {
  function streams(tty = false) {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = tty;
    output.isTTY = tty;
    let written = '';
    output.on('data', (chunk: Buffer) => (written += chunk.toString('utf8')));
    return { input, output, written: () => written };
  }

  it('reads answers piped in all at once: none is lost between two questions', async () => {
    const { input, output } = streams();
    const reader = createTerminalReader(input, output);

    input.write('premier\ndeuxième\ntroisième\n');
    await new Promise((resolve) => setTimeout(resolve, 20)); // they all arrive before the first question ends
    expect(await reader.readLine('a: ')).toBe('premier');
    expect(await reader.readLine('b: ')).toBe('deuxième');
    expect(await reader.readLine('c: ')).toBe('troisième');
    reader.close();
  });

  it('waits for an answer that comes later', async () => {
    const { input, output } = streams();
    const reader = createTerminalReader(input, output);

    const pending = reader.readLine('question: ');
    setTimeout(() => input.write('plus tard\n'), 10);
    await expect(pending).resolves.toBe('plus tard');
    reader.close();
  });

  it('writes a line break after an answer read from a pipe, which nothing echoes, so prompts do not run together', async () => {
    const { input, output, written } = streams(false);
    const reader = createTerminalReader(input, output);
    input.write('un\ndeux\n');
    await reader.readLine('a: ');
    await reader.readLine('b: ');
    expect(written()).toBe('a: un\nb: deux\n');
    reader.close();
  });

  it('ignores the byte order mark PowerShell puts in front of piped text', async () => {
    const { input, output } = streams(false);
    const reader = createTerminalReader(input, output);
    input.write('\uFEFF1\n');
    expect(await reader.readLine('a: ')).toBe('1');
    reader.close();
  });

  it('prints the prompt it is given', async () => {
    const { input, output, written } = streams();
    const reader = createTerminalReader(input, output);
    input.write('x\n');
    await reader.readLine('Nom du BDE: ');
    expect(written()).toContain('Nom du BDE: ');
    reader.close();
  });

  it('fails with InputClosedError when the input ends before the answer', async () => {
    const { input, output } = streams();
    const reader = createTerminalReader(input, output);
    const pending = reader.readLine('q: ');
    input.end();
    await expect(pending).rejects.toBeInstanceOf(InputClosedError);
  });

  it('still hands over the answers that were already read when the input ends', async () => {
    const { input, output } = streams();
    const reader = createTerminalReader(input, output);
    input.write('un\ndeux\n');
    input.end();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await reader.readLine('a: ')).toBe('un');
    expect(await reader.readLine('b: ')).toBe('deux');
    await expect(reader.readLine('c: ')).rejects.toBeInstanceOf(InputClosedError);
  });

  it('does not echo a secret on a terminal, and prints the line break itself', async () => {
    const { input, output, written } = streams(true);
    const reader = createTerminalReader(input, output);

    const pending = reader.readSecret('Secret: ');
    input.write('s-s4t2ud-very-secret\r');
    await expect(pending).resolves.toBe('s-s4t2ud-very-secret');

    expect(written()).toContain('Secret: ');
    expect(written()).not.toContain('very-secret');
    expect(written().endsWith('\n')).toBe(true);
    reader.close();
  });

  it('echoes an ordinary answer on a terminal, so the person sees what they type', async () => {
    const { input, output, written } = streams(true);
    const reader = createTerminalReader(input, output);

    const pending = reader.readLine('Nom: ');
    input.write('BDE Lynx\r');
    await pending;

    expect(written()).toContain('BDE Lynx');
    reader.close();
  });

  it('calls onInterrupt and fails with AbortedError on Ctrl+C', async () => {
    const { input, output } = streams(true);
    const onInterrupt = vi.fn();
    const reader = createTerminalReader(input, output, { onInterrupt });

    const pending = reader.readLine('q: ');
    input.write('\u0003'); // Ctrl+C
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    reader.close();
  });
});
