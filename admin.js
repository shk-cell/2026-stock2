import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, collection,
  getDocs, query, orderBy, limit, where, deleteDoc
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
let currentRole  = null;
let currentSchool = null;
let currentSchoolName = null;
let currentSchoolDomain = null;

const $ = (id) => document.getElementById(id);
const money = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// onclick 속성 내 문자열 인수 이스케이프 (작은따옴표·백슬래시)
const jsq = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

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

  if (tabName === "overview")      loadOverview();
  if (tabName === "schools")       loadSchools();
  if (tabName === "middleAdmins")  loadMiddleAdmins();
  if (tabName === "myStudents")    loadMyStudents();
  if (tabName === "schoolRanking") loadSchoolRanking();
  if (tabName === "allRanking")    loadAllRanking();
};

// ── 역할에 따라 탭 표시 ───────────────────────────────────────
function applyRoleUI(role) {
  const headEls   = document.querySelectorAll(".head-only");
  const middleEls = document.querySelectorAll(".middle-only");

  if (role === "head") {
    headEls.forEach(el => el.classList.remove("hidden"));
    middleEls.forEach(el => el.classList.add("hidden"));
    $("roleBadge").textContent = "HEAD ADMIN";
    $("roleBadge").className = "role-badge badge-head";
    switchTab("overview");

  } else if (role === "middle") {
    headEls.forEach(el => el.classList.add("hidden"));
    middleEls.forEach(el => el.classList.remove("hidden"));
    $("roleBadge").textContent = `MIDDLE ADMIN · ${currentSchoolName || ""}`;
    $("roleBadge").className = "role-badge badge-middle";
    if ($("myStudentTitle")) $("myStudentTitle").textContent = `${currentSchoolName || ""} 학생 관리`;
    if ($("schoolRankTitle")) $("schoolRankTitle").textContent = `${currentSchoolName || ""} 랭킹`;
    switchTab("myStudents");
  }
}

// ── 로그아웃 ──────────────────────────────────────────────────
$("logoutBtn").onclick = () => signOut(auth).then(() => { window.location.href = "login.html"; });

// ── 인증 상태 감지 ────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const role = await getUserRole(user);
  if (!role) {
    alert("관리자 권한이 없습니다.");
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }

  currentRole = role;
  $("topbarUser").textContent = user.email;
  applyRoleUI(role);
});

// ── 역할 판별 ─────────────────────────────────────────────────
async function getUserRole(user) {
  if (user.email === HEAD_ADMIN_EMAIL) return "head";
  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      currentSchool = data.school || null;
      if (currentSchool) {
        const schoolSnap = await getDoc(doc(db, "schools", currentSchool));
        if (schoolSnap.exists()) {
          currentSchoolName = schoolSnap.data().name;
          currentSchoolDomain = schoolSnap.data().domain || null;
          // 학생 생성 폼 도메인 라벨 업데이트
          if ($("domainLabel") && currentSchoolDomain) {
            $("domainLabel").textContent = `@${currentSchoolDomain}`;
          }
        }
      }
      return data.role || null;
    }
  } catch (e) { console.error("역할 조회 실패:", e); }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  HEAD ADMIN 기능
// ══════════════════════════════════════════════════════════════

window.loadOverview = async function () {
  try {
    const schoolsSnap  = await getDocs(collection(db, "schools"));
    const adminsSnap   = await getDocs(query(collection(db, "admins"), where("role", "==", "middle")));
    const usersSnap    = await getDocs(query(collection(db, "users"), where("role", "==", "student")));

    $("statSchools").textContent  = schoolsSnap.size;
    $("statMiddle").textContent   = adminsSnap.size;
    $("statStudents").textContent = usersSnap.size;

    const schoolMap = {};
    schoolsSnap.forEach(s => { schoolMap[s.id] = { name: s.data().name, count: 0 }; });
    usersSnap.forEach(u => {
      const school = u.data().school;
      if (school && schoolMap[school]) schoolMap[school].count++;
    });

    const listEl = $("schoolOverviewList");
    const entries = Object.entries(schoolMap);
    if (!entries.length) { listEl.innerHTML = `<div class="empty-state">등록된 학교가 없습니다.</div>`; return; }
    listEl.innerHTML = entries.map(([id, info]) => `
      <div class="data-item">
        <div class="data-item-left">
          <div class="data-item-name">${info.name}</div>
          <div class="data-item-sub">ID: ${id}</div>
        </div>
        <div class="data-item-right"><span class="tag tag-school">${info.count}명</span></div>
      </div>`).join("");
  } catch (e) { console.error("현황 로드 실패:", e); }
};

