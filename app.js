import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, increment,
  collection, query, orderBy, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ROSTER, CLASSES } from "./roster.js";
import { parseReadings } from "./readings.js";

/* ============ 1) PASTE YOUR FIREBASE SETTINGS HERE ============ */
const firebaseConfig = {
  apiKey: "AIzaSyBYrOhTJ84nTaHRT--yzZXaP9i1mRvN1dg",
  authDomain: "anbya-daily-bible-9e388.firebaseapp.com",
  projectId: "anbya-daily-bible-9e388",
  storageBucket: "anbya-daily-bible-9e388.firebasestorage.app",
  messagingSenderId: "826856941464",
  appId: "1:826856941464:web:aa3e95b649e73365fa2ded",
  measurementId: "G-8JKPPCDLMP"
};

/* ============ 2) OWNER EMAILS — must match firestore.rules ============ */
const OWNER_EMAILS = [
  "pierre2006hany@gmail.com",
  "marysafwatsobhy@gmail.com",
  "miraphilip2013@gmail.com",
  "john.awadallah@gmail.com",
  "youssefmaged.nm@gmail.com",
  "jessicawessam2007@gmail.com",
  "beshoyyoussrey@gmail.com",
  "martinanagynasry889@gmail.com",
  "markfady2007@gmail.com",
  "nattoo2007@gmail.com",
  "silvysafwat3@gmail.com",
  "daliaedward@gmail.com",
  "johnmahfouzhanna@gmail.com",
  "pilopatesameh@gmail.com",
  "mariammagdyy05@gmail.com",
  "sherysafwat40@gmail.com",
  "atefbeshoy69@gmail.com",
  "arsanymaher03@gmail.com",
  "fadyhany2007@gmail.com"
].map((e) => e.toLowerCase());
/* =============================================================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const views = ["authView", "quizView", "resultView", "adminView"];
const ar = (n) => String(Math.round(Number(n) * 100) / 100);   // 0.25, 0.75, 1 ... (no long decimals)

// Points: each correct answer gives PER_CORRECT; finishing all questions gives FINISH_BONUS even if all are wrong.
// 3 correct = 3 x 0.25 + 0.25 = 1 Ambosh for the day.
const PER_CORRECT = 0.25;
const FINISH_BONUS = 0.25;
const QUESTIONS_PER_DAY = 3;
// Points for question number i (0,1,2): the bonus is added together with the last question's points
const pointsFor = (right, i) => right * PER_CORRECT + (i === QUESTIONS_PER_DAY - 1 ? FINISH_BONUS : 0);

let mode = "signin";
let user = null;
let data = null;            // the child's saved document
let today = "";
let set = null;             // today's quiz
let qi = 0, score = 0, answered = false;

/* ---------- Helpers ---------- */
// Uses Cairo time, so changing the phone's clock does not change the quiz day.
function todayStr() {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).forEach((x) => (p[x.type] = x.value));
  return p.year + "-" + p.month + "-" + p.day;
}
// Correct answers live in answers/{day}/items/{i} and can only be read AFTER the pick is saved
async function fetchAnswer(day, i) {
  const snap = await getDoc(doc(db, "answers", day, "items", String(i)));
  if (!snap.exists()) throw new Error("answer-missing");
  return snap.data().a;
}
// Today's questions are typed by the owner and stored in Firestore: quizzes/YYYY-MM-DD
async function fetchSet(day) {
  try {
    const snap = await getDoc(doc(db, "quizzes", day));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("Could not load questions:", e);
    return null;
  }
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Children have no real e-mail. Each child gets a hidden login address built from their id.
const KID_DOMAIN = "@anbya-kids.app";
const kidEmail = (kid) => kid.id + KID_DOMAIN;
const kidFromEmail = (e) => {
  e = (e || "").toLowerCase();
  return e.endsWith(KID_DOMAIN) ? ROSTER.find((k) => k.id === e.slice(0, -KID_DOMAIN.length)) : null;
};
const firstName = (k) => k.name.trim().split(/\s+/)[0];
const kidPassword = (k) => firstName(k) + "12345";
const isOwnerEmail = (e) => OWNER_EMAILS.includes((e || "").toLowerCase());
const isOwner = (u) => !!(u && isOwnerEmail(u.email));
function show(name) {
  $("boot").hidden = true;
  views.forEach((v) => ($(v).hidden = v !== name));
  $("footer").hidden = name === "authView";
}
function friendlyError(e) {
  const map = {
    "auth/invalid-email": "Please type a real email.",
    "auth/missing-password": "Please type a password.",
    "auth/weak-password": "Password needs at least 6 characters.",
    "auth/email-already-in-use": "This name already has an account. Tap \"I already have an account\" and sign in.",
    "auth/invalid-credential": "Name or password is not right. (First time? Tap \"First time here?\")",
    "auth/user-not-found": "Name or password is not right. (First time? Tap \"First time here?\")",
    "auth/wrong-password": "Name or password is not right.",
    "auth/too-many-requests": "Too many tries. Please wait a moment.",
    "auth/operation-not-allowed": "Email/Password sign-in is not turned on in Firebase (Authentication → Sign-in method).",
    "auth/network-request-failed": "No internet connection. Please try again.",
    "auth/unauthorized-domain": "This website address is not allowed in Firebase (Authentication → Settings → Authorized domains)."
  };
  console.error("Auth error:", e);
  return map[e.code] || "Something went wrong (" + (e.code || "error") + "). Please try again.";
}

/* ---------- Sign in / sign up ---------- */
let ownerMode = false;
let ownerSignup = false;

function fillSelect(sel, placeholder, items) {
  sel.innerHTML = "";
  const p = document.createElement("option");
  p.value = ""; p.textContent = placeholder;
  sel.appendChild(p);
  items.forEach(([value, label]) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  });
}
const byName = (a, b) => a.name.localeCompare(b.name);

