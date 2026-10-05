import type { ReactElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';

/** Renders a (possibly async) Server Component tree to an HTML string, so
 * tests can assert on what a user would actually receive. */
export async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}
