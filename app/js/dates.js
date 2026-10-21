// Dates. The app keeps calendar days as "YYYY-MM-DD" in the phone's local time zone; everything
// about days (today, days between, showing them) goes through here.

// A moment (a Date or a timestamp) as its local calendar day. (toISOString alone would use UTC,
// which is already tomorrow for part of every evening in the Americas.)
export function localDay(moment = new Date()) {
  const date = new Date(moment);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const todayISO = () => localDay();

// Whole days from one "YYYY-MM-DD" to another (today by default).
export const daysBetween = (from, to = todayISO()) =>
  Math.round((new Date(`${to}T00:00`) - new Date(`${from}T00:00`)) / 86400000);

// "Oct 20" for dates this year, "Oct 20, 2025" for any other year. Used for every date the app shows.
export function formatDate(iso) {
  const date = new Date(`${iso}T00:00`);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// A moment in time: "Today, 9:41 AM" or "Oct 19, 9:41 AM".
export function formatMoment(at) {
  const time = new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = localDay(at);
  return `${day === todayISO() ? 'Today' : formatDate(day)}, ${time}`;
}