function renderNames() {
  const cls = $("classSel").value;
  const list = ROSTER.filter((k) => k.cls === cls).sort(byName);
  fillSelect($("nameSel"), cls ? "Choose your name" : "Choose your class first", list.map((k) => [k.id, k.name]));
  $("nameSel").disabled = !cls;
}

function renderAuth() {
  const up = mode === "signup";
  $("kidForm").hidden = ownerMode;
  $("ownerForm").hidden = !ownerMode;
  $("ownerBtn").textContent = ownerMode ? "← Back to children sign in" : "Teacher sign in";
  $("ownerAuthBtn").textContent = ownerSignup ? "Create teacher account" : "Sign in";
  $("ownerSwitchBtn").textContent = ownerSignup ? "I already have an account" : "New teacher? Make an account";
  $("ownerPassword").autocomplete = ownerSignup ? "new-password" : "current-password";
  $("authBtn").textContent = up ? "Create my account" : "Sign in";
  $("switchBtn").textContent = up ? "I already have an account" : "First time here? Make an account";
  $("password").autocomplete = up ? "new-password" : "current-password";
  $("authErr").textContent = "";
  renderNames();
}
fillSelect($("classSel"), "Choose your class", CLASSES.map((c) => [c, c]));
$("classSel").onchange = renderNames;
$("switchBtn").onclick = () => {
  mode = mode === "signin" ? "signup" : "signin";
  $("classSel").value = "";
  renderAuth();
};
$("ownerBtn").onclick = () => { ownerMode = !ownerMode; ownerSignup = false; renderAuth(); };
$("ownerSwitchBtn").onclick = () => { ownerSignup = !ownerSignup; renderAuth(); };

$("authBtn").onclick = async () => {
  const kid = ROSTER.find((k) => k.id === $("nameSel").value);
  const pw = $("password").value.trim().toLowerCase();
  $("authErr").textContent = "";
  if (!$("classSel").value) { $("authErr").textContent = "Please choose your class."; return; }
  if (!kid) { $("authErr").textContent = "Please choose your name."; return; }
  if (!pw) { $("authErr").textContent = "Please type your password."; return; }
  $("authBtn").disabled = true;
  try {
    if (mode === "signup") {
      if (pw !== kidPassword(kid)) throw { code: "wrong-kid-password" };
      // The account record (name + class) is created by onAuthStateChanged below.
      await createUserWithEmailAndPassword(auth, kidEmail(kid), pw);
    } else {
      await signInWithEmailAndPassword(auth, kidEmail(kid), pw);
    }
  } catch (e) {
    $("authErr").textContent = e.code === "wrong-kid-password"
      ? "That password is not right. Ask your teacher for your password."
      : friendlyError(e);
  }
  $("authBtn").disabled = false;
};

