import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), tick: vi.fn() }));
vi.mock('./access', () => ({ isEventsModuleEnabled: mocks.enabled }));
vi.mock('./reminders', () => ({ runReminderTick: mocks.tick }));

const { startEventReminderScheduler, stopEventReminderScheduler } = await import('./scheduler');

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  mocks.enabled.mockReturnValue(true);
  mocks.tick.mockResolvedValue({ claimed: 0 });
});
afterEach(() => {
  stopEventReminderScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the reminder scheduler', () => {
  it('ticks soon after it starts and then every 5 minutes', async () => {
    startEventReminderScheduler();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mocks.tick).toHaveBeenCalledTimes(2);
  });

  it('starts one loop however many times it is asked', async () => {
    startEventReminderScheduler();
    startEventReminderScheduler();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.tick).toHaveBeenCalledTimes(1);
  });

  it('does not start while the events module is off', async () => {
    mocks.enabled.mockReturnValue(false);
    startEventReminderScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.tick).not.toHaveBeenCalled();
  });

  it('stops for good when asked, and can start again once the module is back', async () => {
    startEventReminderScheduler();
    stopEventReminderScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.tick).not.toHaveBeenCalled();

    startEventReminderScheduler();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.tick).toHaveBeenCalledTimes(1);
  });

  it('stopping when nothing runs is harmless', () => {
    expect(() => stopEventReminderScheduler()).not.toThrow();
  });
});
