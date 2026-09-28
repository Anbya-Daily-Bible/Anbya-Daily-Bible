import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp,
  Timestamp, collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { START_DATE, SETS } from "./questions.js";

/* ============ 1) PASTE YOUR FIREBASE SETTINGS HERE ============ */
const firebaseConfig = {
  apiKey: "AIzaSyBvGbibgzjZr9X9dovCG3K9yFozl4fwiPQ",
  authDomain: "anbya-daily-bible.firebaseapp.com",
  projectId: "anbya-daily-bible",
  storageBucket: "anbya-daily-bible.firebasestorage.app",
  messagingSenderId: "216663190113",
  appId: "1:216663190113:web:67d9efd0d987209ef85820",
  measurementId: "G-C6M39N9GPY"
};

/* ============ 2) YOUR (OWNER) EMAIL — must match firestore.rules ============ */
const OWNER_EMAIL = "pierre2006hany@gmail.com";
/* =============================================================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const views = ["authView", "quizView", "resultView", "adminView"];
const ar = (n) => Number(n).toLocaleString("ar-EG");
const NEVER = () => Timestamp.fromDate(new Date(2000, 0, 1));

let mode = "signin";
let user = null;
let data = null;            // the child's saved document
let today = "";
let set = null;             // today's quiz
let qi = 0, score = 0, answered = false;

/* ---------- Helpers ---------- */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function todaysSet() {
  const [sy, sm, sd] = START_DATE.split("-").map(Number);
  const [ty, tm, td] = todayStr().split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / 86400000);
  return SETS[((Math.max(days, 0)) % SETS.length + SETS.length) % SETS.length];
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const isOwner = (u) => !!(u && u.email && u.email.toLowerCase() === OWNER_EMAIL.toLowerCase());
function show(name) {
  $("boot").hidden = true;
  views.forEach((v) => ($(v).hidden = v !== name));
  $("footer").hidden = name === "authView";
}
function friendlyError(e) {
  const map = {
    "auth/invalid-email": "من فضلك اكتب بريداً إلكترونياً صحيحاً.",
    "auth/missing-password": "من فضلك اكتب كلمة المرور.",
    "auth/weak-password": "كلمة المرور لازم تكون ٦ أحرف على الأقل.",
    "auth/email-already-in-use": "هذا البريد لديه حساب بالفعل.",
    "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
    "auth/user-not-found": "البريد أو كلمة المرور غير صحيحة.",
    "auth/wrong-password": "البريد أو كلمة المرور غير صحيحة.",
    "auth/too-many-requests": "محاولات كثيرة. انتظر قليلاً."
  };
  return map[e.code] || "حدث خطأ. حاول مرة أخرى.";
}

/* ---------- Sign in / sign up ---------- */
function renderAuth() {
  const up = mode === "signup";
  $("authBtn").textContent = up ? "إنشاء حسابي" : "تسجيل الدخول";
  $("switchBtn").textContent = up ? "لدي حساب بالفعل" : "جديد هنا؟ أنشئ حساباً";
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
          lastDay: "", lastScore: 0, lastPlay: NEVER()
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
        lastDay: "", lastScore: 0, lastPlay: NEVER()
      });
      snap = await getDoc(ref);
    }
    data = snap.data();
  } catch (e) {
    data = { ambosh: 0, lastDay: "", lastScore: 0 };
  }
  today = todayStr();
  if (data.lastDay === today) showDone(); else startQuiz();
});

/* ---------- Daily quiz ---------- */
function startQuiz() {
  set = todaysSet();
  qi = 0; score = 0;
  showQuestion();
}

function showQuestion() {
  const q = set.qs[qi];
  answered = false;
  $("qCount").textContent = `سؤال ${ar(qi + 1)} من ${ar(set.qs.length)}`;
  $("ambosh").textContent = ar((data.ambosh || 0) + score);
  $("ref").textContent = `📖 ${set.ref}`;
  $("verse").textContent = q.q;
  $("msg").textContent = "";
  $("nextBtn").hidden = true;
  const box = $("options");
  box.innerHTML = "";
  shuffle(q.o).forEach((name) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = name;
    b.onclick = () => pick(b, name);
    box.appendChild(b);
  });
  show("quizView");
}

function pick(btn, name) {
  if (answered) return;
  answered = true;
  const q = set.qs[qi];
  const right = q.o[q.a];
  document.querySelectorAll(".opt").forEach((b) => { if (b.textContent === right) b.classList.add("good"); });
  if (name === right) {
    score++;
    $("ambosh").textContent = ar((data.ambosh || 0) + score);
    $("msg").textContent = "🎉 إجابة صحيحة! +١ أمبوش";
  } else {
    btn.classList.add("bad");
    $("msg").textContent = `ليست هذه المرة. الإجابة الصحيحة: ${right}`;
  }
  const last = qi === set.qs.length - 1;
  $("nextBtn").textContent = last ? "شاهد نتيجتي" : "السؤال التالي ➜";
  $("nextBtn").hidden = false;
}

$("nextBtn").onclick = async () => {
  if (qi < set.qs.length - 1) { qi++; return showQuestion(); }
  // Last question: save today's score once
  $("nextBtn").disabled = true;
  try {
    await updateDoc(doc(db, "users", user.uid), {
      ambosh: increment(score), lastDay: today, lastScore: score, lastPlay: serverTimestamp()
    });
    data.ambosh = (data.ambosh || 0) + score;
    data.lastDay = today;
    data.lastScore = score;
    showResult(true);
  } catch (e) {
    $("msg").textContent = "تعذر الحفظ. تأكد من الإنترنت ثم اضغط مرة أخرى.";
  }
  $("nextBtn").disabled = false;
};

function showResult(justPlayed) {
  const s = data.lastScore || 0;
  $("trophy").textContent = s === 3 ? "🏆" : s > 0 ? "⭐" : "📖";
  $("resultTitle").textContent = justPlayed ? `حصلت على ${ar(s)} من ٣!` : "لقد أنهيت اختبار اليوم ✅";
  $("resultSub").innerHTML = (justPlayed ? `كسبت ${ar(s)} أمبوش اليوم.` : `نتيجتك اليوم: ${ar(s)} من ٣`) +
    `<br>المجموع: <b>${ar(data.ambosh || 0)} أمبوش</b> 🪙<br>تعال غداً لأسئلة جديدة! 🌅`;
  show("resultView");
}
function showDone() { showResult(false); }

/* ---------- Owner: only sees the points, gets no questions ---------- */
async function loadAdmin() {
  const rows = $("adminRows");
  rows.innerHTML = "";
  $("adminSub").textContent = "جارٍ التحميل...";
  show("adminView");
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("ambosh", "desc")));
    let total = 0, count = 0;
    snap.forEach((d) => {
      const u = d.data();
      if ((u.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase()) return;
      const a = Number(u.ambosh) || 0;
      total += a; count++;
      const tr = document.createElement("tr");
      const c1 = document.createElement("td"); c1.className = "mail"; c1.textContent = u.email;
      const c2 = document.createElement("td"); c2.innerHTML = `<b>${ar(a)}</b>`;
      const c3 = document.createElement("td"); c3.textContent = u.lastDay || "—";
      tr.append(c1, c2, c3);
      rows.appendChild(tr);
    });
    $("adminSub").textContent = count ? `${ar(count)} حساب · ${ar(total)} أمبوش في المجموع` : "لا توجد حسابات بعد.";
  } catch (e) {
    $("adminSub").textContent = "ليس لديك صلاحية لرؤية هذه القائمة.";
  }
}
$("refreshBtn").onclick = loadAdmin;

renderAuth();
