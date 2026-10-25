import type { Clock } from "../clock.js";

/** {@link Clock} reading the system time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
