/**
 * The downloaded report's file name: "<student> - <lab title>.html".
 *
 * Lab titles carry colons, commas, and periods ("p5.js: Animation"). Windows
 * refuses < > : " / \ | ? * and control characters, macOS shows a colon as a
 * slash, and Chrome (ChromeOS included) swaps any of these for _ when it saves.
 * Drop them here, so the name the page shows is the name that lands in the
 * downloads folder. Commas, periods, and hyphens are safe everywhere.
 */
export function reportFileName(name: string, labTitle: string): string {
  const who = name.replace(/[^\w -]+/g, '').replace(/\s+/g, ' ').trim() || 'student';
  const what =
    labTitle
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '') || 'lab';
  return `${who} - ${what}.html`;
}
