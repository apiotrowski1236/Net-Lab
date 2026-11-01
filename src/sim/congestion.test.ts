import { describe, expect, it } from 'vitest';
import { clearAllFloods, clearFlood, linkLoad, newCongestion, setFlood } from './congestion';

describe('congestion state', () => {
  it('a new state has no load anywhere', () => {
    const c = newCongestion();
    expect(linkLoad(c, 'uplink')).toBe(0);
  });

  it('adds up the floods running over one link', () => {
    const c = newCongestion();
    setFlood(c, 'uplink', 'smurf', 240);
    setFlood(c, 'uplink', 'botnet', 300);
    setFlood(c, 'other', 'smurf', 50); // different link, different flood kind entry
    expect(linkLoad(c, 'uplink')).toBe(540);
    expect(linkLoad(c, 'other')).toBe(50);
  });

  it('switching the same flood on again changes its rate, it does not stack', () => {
    const c = newCongestion();
    setFlood(c, 'uplink', 'smurf', 240);
    setFlood(c, 'uplink', 'smurf', 120);
    expect(linkLoad(c, 'uplink')).toBe(120);
    expect(c.floods).toHaveLength(1);
  });

  it('clearing one kind leaves the others', () => {
    const c = newCongestion();
    setFlood(c, 'uplink', 'smurf', 240);
    setFlood(c, 'uplink', 'botnet', 300);
    clearFlood(c, 'smurf');
    expect(linkLoad(c, 'uplink')).toBe(300);
    clearFlood(c, 'botnet');
    expect(linkLoad(c, 'uplink')).toBe(0);
  });

  it('clearAllFloods empties every link', () => {
    const c = newCongestion();
    setFlood(c, 'uplink', 'smurf', 240);
    setFlood(c, 'campus', 'smurf', 240);
    clearAllFloods(c);
    expect(c.floods).toEqual([]);
  });
});
