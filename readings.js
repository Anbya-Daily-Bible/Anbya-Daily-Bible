// Reads the rows of the ReadingsInput.xlsx sheet (one row per day) and turns them into quizzes.
// Columns: A date | B reading | then 3 questions, 5 columns each:
//   question, choice 1, choice 2, choice 3, correct choice (the text of the right choice)

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const latin = (s) => String(s).replace(/[٠-٩۰-۹]/g, (d) => {
  const i = AR_DIGITS.indexOf(d);
  return String(i >= 0 ? i : FA_DIGITS.indexOf(d));
});
// Excel cells often hold stray spaces / non-breaking spaces; remove them.
const clean = (v) => (v === null || v === undefined ? "" : String(v)).replace(/[\u00a0\u200b-\u200f\u202a-\u202e\ufeff]/g, " ").replace(/\s+/g, " ").trim();
// Looser comparison for the "correct choice" column (ignores diacritics and alef/yaa spelling)
const loose = (s) => clean(s).replace(/[\u064b-\u065f\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();

function isoOk(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
}
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {          // Excel date number
    return new Date(Math.round((Math.floor(v) - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = latin(clean(v));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoOk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);            // day/month/year
  if (m) return isoOk(+m[3], +m[2], +m[1]);
  return "";
}

export function parseReadings(rows) {
  const days = [], errors = [], seen = new Set();
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r.some((c) => clean(c) !== "")) return;                   // empty row
    const day = parseDate(r[0]);
    if (!day) {
      if (i === 0) return;                                          // header row
      errors.push(`Row ${n}: the date in column A is missing or not a real date.`);
      return;
    }
    const bad = [];
    if (seen.has(day)) bad.push(`the date ${day} is used twice`);
    seen.add(day);
    const ref = clean(r[1]);
    if (!ref) bad.push("the reading (column B) is empty");
    const qs = [];
    for (let k = 0; k < 3; k++) {
      const b = 2 + k * 5, label = `question ${k + 1}`;
      const q = clean(r[b]);
      const o = [1, 2, 3].map((j) => clean(r[b + j])).filter(Boolean);
      const right = clean(r[b + 4]);
      if (!q) { bad.push(`${label} is empty`); continue; }
      if (o.length < 2) { bad.push(`${label} needs at least 2 choices`); continue; }
      if (new Set(o.map(loose)).size !== o.length) { bad.push(`${label} has two identical choices`); continue; }
      if (!right) { bad.push(`${label} has no correct choice`); continue; }
      let a = o.indexOf(right);
      if (a < 0) {
        const hits = o.map((x, idx) => (loose(x) === loose(right) ? idx : -1)).filter((x) => x >= 0);
        if (hits.length === 1) a = hits[0];
      }
      if (a < 0) { bad.push(`the correct choice of ${label} does not match any of its choices`); continue; }
      qs.push({ q, o, a });
    }
    if (bad.length) errors.push(`Row ${n} (${day}): ` + bad.join("; ") + ".");
    else days.push({ day, ref, qs });
  });
  return { days, errors };
}
