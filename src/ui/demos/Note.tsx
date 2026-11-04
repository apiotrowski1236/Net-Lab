import type { NoteSpec } from '../../demos/types';
import { Md, type DemoViewProps } from './parts';

export function NoteView({ spec }: DemoViewProps<NoteSpec, unknown>) {
  return <Md src={spec.md} class="demo-note" />;
}
