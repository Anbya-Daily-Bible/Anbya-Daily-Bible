import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, increment,
  collection, query, orderBy, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
  "marysafwatsobhy@gmail.com"
].map((e) => e.toLowerCase());
/* =============================================================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const views = ["authView", "quizView", "resultView", "adminView"];
const ar = (n) => String(Number(n));

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
    "auth/email-already-in-use": "That email already has an account.",
    "auth/invalid-credential": "Email or password is not right.",
    "auth/user-not-found": "Email or password is not right.",
    "auth/wrong-password": "Email or password is not right.",
    "auth/too-many-requests": "Too many tries. Please wait a moment.",
    "auth/operation-not-allowed": "Email/Password sign-in is not turned on in Firebase (Authentication → Sign-in method).",
    "auth/network-request-failed": "No internet connection. Please try again.",
    "auth/unauthorized-domain": "This website address is not allowed in Firebase (Authentication → Settings → Authorized domains)."
  };
  console.error("Auth error:", e);
  return map[e.code] || "Something went wrong (" + (e.code || "error") + "). Please try again.";
}

/* ---------- Sign in / sign up ---------- */
function renderAuth() {
  const up = mode === "signup";
  $("authBtn").textContent = up ? "Create my account" : "Sign in";
  $("switchBtn").textContent = up ? "I already have an account" : "New here? Make an account";
  $("password").autocomplete = up ? "new-password" : "current-password";
  $("authErr").textContent = "";
}
$("switchBtn").onclick = () => { mode = mode === "signin" ? "signup" : "signin"; renderAuth(); };

$("authBtn").onclick = async () => {
  const email = $("email").value.trim();
  const pw = $("password").value;
  $("authErr").textContent = "";
  $("authBtn").disabled = true;
  try {
    if (mode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      if (!isOwner(cred.user)) {
        await setDoc(doc(db, "users", cred.user.uid), {
          email: cred.user.email.toLowerCase(), ambosh: 0, joined: Date.now(),
          pDay: "", pCount: 0, pScore: 0, picks: [], pPaid: 0
        });
      }
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
  } catch (e) {
    $("authErr").textContent = friendlyError(e);
  }
  $("authBtn").disabled = false;
};
$("signOutBtn").onclick = () => signOut(auth);

/* ---------- Session ---------- */
onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) { $("password").value = ""; renderAuth(); show("authView"); return; }
  if (isOwner(u)) { loadAdmin(); return; }
  const ref = doc(db, "users", u.uid);
  try {
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        email: u.email.toLowerCase(), ambosh: 0, joined: Date.now(),
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
      const gain = chosen === correctIdx ? 1 : 0;
      await updateDoc(ref, { ambosh: increment(gain), pScore: (data.pScore || 0) + gain, pPaid: (data.pPaid || 0) + 1 });
      data.ambosh = (data.ambosh || 0) + gain;
      data.pScore = (data.pScore || 0) + gain;
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
  if (chosen === correctIdx) {
    m.textContent = "🎉 Correct! +1 Ambosh";
  } else {
    m.textContent = "Unfortunately not right. The correct answer is: ";
    const ans = document.createElement("bdi");
    ans.dir = "rtl";
    ans.textContent = set.qs[qi].o[correctIdx];
    m.appendChild(ans);
  }
  const last = qi === set.qs.length - 1;
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
      const gain = data.picks[i] === a ? 1 : 0;
      await updateDoc(ref, { ambosh: increment(gain), pScore: (data.pScore || 0) + gain, pPaid: i + 1 });
      data.ambosh = (data.ambosh || 0) + gain;
      data.pScore = (data.pScore || 0) + gain;
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
  $("resultSub").innerHTML = (justPlayed ? `You earned ${s} Ambosh today.` : `Today's score: ${s} of 3`) +
    `<br>Total: <b>${ar(data.ambosh || 0)} Ambosh</b> 🪙<br>Come back tomorrow for new questions! 🌅`;
  show("resultView");
}
function showDone() { showResult(false); }

/* ---------- Owner: only sees the points, gets no questions ---------- */
async function loadAdmin() {
  const rows = $("adminRows");
  rows.innerHTML = "";
  $("adminSub").textContent = "Loading...";
  show("adminView");
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("ambosh", "desc")));
    let total = 0, count = 0;
    snap.forEach((d) => {
      const u = d.data();
      if (isOwnerEmail(u.email)) return;
      const a = Number(u.ambosh) || 0;
      total += a; count++;
      const tr = document.createElement("tr");
      const c1 = document.createElement("td"); c1.className = "mail"; c1.textContent = u.email;
      const c2 = document.createElement("td"); c2.innerHTML = `<b>${ar(a)}</b>`;
      const c3 = document.createElement("td"); c3.textContent = u.pDay || u.lastDay || "—";
      tr.append(c1, c2, c3);
      rows.appendChild(tr);
    });
    $("adminSub").textContent = count ? `${count} accounts · ${total} Ambosh in total` : "No accounts yet.";
  } catch (e) {
    $("adminSub").textContent = "You do not have permission to see this list.";
  }
  loadQuizList();
}
$("refreshBtn").onclick = loadAdmin;

