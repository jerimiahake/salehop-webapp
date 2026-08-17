// Formatting + date helpers shared by the Browse/Map/Post screens.

// Postgres returns `time` columns as "HH:MM:SS" strings. Format for display.
export function formatTime(hhmmss) {
  if (!hhmmss) return '';
  const [hStr, mStr] = hhmmss.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)}â€“${formatTime(end)}`;
}

const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

// Returns the YYYY-MM-DD date string for the next occurrence of the given
// weekday (Fri/Sat/Sun), counting today as a valid match.
export function upcomingDateFor(dayAbbrev, from = new Date()) {
  const target = DOW[dayAbbrev];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return toDateKey(d);
}

const WEEKDAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Returns the next `count` days (including today) as
// [{ date: 'YYYY-MM-DD', label: 'TODAY' | 'TOMORROW' | 'FRI' | ... }, ...].
// Used for both the Browse filter pills and the Post screen's date picker,
// so any day of the week -- not just Fri/Sat/Sun -- has a matching pill.
export function nextNDays(count = 7, from = new Date()) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const label = i === 0 ? 'TODAY' : i === 1 ? 'TMRW' : WEEKDAY_LABEL[d.getDay()];
    days.push({ date: toDateKey(d), label });
  }
  return days;
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function distanceMiles(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 3958.8; // miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}
