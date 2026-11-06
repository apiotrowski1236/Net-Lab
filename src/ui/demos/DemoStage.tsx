import { useEffect, useRef } from 'preact/hooks';
import { isStatic } from '../../demos/registry';
import type { DemoSpec } from '../../demos/types';
import type { LabSession } from '../../runtime/session';
import { Icon } from '../icons';
import { Md, type DemoView } from './parts';
import { DEMO_VIEWS } from './registry';

function DemoCard({ session, spec }: { session: LabSession; spec: DemoSpec }) {
  const View = DEMO_VIEWS[spec.kind] as DemoView<DemoSpec, unknown>;
  const stepId = session.step.id;
  const touched = !!session.progress.demos?.[`${stepId}/${spec.id}`];
  const head = `demo-${stepId}-${spec.id}`;
  return (
    <section class={`demo-card demo-${spec.kind}`} aria-labelledby={head} data-demo={spec.id}>
      <header class="demo-head">
        <h3 id={head}>{spec.title}</h3>
        {!isStatic(spec) && (
          <button class="btn ghost small" disabled={!touched} onClick={() => session.resetDemo(spec.id)} title="Put this back the way it started. Goals you reached stay reached.">
            <Icon name="reset" size={14} /> Start over
          </button>
        )}
      </header>
      {spec.intro && <Md src={spec.intro} class="demo-intro" />}
      <View spec={spec} state={session.demoState(spec)} send={(input) => session.demo(spec.id, input)} />
    </section>
  );
}

/**
 * The stage of a lesson with no network: the step's demos, top to bottom.
 * Each demo's state lives in the session (and the saved progress), so this
 * redraws from it and keeps nothing of its own. `inline` draws them inside the
 * lesson, for a narrow screen.
 */
export function DemoStage({ session, inline = false }: { session: LabSession; inline?: boolean }) {
  void session.rev.value;
  const step = session.step;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [step.id]);
  const demos = step.demos ?? [];
  return (
    <div class={`demo-stage ${inline ? 'inline' : ''}`} ref={scroller}>
      <div class={`demo-list ${demos.some((d) => d.kind === 'java' || d.kind === 'js') ? 'wide' : ''}`}>
        {demos.map((spec) => (
          <DemoCard key={`${step.id}/${spec.id}`} session={session} spec={spec} />
        ))}
        {!demos.length && !inline && (
          <div class="demo-empty muted">
            <Icon name="book" size={18} /> Everything for this step is in the lesson.
          </div>
        )}
      </div>
    </div>
  );
}
