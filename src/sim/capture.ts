import type { Captured, Device } from './types';

/**
 * Capture runs (packet-capture): starting and stopping a capture the way
 * Wireshark does. Sim.startCapture begins a new, empty list on a device,
 * numbered from 1 and timed from 0; Sim.stopCapture stops recording and keeps
 * the list to read. Labs that only flip `sniffing` (Sim.setSniffing) keep one
 * long list numbered across the whole network, as before.
 */
export interface CaptureRun {
  /** Simulated time Start was pressed. The Time column counts from here. */
  start: number;
  /** Number for the next captured packet. */
  next: number;
  /** When Stop was pressed, if it was. */
  stoppedAt?: number;
}

export const newCaptureRun = (t: number): CaptureRun => ({ start: t, next: 1 });

/** Seconds since this device's capture started, the way Wireshark's Time column counts. */
export function captureSeconds(dev: Device, c: Captured): number {
  return (c.t - (dev.captureRun?.start ?? 0)) / 1000;
}

/** The packets of the current run captured at or after `since`. */
export function capturedAfter(dev: Device, since: number): Captured[] {
  return dev.capture.filter((c) => c.t >= since);
}