$("ownerAuthBtn").onclick = async () => {
  $("authErr").textContent = "";
  $("ownerAuthBtn").disabled = true;
  try {
    const email = $("email").value.trim();
    const pw = $("ownerPassword").value;
    if (ownerSignup) {
      // Only emails listed in OWNER_EMAILS (and firestore.rules) can become teachers
      if (!isOwnerEmail(email)) throw { code: "not-teacher" };
      await createUserWithEmailAndPassword(auth, email, pw);
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
  } catch (e) {
    if (e.code === "not-teacher") {
      $("authErr").textContent = "This email is not on the teacher list. Ask the site owner to add it.";
      $("ownerAuthBtn").disabled = false;
      return;
    }
    $("authErr").textContent = friendlyError(e);
  }
  $("ownerAuthBtn").disabled = false;
};
$("signOutBtn").onclick = () => signOut(auth);

// Eye button: show / hide what is typed in a password box
function wirePasswordToggle(btnId, inputId) {
  const btn = $(btnId), input = $(inputId);
  btn.onclick = () => {
    const showIt = input.type === "password";
    input.type = showIt ? "text" : "password";
    btn.classList.toggle("on", showIt);
    const label = showIt ? "Hide password" : "Show password";
    btn.title = label; btn.setAttribute("aria-label", label);
  };
}
wirePasswordToggle("pwToggle", "password");
wirePasswordToggle("ownerPwToggle", "ownerPassword");

// Teacher: show / hide the list of scheduled days
$("toggleDays").onclick = () => {
  const box = $("qList");
  box.hidden = !box.hidden;
  $("toggleDays").textContent = box.hidden ? "📅 Show scheduled days" : "📅 Hide scheduled days";
};

/* ---------- Session ---------- */
onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) {
    $("password").value = ""; $("ownerPassword").value = "";
    $("password").type = "password"; $("ownerPassword").type = "password";   // hide again after sign out
    $("pwToggle").classList.remove("on"); $("ownerPwToggle").classList.remove("on");
    renderAuth(); show("authView"); return;
  }
  if (isOwner(u)) { loadAdmin(); return; }
  const ref = doc(db, "users", u.uid);
  try {
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      const kid = kidFromEmail(u.email);
      await setDoc(ref, {
        email: u.email.toLowerCase(), name: kid ? kid.name : "", cls: kid ? kid.cls : "",
        ambosh: 0, joined: Date.now(),
        pDay: "", pCount: 0, pScore: 0, picks: [], pPaid: 0
      });
      snap = await getDoc(ref);
    }
    data = snap.data();
    data.picks = data.picks || [];
    if (data.pPaid === undefined) data.pPaid = data.pCount || 0;
  } catch (e) {
    console.error("Could not load account:", e);
    data = { ambosh: 0, lastDay: "", lastScore: 0, picks: [], pPaid: 0 };
  }
  today = todayStr();
  await settlePending();   // if the page was closed between "pick saved" and "points added"
  set = await fetchSet(today);
  if (!set) { showNoQuiz(); return; }
  if (data.pDay === today) {
    // Continue where the child stopped (a refresh never resets answered questions)
    qi = data.pCount || 0;
    score = data.pScore || 0;
    if (qi >= set.qs.length) showDone(); else showQuestion();
  } else if (data.lastDay === today) {
    showDone();           // accounts saved by an older version of the site
  } else {
    startQuiz();
  }
});

function showNoQuiz() {
  $("trophy").textContent = "🌅";
  $("resultTitle").textContent = "No questions today";
  $("resultSub").textContent = "Come back tomorrow for new questions!";
  show("resultView");
}

/* ---------- Daily quiz ---------- */
function startQuiz() {
  qi = 0; score = 0;
  showQuestion();
}

function showQuestion() {
  const q = set.qs[qi];
  answered = false;
  $("qCount").textContent = `Question ${qi + 1} of ${set.qs.length}`;
  $("ambosh").textContent = ar(data.ambosh || 0);
  $("ref").textContent = `📖 ${set.ref}`;
  $("verse").textContent = q.q;
  $("msg").textContent = "";
  $("nextBtn").hidden = true;
  const box = $("options");
  box.innerHTML = "";
  shuffle(q.o.map((name, idx) => ({ name, idx }))).forEach(({ name, idx }) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = name;
    b.dataset.idx = idx;
    b.onclick = () => pick(idx);
    box.appendChild(b);
  });
  show("quizView");
}

