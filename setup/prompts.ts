import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { translator, type Lang, type MessageKey, type Translate } from './messages';
import type { Check } from './validate';

/** Ctrl+C: the person leaves. Nothing was written. */
export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

/** The answers ran out (input closed): nothing was written. */
export class InputClosedError extends Error {
  constructor() {
    super('input closed');
    this.name = 'InputClosedError';
  }
}

/** The lowest level: lines of text in, text out. Real in a terminal, scripted in the tests. */
export interface LineReader {
  readLine(prompt: string): Promise<string>;
  /** Like `readLine`, but what is typed is not echoed. */
  readSecret(prompt: string): Promise<string>;
  write(text: string): void;
  close(): void;
}

interface Waiter {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
}

/**
 * A reader on a terminal (or on a pipe: answers piped in are read one per question, none is lost).
 * Typed secrets are muted by swallowing what readline would echo.
 */
export function createTerminalReader(
  input: NodeJS.ReadableStream & { isTTY?: boolean },
  output: NodeJS.WritableStream & { isTTY?: boolean; columns?: number },
  options: { onInterrupt?: () => void } = {},
): LineReader {
  let muted = false;
  const filtered = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  Object.defineProperty(filtered, 'columns', { get: () => output.columns ?? 80 });
  Object.defineProperty(filtered, 'isTTY', { get: () => Boolean(output.isTTY) });

  const readline = createInterface({ input, output: filtered, terminal: Boolean(input.isTTY) });
  const queue: string[] = [];
  let waiter: Waiter | undefined;
  let failure: Error | undefined;
  let closed = false;

  const settle = (error: Error) => {
    failure ??= error;
    const pending = waiter;
    waiter = undefined;
    pending?.reject(error);
  };

  readline.on('line', (line) => {
    const pending = waiter;
    if (pending) {
      waiter = undefined;
      pending.resolve(line);
    } else {
      queue.push(line);
    }
  });
  readline.on('close', () => {
    closed = true;
    settle(new InputClosedError());
  });
  readline.on('SIGINT', () => {
    options.onInterrupt?.();
    settle(new AbortedError());
  });

  const next = (): Promise<string> => {
    const queued = queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      waiter = { resolve, reject };
    });
  };

  /** Shows the prompt. Once the input has ended readline refuses to, so it is written by hand. */
  const showPrompt = (prompt: string) => {
    if (closed) {
      output.write(prompt);
      return;
    }
    readline.setPrompt(prompt);
    readline.prompt();
  };

  return {
    async readLine(prompt) {
      showPrompt(prompt);
      const line = (await next()).replace(/^\uFEFF/, ''); // PowerShell puts a BOM in front of piped text
      if (!input.isTTY) output.write(`${line}\n`); // piped answers are not echoed by a terminal
      return line;
    },
    async readSecret(prompt) {
      showPrompt(prompt);
      muted = true;
      try {
        return await next();
      } finally {
        muted = false;
        output.write('\n');
      }
    },
    write(text) {
      output.write(text);
    },
    close() {
      readline.close();
    },
  };
}

export interface AskOptions {
  default?: string;
  /** What is typed is not shown, and the default is never displayed. */
  secret?: boolean;
}

/** The questions of the assistant: ask, validate on the spot, explain, ask again. */
export class Prompts {
  private lang: Lang = 'fr';
  t: Translate = translator('fr');

  constructor(readonly reader: LineReader) {}

  setLanguage(lang: Lang): void {
    this.lang = lang;
    this.t = translator(lang);
  }

  get language(): Lang {
    return this.lang;
  }

  say(text = ''): void {
    this.reader.write(`${text}\n`);
  }

  /** A question with a validator: it asks again, saying what is wrong, until the answer is valid. */
  async ask<T>(
    question: string,
    validate: (input: string) => Check<T>,
    options: AskOptions = {},
  ): Promise<T> {
    const shown =
      options.default !== undefined && options.default !== '' && !options.secret
        ? ` [${options.default}]`
        : '';
    for (;;) {
      const prompt = `${question}${shown}: `;
      const raw = options.secret
        ? await this.reader.readSecret(prompt)
        : await this.reader.readLine(prompt);
      const answer = raw.trim() === '' && options.default !== undefined ? options.default : raw;
      const result = validate(answer);
      if (result.ok) return result.value;
      this.say(this.t('invalid', { reason: this.t(result.error) }));
    }
  }

  async confirm(question: string, defaultYes = true): Promise<boolean> {
    const hint = this.t('yesNoHint');
    const [yes, no] = hint.split('/');
    const label = defaultYes ? `${yes?.toUpperCase()}/${no}` : `${yes}/${no?.toUpperCase()}`;
    for (;;) {
      const answer = (await this.reader.readLine(`${question} (${label}) `)).trim().toLowerCase();
      if (answer === '') return defaultYes;
      if (['o', 'oui', 'y', 'yes'].includes(answer)) return true;
      if (['n', 'non', 'no'].includes(answer)) return false;
      this.say(this.t('answerYesNo'));
    }
  }

  /** A numbered list: the person types a number (Enter takes the default one). */
  async choose<T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    defaultIndex = 0,
  ): Promise<T> {
    this.say(question);
    options.forEach((option, index) => this.say(`  ${index + 1}) ${option.label}`));
    for (;;) {
      const answer = (await this.reader.readLine(`> [${defaultIndex + 1}] `)).trim();
      if (answer === '') return options[defaultIndex]?.value as T;
      const number = Number(answer);
      const chosen = Number.isInteger(number) ? options[number - 1] : undefined;
      if (chosen) return chosen.value;
      this.say(this.t('chooseNumber', { max: options.length }));
    }
  }

  /** The numbered list of a title like "Step 2/8 — Address". */
  step(n: number, total: number, title: MessageKey): void {
    this.say();
    this.say(this.t('step', { n, total, title: this.t(title) }));
  }
}
