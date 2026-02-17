// ──────────────────────────────────────────────────────────────
//  [수정 안내] 기존 app.js / admin.js 에 아래 내용을 적용하세요
// ──────────────────────────────────────────────────────────────

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  1) app.js (index.html용) — 기존 onAuthStateChanged 교체
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  기존 코드:
//    onAuthStateChanged(auth, (u) => {
//      if (u) {
//        $("authView").classList.add("hidden");
//        $("dashView").classList.remove("hidden");
//        globalRefresh();
//      } else {
//        $("authView").classList.remove("hidden");
//        $("dashView").classList.add("hidden");
//      }
//    });
//
//  ▼ 아래 코드로 교체 ▼

onAuthStateChanged(auth, (u) => {
  if (u) {
    // 로그인 상태 → 대시보드 표시
    if ($("authView")) $("authView").classList.add("hidden");
    if ($("dashView")) $("dashView").classList.remove("hidden");
    globalRefresh();
  } else {
    // 비로그인 → login.html 로 이동
    window.location.href = "login.html";
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  2) admin.js — 기존 onAuthStateChanged 교체
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  기존 코드:
//    onAuthStateChanged(auth, async (user) => {
//      if (!user) {
//        $("loginView").style.display = "flex";
//        $("adminView").style.display = "none";
//        ...
//      }
//    });
//
//  ▼ 아래 코드로 교체 ▼

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // 비로그인 → login.html 로 이동
    window.location.href = "login.html";
    return;
  }

  // 역할 확인
  const role = await getUserRole(user);
  if (!role) {
    alert("관리자 권한이 없습니다.");
    signOut(auth);
    return;
  }

  currentRole = role;
  $("topbarUser").textContent = user.email;
  $("adminView").style.display = "block";
  applyRoleUI(role);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  3) index.html — authView 섹션 제거 (선택 사항)
//
//  login.html로 로그인을 분리했으므로 index.html의
//  <section id="authView"> 블록 전체를 삭제해도 됩니다.
//  (삭제하지 않아도 hidden 처리되므로 기능상 무관합니다)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  4) admin.html — loginView 섹션 제거 (선택 사항)
//
//  admin.html의 <div id="loginView"> 블록 전체를 삭제해도 됩니다.
//  admin.js에서 loginBtn 이벤트도 함께 제거해주세요.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  5) 로그아웃 후 login.html 이동
//
//  app.js / admin.js 의 로그아웃 버튼 이벤트를 아래처럼 교체:
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// app.js 의 로그아웃
$("logoutBtn").onclick = () => signOut(auth).then(() => { window.location.href = "login.html"; });

// admin.js 의 로그아웃
$("logoutBtn").onclick = () => signOut(auth).then(() => { window.location.href = "login.html"; });
