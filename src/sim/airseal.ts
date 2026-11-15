import { BROADCAST_MAC, type Mac } from './addr';
import type { Frame } from './types';

/**
 * WPA2 on a Wi-Fi that still runs as a hub (on-path).
 *
 * Radio reaches every device in range, with or without encryption. What WPA2
 * changes is that each device joins with its own key, shared only with the
 * access point, and every frame sent to one device is encrypted with that
 * device's key. So a sniffer still receives everyone's frames, but it can open
 * only its own, plus broadcasts (ARP requests, for one), which use a group key
 * every member has.
 *
 * The model: a hub with `Device.airSeal` sends each wireless port a sealed
 * copy of any frame addressed to some other device. The sealed copy keeps the
 * two MAC addresses (real WPA2 leaves them readable) and drops everything
 * inside, so nothing can leak through the capture, filters, or file export. A
 * wired port (the router behind the access point) gets the frame as it is,
 * because the access point decrypts frames before it passes them on. A frame
 * from one Wi-Fi device to another stays on the air: the access point knows
 * which devices have joined, so it doesn't send that frame out the wired port.
 *
 * Simplified: one key per device, no four-way handshake, and no key cracking.
 */

/** The Wi-Fi's encryption, on the hub that stands for the access point. */
export interface AirSeal {
  mode: 'WPA2';
}

/** What a sniffer has of a frame encrypted with another device's key. Lives on `Frame.sealed`. */
export interface SealedFrame {
  mode: AirSeal['mode'];
}

/** Whether the copy of `frame` for the device at `peerMac` must be sealed. */
export function mustSeal(seal: AirSeal | undefined, frame: Frame, peerMac: Mac | undefined, wireless: boolean): boolean {
  if (!seal || !wireless || frame.sealed) return false;
  return frame.dst !== BROADCAST_MAC && frame.dst !== peerMac;
}

/** Whether an encrypted access point keeps `frame` off a wired port, because it is for a device on the air (`onAir`). */
export function staysOnAir(seal: AirSeal | undefined, frame: Frame, wireless: boolean, onAir: (mac: Mac) => boolean): boolean {
  return !!seal && !wireless && frame.dst !== BROADCAST_MAC && onAir(frame.dst);
}

/** The copy a device that isn't the addressee receives: the MAC addresses, and nothing it can read. */
export function sealedCopy(frame: Frame, seal: AirSeal): Frame {
  const { id, src, dst, origin, forged } = frame;
  return { id, src, dst, origin, ...(forged ? { forged } : {}), sealed: { mode: seal.mode } };
}
