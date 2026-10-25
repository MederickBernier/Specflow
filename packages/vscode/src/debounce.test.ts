import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Debouncer } from "./debounce.js";

describe("Debouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // vscode-extension/R2: a burst of saves reloads once.
  it("runs once, after the last trigger", () => {
    const fn = vi.fn();
    const debouncer = new Debouncer(300, fn);
    debouncer.trigger();
    vi.advanceTimersByTime(200);
    debouncer.trigger();
    vi.advanceTimersByTime(200);
    debouncer.trigger();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again for a later burst", () => {
    const fn = vi.fn();
    const debouncer = new Debouncer(300, fn);
    debouncer.trigger();
    vi.advanceTimersByTime(300);
    debouncer.trigger();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending run on dispose", () => {
    const fn = vi.fn();
    const debouncer = new Debouncer(300, fn);
    debouncer.trigger();
    debouncer.dispose();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
