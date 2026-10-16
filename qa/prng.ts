/**
 * A small seeded generator (mulberry32): the QA data is the same every time, so a failure can be played again and a
 * test can say exactly what it expects.
 */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** An integer from `min` to `max`, both included. */
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    chance: (probability: number): boolean => next() < probability,
    pick: <T>(values: readonly T[]): T => {
      const value = values[Math.floor(next() * values.length)];
      if (value === undefined) throw new Error('pick: nothing to choose from');
      return value;
    },
    /** One of the values, with the weight written next to it. */
    weighted: <T>(choices: readonly (readonly [T, number])[]): T => {
      const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of choices) {
        roll -= weight;
        if (roll < 0) return value;
      }
      const last = choices[choices.length - 1];
      if (!last) throw new Error('weighted: nothing to choose from');
      return last[0];
    },
    /** `count` different values of the list, in a random order. */
    sample: <T>(values: readonly T[], count: number): T[] => {
      const pool = [...values];
      const taken: T[] = [];
      while (taken.length < count && pool.length > 0) {
        const [value] = pool.splice(Math.floor(next() * pool.length), 1);
        if (value !== undefined) taken.push(value);
      }
      return taken;
    },
  };
}

export type Random = ReturnType<typeof createRandom>;
