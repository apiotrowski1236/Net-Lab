/**
 * NetLab submission receiver for Google Sheets.
 *
 * Setup (about 5 minutes, once per school year):
 *   1. Create a new Google Sheet, for example "NetLab Submissions".
 *   2. Extensions > Apps Script. Delete the sample code and paste this file.
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      (Students are not signed in to anything when they submit, so "Anyone" is required.)
 *   4. Copy the web app URL (ends in /exec) into public/config.json as "submitEndpoint".
 *   5. Open the URL in a browser. It should say "NetLab receiver is running."
 *
 * Each lab gets its own tab. Each student gets one row per lab. New copies of
 * the same student's report overwrite their row, so the sheet always shows the
 * latest work. The "Teacher score" and "Teacher notes" columns are never
 * overwritten: grade there.
 *
 * "Teacher overrides" lists steps unlocked with the teacher override password,
 * and is highlighted when it isn't empty. So is "Wrong override passwords".
 */

var TEACHER_COLUMNS = ['Teacher score', 'Teacher notes'];

function doGet() {
  return ContentService.createTextOutput('NetLab receiver is running.');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var report = JSON.parse(e.postData.contents);
    if (report.app !== 'netlab' || !report.key || !report.lab || !report.student) {
      return ContentService.createTextOutput('ignored');
    }
    upsert(report);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput('error: ' + err);
  } finally {
    lock.releaseLock();
  }
}

function sheetFor(report) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = String(report.lab.title || report.lab.id).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 90);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(['Key', 'Name', 'Period', 'Status'].concat(TEACHER_COLUMNS));
    sh.setFrozenRows(1);
    sh.setFrozenColumns(2);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  }
  return sh;
}

/** Column number for a header, adding the column at the end if it's new. */
function columnFor(sh, headers, name) {
  var i = headers.indexOf(name);
  if (i >= 0) return i + 1;
  headers.push(name);
  sh.getRange(1, headers.length).setValue(name).setFontWeight('bold');
  return headers.length;
}

function upsert(r) {
  var sh = sheetFor(r);
  var headers = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);

  var cells = {
    Key: r.key,
    Name: r.student.name,
    Period: r.student.period,
    Status: r.status,
    'Auto-checked score': r.score.auto + ' / ' + r.score.autoMax,
    'Written answers (pts)': r.score.teacherMax,
    'Goals done': r.goals.filter(function (g) { return g.done; }).length + ' / ' + r.goals.length,
    'Step reached': r.stepReached + ' / ' + r.lab.steps,
    'Active minutes': r.activeMinutes,
    // Steps a teacher unlocked with the override password. Their goals stay unchecked.
    'Teacher overrides': (r.overrides || [])
      .map(function (o) {
        return 'Step ' + o.number + ' (' + o.title + ')' + (o.note ? ': ' + o.note : '');
      })
      .join('; '),
    'Wrong override passwords': r.overrideFailures || 0,
    Started: r.startedAt ? new Date(r.startedAt) : '',
    'Last update': r.updatedAt ? new Date(r.updatedAt) : '',
    Submitted: r.submittedAt ? new Date(r.submittedAt) : '',
  };
  r.questions.forEach(function (q, i) {
    var mark = '';
    if (q.autoGraded) mark = q.correct ? '[correct] ' : '[not yet] ';
    if (q.overridden) mark = '[step overridden] ' + mark;
    var prompt = String(q.prompt).replace(/\[\[|\]\]|\*\*|`/g, '');
    cells['Q' + (i + 1) + ': ' + prompt.slice(0, 60)] = q.answer ? mark + q.answer : '';
  });
  cells['Report JSON'] = JSON.stringify(r).slice(0, 49000);

  // Find this student's row.
  var row = 0;
  var last = sh.getLastRow();
  if (last > 1) {
    var hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(r.key).matchEntireCell(true).findNext();
    if (hit) row = hit.getRow();
  }

  // Ignore copies older than what we already have (they can arrive out of order).
  if (row) {
    var updCol = headers.indexOf('Last update');
    if (updCol >= 0) {
      var have = sh.getRange(row, updCol + 1).getValue();
      if (have instanceof Date && r.updatedAt && new Date(r.updatedAt) < have) return;
    }
  } else {
    row = last + 1;
  }

  var cols = Object.keys(cells).map(function (name) {
    return columnFor(sh, headers, name);
  });
  var width = headers.length;
  var values = row <= last ? sh.getRange(row, 1, 1, width).getValues()[0] : new Array(width).fill('');
  while (values.length < width) values.push('');
  Object.keys(cells).forEach(function (name, i) {
    values[cols[i] - 1] = cells[name];
  });
  sh.getRange(row, 1, 1, width).setValues([values]);

  // Make overrides and wrong passwords hard to miss.
  var flag = function (name, on) {
    var c = headers.indexOf(name);
    if (c >= 0) sh.getRange(row, c + 1).setBackground(on ? '#fde68a' : null);
  };
  flag('Teacher overrides', cells['Teacher overrides'] !== '');
  flag('Wrong override passwords', cells['Wrong override passwords'] > 0);
}
