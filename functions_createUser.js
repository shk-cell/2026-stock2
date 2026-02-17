/**
 * 모의투자 시스템 - Cloud Functions
 *
 * 기존 함수: tradeStock, quote (그대로 유지)
 * 신규 함수: createUser (계정 생성/삭제 통합 관리)
 *
 * 배포 방법:
 *   cd functions
 *   npm install
 *   firebase deploy --only functions:createUser
 */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// firebase-admin이 이미 초기화되어 있지 않으면 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const authAdmin = admin.auth();

// ── Head Admin 이메일 (admin.js와 동일하게 맞춰주세요) ────────
const HEAD_ADMIN_EMAIL = "YOUR_HEAD_ADMIN_EMAIL@example.com";

// ── CORS 허용 헤더 ────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─────────────────────────────────────────────────────────────
//  createUser Cloud Function
//
//  역할:
//    - HEAD ADMIN만 middle admin 계정 생성/삭제 가능
//    - HEAD ADMIN & MIDDLE ADMIN이 student 계정 생성/삭제 가능
//    - MIDDLE ADMIN은 자기 학교 학생만 생성 가능
//
//  요청 body (data 래핑):
//    계정 생성: { email, password, role, school?, nickname? }
//    uid로 삭제: { action: "DELETE", uid }
//    이메일로 삭제: { action: "DELETE_BY_EMAIL", email }
// ─────────────────────────────────────────────────────────────
exports.createUser = onRequest(
  { region: "asia-northeast3", cors: false },
  async (req, res) => {
    // OPTIONS preflight 처리
    if (req.method === "OPTIONS") {
      res.set(CORS_HEADERS).status(204).send("");
      return;
    }
    res.set(CORS_HEADERS);

    if (req.method !== "POST") {
      return res.status(405).json({ data: { success: false, error: "Method not allowed" } });
    }

    try {
      // 1. Authorization 헤더에서 ID 토큰 추출
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ data: { success: false, error: "인증 토큰이 필요합니다." } });
      }
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await authAdmin.verifyIdToken(idToken);
      const callerUid = decodedToken.uid;
      const callerEmail = decodedToken.email;

      // 2. 호출자 역할 확인
      let callerRole = null;
      let callerSchool = null;

      if (callerEmail === HEAD_ADMIN_EMAIL) {
        callerRole = "head";
      } else {
        const adminSnap = await db.collection("admins").doc(callerUid).get();
        if (adminSnap.exists) {
          callerRole = adminSnap.data().role;
          callerSchool = adminSnap.data().school;
        }
      }

      if (!callerRole) {
        return res.status(403).json({ data: { success: false, error: "권한이 없습니다." } });
      }

      const payload = req.body.data || {};

      // ── 삭제 액션 처리 ──────────────────────────────────────
      if (payload.action === "DELETE" || payload.action === "DELETE_BY_EMAIL") {
        return await handleDelete(payload, callerRole, callerSchool, res);
      }

      // ── 계정 생성 처리 ──────────────────────────────────────
      return await handleCreate(payload, callerRole, callerSchool, res);

    } catch (e) {
      console.error("createUser 오류:", e);
      return res.status(500).json({ data: { success: false, error: e.message } });
    }
  }
);