/* ---------- Owner: type the questions on the website ---------- */
// Format:
//   مرقس ١ : ١ - ٨              <- first line = the Bible reference
//   ١- السؤال الأول              <- a line without a bullet = a question
//   * صوتي                       <- lines starting with * = choices
//   * ملاكي (صح)                 <- (صح) marks the correct choice
//   * الكاهن
// Exactly 3 questions per day. Lines like 1️⃣ are ignored.
const MARK = /\(\s*(?:صح|صحيح|correct)\s*\)|✅|✔\uFE0F?/gi;
function parseQuiz(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^[0-9٠-٩]+[\uFE0F\u20E3]*$/.test(l));
  const ref = lines.shift();
  if (!ref) throw new Error("Write the Bible reference on the first line.");
  const qs = [];
  let cur = null;
  const NUM = /^[0-9٠-٩]+\s*[-.):]\s*/;
  // If the questions are numbered (١- ٢- ٣-), every other line is a choice (bullet optional).
  // If nothing is numbered, a line without a bullet is a question.
  const numbered = lines.some((l) => NUM.test(l));
  for (const l of lines) {
    const m = l.match(/^[*•▪◦●\-–]\s*(.*)$/);
    const isChoice = numbered ? !NUM.test(l) : !!m;
    if (isChoice) {
      if (!cur) throw new Error("A choice appears before any question: " + l);
      const text = m ? m[1] : l;
      const correct = new RegExp(MARK.source, "i").test(text);
      const t = text.replace(MARK, "").trim();
      if (!t) throw new Error("There is an empty choice in question " + qs.length);
      cur.o.push(t);
      if (correct) { cur.a = cur.o.length - 1; cur.c++; }
    } else {
      cur = { q: l.replace(NUM, ""), o: [], a: -1, c: 0 };
      qs.push(cur);
    }
  }
  if (qs.length !== 3) throw new Error("You need exactly 3 questions (found " + qs.length + ").");
  qs.forEach((q, i) => {
    if (q.o.length < 2) throw new Error("Question " + (i + 1) + " needs at least 2 choices.");
    if (q.c !== 1) throw new Error("Question " + (i + 1) + " needs exactly one choice marked (صح).");
  });
  return { ref, qs: qs.map(({ q, o, a }) => ({ q, o, a })) };
}
function formatQuiz(z) {
  return z.ref + "\n\n" + z.qs.map((q, i) =>
    (i + 1) + "- " + q.q + "\n" + q.o.map((o, j) => "* " + o + (j === q.a ? " (صح)" : "")).join("\n")
  ).join("\n\n");
}

$("qDate").value = todayStr();
$("qSave").onclick = async () => {
  const m = $("qMsg");
  m.className = "msg";
  try {
    const day = $("qDate").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick a date.");
    const z = parseQuiz($("qText").value);
    $("qSave").disabled = true;
    const batch = writeBatch(db);
    // questions (readable by children) - NO answers inside
    batch.set(doc(db, "quizzes", day), { ref: z.ref, qs: z.qs.map(({ q, o }) => ({ q, o })), updated: Date.now() });
    // correct answers (kept hidden by the rules until a child has answered)
    z.qs.forEach((q, i) => batch.set(doc(db, "answers", day, "items", String(i)), { a: q.a }));
    await batch.commit();
    m.textContent = "✅ Saved for " + day;
    $("qText").value = "";
    loadQuizList();
  } catch (e) {
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
      const edit = document.createElement("button");
      edit.textContent = "Edit";
      edit.onclick = async () => {
        const qs = await Promise.all(z.qs.map(async (q, i) => {
          let a = q.a;   // old-format quizzes still have the answer inside
          try {
            const s = await getDoc(doc(db, "answers", z.day, "items", String(i)));
            if (s.exists()) a = s.data().a;
          } catch (e) {}
          return { ...q, a };
        }));
        $("qDate").value = z.day; $("qText").value = formatQuiz({ ...z, qs }); window.scrollTo(0, 0);
      };
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
      row.append(label, edit, del);
      box.appendChild(row);
    });
  } catch (e) {
    box.textContent = "Could not load the scheduled days.";
  }
}

renderAuth();