let saved = true, chosen = -1, pickSaved = false, correctIdx = null, credited = false;

async function pick(idx) {
  if (answered) return;          // each question can only be answered once
  answered = true;
  chosen = idx; pickSaved = false; correctIdx = null; credited = false;
  await saveAnswer();
}

// Step A: lock in the pick.  Step B: read the real answer, then add the points.
// The Firestore rules check both steps, so the score cannot be faked from the browser.
async function saveAnswer() {
  const m = $("msg");
  const ref = doc(db, "users", user.uid);
  saved = false;
  $("nextBtn").hidden = true;
  m.textContent = "Saving...";
  try {
    if (!pickSaved) {
      const fresh = data.pDay !== today;
      const picks = fresh ? [chosen] : [...(data.picks || []), chosen];
      const patch = fresh
        ? { pDay: today, pCount: 1, picks, pScore: 0, pPaid: 0 }
        : { pCount: qi + 1, picks };
      await updateDoc(ref, patch);
      data.pDay = today; data.pCount = patch.pCount; data.picks = picks;
      if (fresh) { data.pScore = 0; data.pPaid = 0; }
      pickSaved = true;
    }
    if (correctIdx === null) correctIdx = await fetchAnswer(today, qi);
    document.querySelectorAll(".opt").forEach((b) => {
      const i = Number(b.dataset.idx);
      if (i === correctIdx) b.classList.add("good");
      else if (i === chosen) b.classList.add("bad");
    });
    if (!credited) {
      const right = chosen === correctIdx ? 1 : 0;
      const gain = pointsFor(right, qi);
      await updateDoc(ref, { ambosh: increment(gain), pScore: (data.pScore || 0) + right, pPaid: (data.pPaid || 0) + 1 });
      data.ambosh = (data.ambosh || 0) + gain;
      data.pScore = (data.pScore || 0) + right;
      data.pPaid = (data.pPaid || 0) + 1;
      score = data.pScore;
      credited = true;
    }
  } catch (e) {
    console.error("Save failed:", e);
    m.textContent = "Could not save (" + (e.code || e.message || "error") + "). Check your internet and try again.";
    $("nextBtn").textContent = "Try saving again";
    $("nextBtn").hidden = false;
    return;
  }
  saved = true;
  $("ambosh").textContent = ar(data.ambosh);
  const last = qi === set.qs.length - 1;
  const bonusNote = last ? ` (+${ar(FINISH_BONUS)} for finishing today's questions)` : "";
  if (chosen === correctIdx) {
    m.textContent = `🎉 Correct! +${ar(PER_CORRECT)} Ambosh` + bonusNote;
  } else {
    m.textContent = "Unfortunately not right. The correct answer is: ";
    const ans = document.createElement("bdi");
    ans.dir = "rtl";
    ans.textContent = set.qs[qi].o[correctIdx];
    m.appendChild(ans);
    if (last) m.append(` +${ar(FINISH_BONUS)} Ambosh for finishing today's questions`);
  }
  $("nextBtn").textContent = last ? "See my result" : "Next question ➜";
  $("nextBtn").hidden = false;
}

// If the page was closed after a pick was saved but before its points were added
async function settlePending() {
  try {
    const ref = doc(db, "users", user.uid);
    while ((data.pPaid || 0) < (data.pCount || 0) && (data.picks || []).length === data.pCount) {
      const i = data.pPaid || 0;
      const a = await fetchAnswer(data.pDay, i);
      const right = data.picks[i] === a ? 1 : 0;
      const gain = pointsFor(right, i);
      await updateDoc(ref, { ambosh: increment(gain), pScore: (data.pScore || 0) + right, pPaid: i + 1 });
      data.ambosh = (data.ambosh || 0) + gain;
      data.pScore = (data.pScore || 0) + right;
      data.pPaid = i + 1;
    }
  } catch (e) {
    console.error("Could not settle earlier answer:", e);
  }
}