window.loadSchools = async function () {
  try {
    const snap = await getDocs(collection(db, "schools"));
    const listEl = $("schoolList");
    if (snap.empty) { listEl.innerHTML = `<div class="empty-state">등록된 학교가 없습니다.</div>`; return; }
    listEl.innerHTML = snap.docs.map(d => `
      <div class="data-item">
        <div class="data-item-left">
          <div class="data-item-name">${d.data().name}</div>
          <div class="data-item-sub">ID: ${d.id} · @${d.data().domain || '도메인 없음'}</div>
        </div>
        <div class="data-item-right">
          <button class="btn btn-danger btn-sm" onclick="deleteSchool('${jsq(d.id)}','${jsq(d.data().name)}')">삭제</button>
        </div>
      </div>`).join("");
    refreshSchoolSelect(snap.docs);
  } catch (e) { console.error("학교 로드 실패:", e); }
};

function refreshSchoolSelect(schoolDocs) {
  const sel = $("newMiddleSchool");
  if (!sel) return;
  sel.innerHTML = `<option value="">학교 선택</option>`;
  schoolDocs.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().name;
    sel.appendChild(opt);
  });
}

window.addSchool = async function () {
  const id     = $("newSchoolId").value.trim().toLowerCase().replace(/\s+/g, "-");
  const name   = $("newSchoolName").value.trim();
  if (!id || !name) return showAlert("schoolAddAlert", "ID와 학교 이름을 모두 입력하세요.", "error");
  if (!/^[a-z0-9\-]+$/.test(id)) return showAlert("schoolAddAlert", "학교 ID는 영문 소문자, 숫자, 하이픈만 사용 가능합니다.", "error");
  const domain = ($("newSchoolDomain").value.trim()) || `${id}.com`;
  try {
    const ref = doc(db, "schools", id);
    if ((await getDoc(ref)).exists()) return showAlert("schoolAddAlert", "이미 존재하는 학교 ID입니다.", "error");
    await setDoc(ref, { name, domain, createdAt: new Date() });
    $("newSchoolId").value = $("newSchoolName").value = $("newSchoolDomain").value = "";
    showAlert("schoolAddAlert", `"${name}" 등록 완료 (도메인: @${domain})`, "success");
    loadSchools();
  } catch (e) { showAlert("schoolAddAlert", "등록 실패: " + e.message, "error"); }
};

window.deleteSchool = async function (id, name) {
  if (!confirm(`"${name}" 학교를 삭제할까요?`)) return;
  try {
    await deleteDoc(doc(db, "schools", id));
    showAlert("schoolAddAlert", `"${name}" 삭제 완료`, "info");
    loadSchools();
  } catch (e) { showAlert("schoolAddAlert", "삭제 실패: " + e.message, "error"); }
};

window.loadMiddleAdmins = async function () {
  try {
    const schoolsSnap = await getDocs(collection(db, "schools"));
    refreshSchoolSelect(schoolsSnap.docs);
    const schoolMap = {};
    schoolsSnap.forEach(s => { schoolMap[s.id] = s.data().name; });

    const snap = await getDocs(query(collection(db, "admins"), where("role", "==", "middle")));
    const listEl = $("middleAdminList");
    if (snap.empty) { listEl.innerHTML = `<div class="empty-state">등록된 미들어드민이 없습니다.</div>`; return; }
    listEl.innerHTML = snap.docs.map(d => {
      const data = d.data();
      const schoolName = schoolMap[data.school] || data.school || "미지정";
      return `
        <div class="data-item">
          <div class="data-item-left">
            <div class="data-item-name">${data.email || d.id}</div>
            <div class="data-item-sub">${schoolName}</div>
          </div>
          <div class="data-item-right">
            <span class="tag tag-school">${schoolName}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteMiddleAdmin('${jsq(d.id)}','${jsq(data.email)}')">삭제</button>
          </div>
        </div>`;
    }).join("");
  } catch (e) { console.error("미들어드민 로드 실패:", e); }
};

window.createMiddleAdmin = async function () {
  const email  = $("newMiddleEmail").value.trim();
  const pw     = $("newMiddlePw").value.trim();
  const school = $("newMiddleSchool").value;
  if (!email || !pw || !school) return showAlert("middleAddAlert", "모든 항목을 입력하세요.", "error");
  if (pw.length < 6) return showAlert("middleAddAlert", "비밀번호는 6자 이상이어야 합니다.", "error");
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ data: { email, password: pw, role: "middle", school } })
    });
    const result = await res.json();
    if (!result.data?.success) throw new Error(result.data?.error || "생성 실패");
    $("newMiddleEmail").value = $("newMiddlePw").value = "";
    $("newMiddleSchool").value = "";
    showAlert("middleAddAlert", `미들어드민 "${email}" 생성 완료`, "success");
    loadMiddleAdmins();
  } catch (e) { showAlert("middleAddAlert", "생성 실패: " + e.message, "error"); }
};

