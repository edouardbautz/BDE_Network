/** Does the source of a file start (after comments and blanks) with the `'use server'` directive? Linear in the size of the file. */
export function startsWithUseServer(source: string): boolean {
  let rest = source;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n');
      if (end < 0) return false;
      rest = rest.slice(end + 1);
    } else if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end < 0) return false;
      rest = rest.slice(end + 2);
    } else {
      return rest.startsWith("'use server'") || rest.startsWith('"use server"');
    }
  }
}
