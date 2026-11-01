/**
 * A zone plan (built for `segmentation`): which zone each device belongs to,
 * and how closely each zone is guarded. It's the student's plan on paper. It
 * moves no packets by itself; the map draws it, and the zone policy shows the
 * levels in its headings.
 *
 * State: `Device.zone` (a zone id the lab chooses, like 'weapons') and
 * `Sim.zoneLevels` (zone id -> level). Both replay and reset with the network.
 * Sim methods: setZone, setZoneLevel.
 */

export type ZoneLevel = 'high' | 'medium' | 'low';

export const ZONE_LEVELS: ZoneLevel[] = ['high', 'medium', 'low'];

export const LEVEL_NAME: Record<ZoneLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' };