window.deleteMiddleAdmin = async function (uid, email) {
  if (!confirm(`"${email}" 미들어드민을 삭제할까요?`)) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ data: { action: "DELETE", uid } })
    });
    await deleteDoc(doc(db, "admins", uid));
    showAlert("middleAddAlert", `"${email}" 삭제 완료`, "info");
    loadMiddleAdmins();
  } catch (e) { showAlert("middleAddAlert", "삭제 실패: " + e.message, "error"); }
};

// ══════════════════════════════════════════════════════════════
//  MIDDLE ADMIN 기능
// ══════════════════════════════════════════════════════════════

window.loadMyStudents = async function () {
  if (!currentSchool) return;
  try {
    const snap = await getDocs(
      query(collection(db, "users"), where("school", "==", currentSchool), where("role", "==", "student"))
    );
    const listEl = $("studentList");
    if (snap.empty) { listEl.innerHTML = `<div class="empty-state">등록된 학생이 없습니다.</div>`; return; }
    listEl.innerHTML = snap.docs.map(d => {
      const data = d.data();
      return `
        <div class="data-item">
          <div class="data-item-left">
            <div class="data-item-name">${data.nickname || d.id}</div>
            <div class="data-item-sub">${d.id}</div>
          </div>
          <div class="data-item-right">
            <span style="font-size:13px; font-weight:700; color:var(--accent);">${money(data.totalAsset)}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteStudent('${jsq(d.id)}','${jsq(data.nickname || d.id)}')">삭제</button>
          </div>
        </div>`;
    }).join("");
  } catch (e) { console.error("학생 로드 실패:", e); }
};

window.createStudent = async function () {
  const prefix = $("newStudentPrefix").value.trim().toLowerCase();
  const pw     = $("newStudentPw").value.trim();
  const nick   = $("newStudentNick").value.trim();
  if (!prefix || !pw || !nick) return showAlert("studentAddAlert", "모든 항목을 입력하세요.", "error");
  if (pw.length < 6) return showAlert("studentAddAlert", "비밀번호는 6자 이상이어야 합니다.", "error");
  if (!currentSchoolDomain) return showAlert("studentAddAlert", "학교 도메인 정보가 없습니다. 관리자에게 문의하세요.", "error");
  if (!/^[a-z0-9]+$/.test(prefix)) return showAlert("studentAddAlert", "아이디는 영문 소문자와 숫자만 사용 가능합니다.", "error");

  const email = `${prefix}@${currentSchoolDomain}`;

  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ data: { email, password: pw, role: "student", school: currentSchool, nickname: nick } })
    });
    const result = await res.json();
    if (!result.data?.success) throw new Error(result.data?.error || "생성 실패");
    $("newStudentPrefix").value = $("newStudentPw").value = $("newStudentNick").value = "";
    showAlert("studentAddAlert", `학생 "${nick}" (${email}) 계정 생성 완료`, "success");
    loadMyStudents();
  } catch (e) { showAlert("studentAddAlert", "생성 실패: " + e.message, "error"); }
};

window.deleteStudent = async function (email, name) {
  if (!confirm(`"${name}" 학생 계정을 삭제할까요?`)) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({ data: { action: "DELETE_BY_EMAIL", email } })
    });
    await deleteDoc(doc(db, "users", email));
    showAlert("studentAddAlert", `"${name}" 삭제 완료`, "info");
    loadMyStudents();
  } catch (e) { showAlert("studentAddAlert", "삭제 실패: " + e.message, "error"); }
};

window.loadSchoolRanking = async function () {
  if (!currentSchool) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${ADMIN_RANKING_URL}?type=school&school=${currentSchool}`, {
      headers: { "Authorization": `Bearer ${idToken}` }
    });
    const data = await res.json();
    const listEl = $("schoolRankList");
    if (!data.ok || !data.ranking.length) {
      listEl.innerHTML = `<div class="empty-state">랭킹 데이터가 없습니다.</div>`; return;
    }
    listEl.innerHTML = data.ranking.map((rd, i) => {
      const rankClass = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      return `
        <div class="rank-item">
          <div class="rank-num ${rankClass}">${medal}</div>
          <div class="rank-info"><div class="rank-name">${rd.nickname}</div><div class="rank-school">${rd.id}</div></div>
          <div class="rank-asset" style="font-family: 'Noto Sans KR', sans-serif;">${money(rd.totalAsset)}</div>
        </div>`;
    }).join("");
  } catch (e) { $("schoolRankList").innerHTML = `<div class="empty-state">로드 실패</div>`; }
};

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
          <div class="rank-info"><div class="rank-name">${rd.nickname}</div><div class="rank-school">${rd.school}</div></div>
          <div class="rank-asset" style="font-family: 'Noto Sans KR', sans-serif;">${money(rd.totalAsset)}</div>
        </div>`;
    }).join("");
  } catch (e) { $("allRankList").innerHTML = `<div class="empty-state">로드 실패</div>`; }
};
