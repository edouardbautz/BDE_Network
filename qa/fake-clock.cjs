// The clock of a QA platform, set to another moment (docs/architecture.md, "Quality campaign"). Loaded into the node processes of
// the container with NODE_OPTIONS=--require=/qa/fake-clock.cjs, and given its moment by BDE_QA_NOW (an ISO date):
//
//   sh qa/platform.sh up --now 2026-10-16T12:00:00Z
//
// From that moment the clock runs at the normal speed (timers and timeouts keep their meaning), so the application sees the
// "now" of the dataset, which is what makes a page the same today and in a month: the dates "to come", the day marked as today,
// the reminder due the day before. Only `Date` is changed: `new Date()`, `Date.now()` and `Date()`; a date built from arguments
// is untouched, and the objects stay real dates (`instanceof Date`, the methods of the prototype). The database keeps its own
// clock (`now()` in a default value). QA tooling only: nothing of the application reads BDE_QA_NOW, and a real installation never
// has the variable.
'use strict';

const moment = process.env.BDE_QA_NOW;
if (moment) {
  const base = Date.parse(moment);
  if (Number.isNaN(base)) {
    throw new Error(`BDE_QA_NOW is not a date: ${moment}`);
  }
  const RealDate = Date;
  const startedAt = RealDate.now();
  const now = () => base + (RealDate.now() - startedAt);

  globalThis.Date = new Proxy(RealDate, {
    // `new Date()` is the only form that asks the clock: any other is a date somebody already knows.
    construct(target, args, newTarget) {
      return args.length === 0
        ? Reflect.construct(target, [now()], newTarget)
        : Reflect.construct(target, args, newTarget);
    },
    // `Date()` without `new` is the text of the present moment.
    apply(target) {
      return new target(now()).toString();
    },
    get(target, property, receiver) {
      if (property === 'now') return now;
      return Reflect.get(target, property, receiver);
    },
  });
}