$("nextBtn").onclick = () => {
  if (!saved) return saveAnswer();
  if (qi < set.qs.length - 1) { qi++; return showQuestion(); }
  showResult(true);
};

function showResult(justPlayed) {
  const s = data.pDay === today ? (data.pScore || 0) : (data.lastScore || 0);
  $("trophy").textContent = s === 3 ? "🏆" : s > 0 ? "⭐" : "📖";
  $("resultTitle").textContent = justPlayed ? `You got ${s} of 3!` : "You finished today's quiz ✅";
  const earned = s * PER_CORRECT + FINISH_BONUS;   // finishing always counts, even with 0 correct
  $("resultSub").innerHTML = (justPlayed ? `You earned ${ar(earned)} Ambosh today.` : `Today's score: ${s} of 3 · ${ar(earned)} Ambosh`) +
    `<br>Total: <b>${ar(data.ambosh || 0)} Ambosh</b> 🪙<br>Come back tomorrow for new questions! 🌅`;
  show("resultView");
}
function showDone() { showResult(false); }

/* ---------- Owner: only sees the points, gets no questions ---------- */
let adminUsers = [];
const ADJUST_STEP = 5;   // each + or − changes the points by this much
fillSelect($("adminClass"), "All classes", CLASSES.map((c) => [c, c]));
$("adminClass").onchange = renderAdmin;

async function loadAdmin() {
  $("adminRows").innerHTML = "";
  $("adminSub").textContent = "Loading...";
  $("adjMsg").textContent = "";
  show("adminView");
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("ambosh", "desc")));
    adminUsers = [];
    snap.forEach((d) => {
      const u = d.data();
      if (isOwnerEmail(u.email)) return;
      adminUsers.push({ id: d.id, ...u });
    });
    renderAdmin();
  } catch (e) {
    $("adminSub").textContent = "You do not have permission to see this list.";
  }
  loadQuizList();
}

function updateAdminSub(list) {
  const total = list.reduce((s, u) => s + (Number(u.ambosh) || 0), 0);
  $("adminSub").textContent = list.length ? `${list.length} accounts · ${ar(total)} Ambosh in total` : "No accounts yet.";
}

function renderAdmin() {
  const rows = $("adminRows");
  rows.innerHTML = "";
  const cls = $("adminClass").value;
  const list = adminUsers.filter((u) => !cls || u.cls === cls);
  list.forEach((u) => {
    const tr = document.createElement("tr");
    const c1 = document.createElement("td"); c1.className = "nm"; c1.textContent = u.name || u.email;
    const c2 = document.createElement("td"); c2.className = "cls"; c2.textContent = u.cls || "—";
    const c3 = document.createElement("td"); c3.innerHTML = `<b>${ar(Number(u.ambosh) || 0)}</b>`;
    const c4 = document.createElement("td");
    const minus = document.createElement("button"); minus.className = "pm minus"; minus.textContent = "−"; minus.title = "Take away 5";
    const plus = document.createElement("button"); plus.className = "pm plus"; plus.textContent = "+"; plus.title = "Give 5";
    minus.onclick = () => adjustAmbosh(u, -1, c3, [minus, plus]);
    plus.onclick = () => adjustAmbosh(u, 1, c3, [minus, plus]);
    c4.style.direction = "ltr";
    c4.append(plus, minus);   // + on the left, − on the right
    const c5 = document.createElement("td"); c5.textContent = u.pDay || u.lastDay || "—";
    tr.append(c1, c2, c3, c4, c5);
    rows.appendChild(tr);
  });
  updateAdminSub(list);
}

