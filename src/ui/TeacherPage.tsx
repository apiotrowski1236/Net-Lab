import { Icon } from './icons';
import { ReportChecker } from './ReportCheck';

/** #/teacher: check downloaded report files for edits. Nothing here is saved. */
export function TeacherPage() {
  return (
    <div class="teacher-page">
      <a class="btn ghost small" href="#/">
        <Icon name="home" size={14} /> Home
      </a>
      <h1>Teacher tools</h1>

      <h2>Check report files</h2>
      <ReportChecker />
    </div>
  );
}
