// jsdom ships no types and the project does not depend on @types/jsdom: only what the attack suites use.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string);
    window: { document: Document };
  }
}
