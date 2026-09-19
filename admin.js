import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, collection,
  getDocs, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig, HEAD_ADMIN_EMAIL, CF_BASE } from "./config.js";

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

const CREATE_USER_URL   = `${CF_BASE}/createUser`;
const ADMIN_RANKING_URL = `${CF_BASE}/getAdminRanking`;

const $ = (id) => document.getElementById(id);
const money   = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// onclick 속성 내 JS 문자열 인자로 안전하게 전달 (JSON.stringify → HTML 이스케이프)
const escAttr = (s) => escHtml(JSON.stringify(String(s)));

function showAlert(id, msg, type = "info") {
  const el = $(id);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
  setTimeout(() => { el.className = `alert alert-${type}`; }, 4000);
}

// ── 탭 전환 ──────────────────────────────────────────────────
window.switchTab = function(tabName) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  const content = $(`tab-${tabName}`);
  if (content) content.classList.add("active");
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add("active");

  if (tabName === "students") loadStudents();
  if (tabName === "ranking")  loadAllRanking();
};

// ── 로그아웃 ──────────────────────────────────────────────────
$("logoutBtn").onclick = () => signOut(auth).then(() => { window.location.href = "login.html"; });

// ── 인증 상태 감지 ────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (user.email !== HEAD_ADMIN_EMAIL) {
    alert("관리자 권한이 없습니다.");
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }

  $("topbarUser").textContent = user.email;
  $("roleBadge").textContent = "ADMIN";
  $("roleBadge").className = "role-badge badge-head";
  switchTab("students");
});

// ══════════════════════════════════════════════════════════════
//  학생 관리
// ══════════════════════════════════════════════════════════════

window.loadStudents = async function () {
  try {
    const snap = await getDocs(collection(db, "users"));
    const listEl = $("studentList");
    if (snap.empty) { listEl.innerHTML = `<div class="empty-state">등록된 학생이 없습니다.</div>`; return; }
    listEl.innerHTML = snap.docs.map(d => {
      const data = d.data();
      return `
        <div class="data-item">
          <div class="data-item-left">
            <div class="data-item-name">${escHtml(data.nickname || d.id)}</div>
            <div class="data-item-sub">${escHtml(d.id)}</div>
          </div>
          <div class="data-item-right">
            <span style="font-size:13px; font-weight:700; color:var(--accent);">${money(data.totalAsset)}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteStudent(${escAttr(d.id)}, ${escAttr(data.nickname || d.id)})">삭제</button>
          </div>
        </div>`;
    }).join("");
  } catch (e) { console.error("학생 로드 실패:", e); }
};

window.createStudent = async function () {
  const email = $("newStudentEmail").value.trim();
  const pw    = $("newStudentPw").value.trim();
  const nick  = $("newStudentNick").value.trim();
  if (!email || !pw || !nick) return showAlert("studentAddAlert", "모든 항목을 입력하세요.", "error");
  if (pw.length < 6) return showAlert("studentAddAlert", "비밀번호는 6자 이상이어야 합니다.", "error");

  const btn = $("createStudentBtn");
  if (btn) btn.disabled = true;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ data: { email, password: pw, role: "student", nickname: nick } })
    });
    const result = await res.json();
    if (!result.data?.success) throw new Error(result.data?.error || "생성 실패");
    $("newStudentEmail").value = $("newStudentPw").value = $("newStudentNick").value = "";
    showAlert("studentAddAlert", `학생 "${nick}" (${email}) 계정 생성 완료`, "success");
    loadStudents();
  } catch (e) { showAlert("studentAddAlert", "생성 실패: " + e.message, "error"); }
  finally { if (btn) btn.disabled = false; }
};

// 유저 문서 삭제 전, portfolio/history 서브컬렉션을 먼저 비움
// (부모 문서만 지우면 서브컬렉션이 남아, 같은 이메일로 재가입 시 이전 데이터가 그대로 노출됨)
async function deleteUserSubcollections(email) {
  for (const sub of ["portfolio", "history"]) {
    const snap = await getDocs(collection(db, "users", email, sub));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  }
}

window.deleteStudent = async function (email, name) {
  if (!confirm(`"${name}" 학생 계정을 삭제할까요?`)) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ data: { action: "DELETE_BY_EMAIL", email } })
    });
    const result = await res.json();
    if (!result.data?.success) throw new Error(result.data?.error || "계정 삭제 실패");
    await deleteUserSubcollections(email);
    await deleteDoc(doc(db, "users", email));
    showAlert("studentAddAlert", `"${name}" 삭제 완료`, "info");
    loadStudents();
  } catch (e) { showAlert("studentAddAlert", "삭제 실패: " + e.message, "error"); }
};

// ══════════════════════════════════════════════════════════════
//  전체 랭킹
// ══════════════════════════════════════════════════════════════

window.loadAllRanking = async function () {
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${ADMIN_RANKING_URL}?type=all`, {
      headers: { "Authorization": `Bearer ${idToken}` }
    });
    const data = await res.json();
    const listEl = $("allRankList");
    if (!data.ok || !data.ranking.length) {
      listEl.innerHTML = `<div class="empty-state">랭킹 데이터가 없습니다.</div>`; return;
    }
    listEl.innerHTML = data.ranking.map((rd, i) => {
      const rankClass = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      return `
        <div class="rank-item">
          <div class="rank-num ${rankClass}">${medal}</div>
          <div class="rank-info"><div class="rank-name">${escHtml(rd.nickname)}</div></div>
          <div class="rank-asset" style="font-family: 'Noto Sans KR', sans-serif;">${money(rd.totalAsset)}</div>
        </div>`;
    }).join("");
  } catch (e) { $("allRankList").innerHTML = `<div class="empty-state">로드 실패</div>`; }
};