// Teacher gives (+) or takes away (-) Ambosh. The Firestore rules only let the owner change 'ambosh'.
async function adjustAmbosh(u, sign, cell, btns) {
  const m = $("adjMsg");
  m.className = "msg";
  const amt = ADJUST_STEP;
  const cur = Number(u.ambosh) || 0;
  const delta = sign > 0 ? amt : -Math.min(amt, cur);   // never below 0
  if (delta === 0) { m.textContent = (u.name || "This child") + " already has 0 Ambosh."; return; }
  btns.forEach((b) => (b.disabled = true));
  try {
    await updateDoc(doc(db, "users", u.id), { ambosh: increment(delta) });
    u.ambosh = cur + delta;
    cell.innerHTML = `<b>${ar(u.ambosh)}</b>`;
    updateAdminSub(adminUsers.filter((x) => !$("adminClass").value || x.cls === $("adminClass").value));
    m.textContent = "";
    const name = document.createElement("bdi"); name.textContent = u.name || u.email;
    m.append(delta > 0 ? `✅ Gave ${delta} Ambosh to ` : `✅ Took ${-delta} Ambosh from `, name, ` — now ${u.ambosh}`);
  } catch (e) {
    console.error("Adjust failed:", e);
    m.className = "err";
    m.textContent = "Could not change the points (" + (e.code || e.message || "error") + "). Did you publish the new firestore.rules?";
  }
  btns.forEach((b) => (b.disabled = false));
}
$("refreshBtn").onclick = loadAdmin;

/* ---------- Owner: upload the readings from the Excel sheet ---------- */
// The teacher fills ReadingsInput.xlsx (one row per day) and uploads it here.
// Columns are explained in readings.js. Needs the SheetJS script loaded in index.html.
const DAYS_PER_BATCH = 100;   // 4 writes per day; Firestore allows 500 writes per batch
$("qSave").onclick = async () => {
  const m = $("qMsg");
  m.className = "msg";
  const file = $("qFile").files[0];
  if (!file) { m.className = "err"; m.textContent = "Choose the Excel file first."; return; }
  $("qSave").disabled = true;
  try {
    if (typeof XLSX === "undefined") throw new Error("The Excel reader could not load. Check the internet and refresh the page.");
    m.textContent = "Reading the file...";
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const { days, errors } = parseReadings(rows);
    if (errors.length) {
      m.className = "err";
      m.textContent = "Nothing was saved. Please fix this in the Excel file and upload it again:\n" + errors.join("\n");
    } else if (!days.length) {
      throw new Error("No readings were found in the file.");
    } else {
      m.textContent = "Saving...";
      for (let i = 0; i < days.length; i += DAYS_PER_BATCH) {
        const batch = writeBatch(db);
        days.slice(i, i + DAYS_PER_BATCH).forEach((d) => {
          // questions (readable by children) - NO answers inside
          batch.set(doc(db, "quizzes", d.day), { ref: d.ref, qs: d.qs.map(({ q, o }) => ({ q, o })), updated: Date.now() });
          // correct answers (kept hidden by the rules until a child has answered)
          d.qs.forEach((q, k) => batch.set(doc(db, "answers", d.day, "items", String(k)), { a: q.a }));
        });
        await batch.commit();
      }
      const sorted = days.map((d) => d.day).sort();
      m.textContent = `✅ Saved ${days.length} day${days.length > 1 ? "s" : ""} (${sorted[0]}${sorted.length > 1 ? " → " + sorted[sorted.length - 1] : ""})`;
      $("qFile").value = "";
      loadQuizList();
    }
  } catch (e) {
    console.error("Upload failed:", e);
    m.className = "err";
    m.textContent = e.message || "Could not save.";
  }
  $("qSave").disabled = false;
};

async function loadQuizList() {
  const box = $("qList");
  box.innerHTML = "";
  try {
    const snap = await getDocs(collection(db, "quizzes"));
    const items = [];
    snap.forEach((d) => items.push({ day: d.id, ...d.data() }));
    items.sort((a, b) => (a.day < b.day ? 1 : -1));
    if (!items.length) { box.textContent = "No days scheduled yet."; return; }
    items.forEach((z) => {
      const row = document.createElement("div");
      row.className = "qrow";
      const label = document.createElement("span");
      label.textContent = z.day + (z.day === todayStr() ? " (today)" : "") + " · ";
      const ref = document.createElement("bdi");
      ref.textContent = z.ref;
      label.appendChild(ref);
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.onclick = async () => {
        if (!confirm("Delete the questions for " + z.day + "?")) return;
        const batch = writeBatch(db);
        batch.delete(doc(db, "quizzes", z.day));
        [0, 1, 2].forEach((i) => batch.delete(doc(db, "answers", z.day, "items", String(i))));
        await batch.commit();
        loadQuizList();
      };
      row.append(label, del);
      box.appendChild(row);
    });
  } catch (e) {
    box.textContent = "Could not load the scheduled days.";
  }
}

renderAuth();