// ── 계정 생성 핸들러 ─────────────────────────────────────────
async function handleCreate(payload, callerRole, callerSchool, res) {
  const { email, password, role, school, nickname } = payload;

  if (!email || !password || !role) {
    return res.status(400).json({ data: { success: false, error: "email, password, role은 필수입니다." } });
  }
  if (password.length < 6) {
    return res.status(400).json({ data: { success: false, error: "비밀번호는 6자 이상이어야 합니다." } });
  }

  // 권한 검사
  if (role === "middle") {
    // 미들어드민 생성은 HEAD ADMIN만 가능
    if (callerRole !== "head") {
      return res.status(403).json({ data: { success: false, error: "미들어드민 생성은 Head Admin만 가능합니다." } });
    }
    if (!school) {
      return res.status(400).json({ data: { success: false, error: "담당 학교를 지정해야 합니다." } });
    }
    // 학교 존재 확인
    const schoolSnap = await db.collection("schools").doc(school).get();
    if (!schoolSnap.exists) {
      return res.status(400).json({ data: { success: false, error: "존재하지 않는 학교 ID입니다." } });
    }
  } else if (role === "student") {
    // 학생 생성은 HEAD 또는 MIDDLE 가능
    if (callerRole !== "head" && callerRole !== "middle") {
      return res.status(403).json({ data: { success: false, error: "학생 생성 권한이 없습니다." } });
    }
    // MIDDLE ADMIN은 자기 학교만 가능
    if (callerRole === "middle" && school !== callerSchool) {
      return res.status(403).json({ data: { success: false, error: "다른 학교의 학생은 생성할 수 없습니다." } });
    }
    if (!school) {
      return res.status(400).json({ data: { success: false, error: "학교를 지정해야 합니다." } });
    }
  } else {
    return res.status(400).json({ data: { success: false, error: "지원하지 않는 role입니다." } });
  }

  // Firebase Auth 계정 생성
  let newUser;
  try {
    newUser = await authAdmin.createUser({ email, password });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      return res.status(400).json({ data: { success: false, error: "이미 사용 중인 이메일입니다." } });
    }
    throw e;
  }

  const uid = newUser.uid;

  // Firestore 저장
  if (role === "middle") {
    // admins 컬렉션에 미들어드민 정보 저장
    await db.collection("admins").doc(uid).set({
      role: "middle",
      email,
      school,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else if (role === "student") {
    // users 컬렉션에 학생 정보 저장 (기존 구조 유지 + school, role 추가)
    await db.collection("users").doc(email).set({
      cash: 70000,
      totalAsset: 70000,
      nickname: nickname || email.split("@")[0],
      school,
      role: "student",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  console.log(`[createUser] ${role} 계정 생성: ${email} (school: ${school || "N/A"})`);
  return res.status(200).json({ data: { success: true, uid } });
}

// ── 계정 삭제 핸들러 ─────────────────────────────────────────
async function handleDelete(payload, callerRole, callerSchool, res) {
  let targetUid = payload.uid;
  let targetEmail = payload.email;

  // 이메일로 삭제 시 uid 조회
  if (payload.action === "DELETE_BY_EMAIL" && targetEmail) {
    try {
      const userRecord = await authAdmin.getUserByEmail(targetEmail);
      targetUid = userRecord.uid;
    } catch (e) {
      // Auth에 없어도 Firestore만 삭제 시도
      console.warn(`Auth에서 ${targetEmail} 조회 실패:`, e.message);
    }
  }

  // MIDDLE ADMIN은 자기 학교 학생만 삭제 가능
  if (callerRole === "middle" && targetEmail) {
    const userSnap = await db.collection("users").doc(targetEmail).get();
    if (userSnap.exists && userSnap.data().school !== callerSchool) {
      return res.status(403).json({ data: { success: false, error: "다른 학교 학생은 삭제할 수 없습니다." } });
    }
  }

  // HEAD ADMIN만 어드민 계정 삭제 가능
  if (callerRole !== "head" && !targetEmail) {
    return res.status(403).json({ data: { success: false, error: "관리자 삭제 권한이 없습니다." } });
  }

  // Firebase Auth 삭제
  if (targetUid) {
    try {
      await authAdmin.deleteUser(targetUid);
    } catch (e) {
      console.warn("Auth 삭제 실패:", e.message);
    }
  }

  // Firestore admins 문서 삭제 (uid 기반)
  if (targetUid) {
    try { await db.collection("admins").doc(targetUid).delete(); } catch (e) {}
  }

  // Firestore users 문서 삭제 (email 기반)
  if (targetEmail) {
    try { await db.collection("users").doc(targetEmail).delete(); } catch (e) {}
  }

  console.log(`[createUser] 계정 삭제: uid=${targetUid}, email=${targetEmail}`);
  return res.status(200).json({ data: { success: true } });
}

// ─────────────────────────────────────────────────────────────
//  기존 함수들 (tradeStock, quote) 은 이 파일에 병합하거나
//  별도 파일로 분리하여 유지하면 됩니다.
//  아래는 기존 index.js 파일에 exports.createUser 만 추가하는
//  방식으로도 사용 가능합니다.
// ─────────────────────────────────────────────────────────────
