import { Sim } from '../sim/sim';
import type { LabDef } from './types';

/** The lab's network, or an empty one for a lesson with no network (its steps show demos instead). */
export function buildNetwork(lab: LabDef): Sim {
  return lab.build ? lab.build() : new Sim();
}
