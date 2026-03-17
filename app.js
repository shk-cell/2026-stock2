import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig, CF_BASE } from "./config.js";

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

const TRADE_URL   = `${CF_BASE}/tradeStock`;
const QUOTE_URL   = `${CF_BASE}/quote`;
const RANKING_URL = `${CF_BASE}/getRanking`;

const $ = (id) => document.getElementById(id);
const money  = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let curPrice = 0, curSym = "", lastRefresh = 0;

// ── 타이머 (UX 안내용, 서버에서 시세 직접 조회하므로 보안과 무관) ──
function updateTimer() {
  const msgElem = $("expireMsg");
  if (!msgElem) return;
  const diff = Date.now() - lastRefresh;
  const isExp = lastRefresh === 0 || diff >= 3600000;
  if ($("buyBtn")) $("buyBtn").disabled = isExp || !curSym;
  msgElem.textContent = isExp
    ? "시세 갱신 필요"
    : `거래 가능: ${Math.floor((3600000 - diff) / 60000)}분 ${Math.floor(((3600000 - diff) % 60000) / 1000)}초`;
}
setInterval(updateTimer, 1000);

// ── 로딩 표시 헬퍼 ──
function setLoading(btnId, loading, text = "") {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (text) btn.textContent = loading ? "⏳ 처리 중..." : text;
}

// ── 수량 입력 모달 (prompt() 대체) ──
function askQty(title, confirmColor = "var(--up)") {
  return new Promise((resolve) => {
    $("qtyModalTitle").textContent = title;
    $("qtyInput").value = "1";
    $("qtyConfirmBtn").style.background = confirmColor;
    $("qtyModal").style.display = "flex";
    $("qtyInput").select();

    function cleanup() {
      $("qtyModal").style.display = "none";
      $("qtyConfirmBtn").onclick = null;
      $("qtyCancelBtn").onclick  = null;
      $("qtyInput").onkeydown    = null;
    }
    const confirm = () => {
      const qty = parseInt($("qtyInput").value);
      cleanup();
      resolve(!isNaN(qty) && qty > 0 ? qty : null);
    };
    $("qtyConfirmBtn").onclick = confirm;
    $("qtyCancelBtn").onclick  = () => { cleanup(); resolve(null); };
    $("qtyInput").onkeydown    = (e) => {
      if (e.key === "Enter")  confirm();
      if (e.key === "Escape") { cleanup(); resolve(null); }
    };
  });
}

async function getExchangeRate() {
  try {
    const res  = await fetch(`${QUOTE_URL}?symbol=USDKRW=X`);
    const data = await res.json();
    const rate = (data.ok && data.price > 0) ? data.price : 1465;
    if ($("currentRateText")) $("currentRateText").textContent = `(현재 환율: ${rate.toLocaleString()}원)`;
    return rate;
  } catch {
    return 1465;
  }
}

// ── symbolOverride: globalRefresh에서 현재 종목 재조회 시 사용 ──
async function fetchQuote(symbolOverride = null) {
  const sym = symbolOverride || $("qSymbol").value.trim().toUpperCase();
  if (!sym) return;
  setLoading("qBtn", true, "조회");
  try {
    const res  = await fetch(`${QUOTE_URL}?symbol=${encodeURIComponent(sym)}`);
    const data = await res.json();
    if (data.ok) {
      const rate = await getExchangeRate();
      let p = data.price;
      if (sym.includes(".KS") || sym.includes(".KQ") || data.currency === "KRW") {
        p = p / rate;
      }
      curSym = data.symbol; curPrice = p;
      if ($("qOutBox"))    $("qOutBox").style.display = "flex";
      if ($("qSymbolText")) $("qSymbolText").textContent = curSym;
      if ($("qPriceText"))  $("qPriceText").textContent  = money(curPrice);
      lastRefresh = Date.now();
      updateTimer();
    } else {
      // symbolOverride일 때는 자동 재조회이므로 alert 생략
      if (!symbolOverride) alert("종목을 찾을 수 없습니다.");
    }
  } catch {
    if (!symbolOverride) alert("시세 호출 실패. 잠시 후 다시 시도해주세요.");
  } finally {
    setLoading("qBtn", false, "조회");
  }
}

async function callTradeAPI(payload) {
  const user    = auth.currentUser;
  const idToken = await user.getIdToken();
  const res = await fetch(TRADE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body:    JSON.stringify({ data: payload })
  });
  return await res.json();
}

async function buyStock() {
  const user = auth.currentUser;
  if (!user || !curSym || curPrice <= 0) return;
  const qty = await askQty(`[${curSym}] 매수 수량`, "var(--up)");
  if (!qty) return;
  setLoading("buyBtn", true, "매수");
  try {
    const result = await callTradeAPI({ type: "BUY", symbol: curSym, qty });
    if (result.data.success) {
      alert("매수 완료!");
      refreshData();
    } else {
      alert(`매수 실패: ${result.data.error || "알 수 없는 오류"}`);
    }
  } catch {
    alert("매수 실패: 네트워크 오류");
  } finally {
    setLoading("buyBtn", false, "매수");
  }
}

async function sellStock(sym, btn) {
  const qty = await askQty(`[${escHtml(sym)}] 매도 수량`, "var(--pri)");
  if (!qty) return;
  if (btn) { btn.disabled = true; btn.textContent = "⏳"; }
  try {
    const result = await callTradeAPI({ type: "SELL", symbol: sym, qty });
    if (result.data.success) {
      alert("매도 완료!");
      refreshData();
    } else {
      alert(`매도 실패: ${result.data.error || "알 수 없는 오류"}`);
    }
  } catch {
    alert("매도 실패: 네트워크 오류");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "매도"; }
  }
}

async function refreshData() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const userRef = doc(db, "users", user.email);
    const uSnap   = await getDoc(userRef);

    if (!uSnap.exists()) {
      alert("계정 정보를 찾을 수 없습니다. 선생님께 문의하세요.");
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    const userData = uSnap.data();
    const rate     = await getExchangeRate();

    if ($("userNickname")) $("userNickname").textContent = `${user.email} (${userData.nickname || "사용자"})`;
    if ($("cashText"))     $("cashText").textContent     = money(userData.cash);

    // ── 포트폴리오 ──
    const pSnaps = await getDocs(collection(db, "users", user.email, "portfolio"));
    let pHtml = "", stockTotal = 0;

    const portfolioPromises = pSnaps.docs.map(async (s) => {
      const d = s.data();
      if (d.qty <= 0) return null;

      let currentPrice = 0;
      try {
        const res   = await fetch(`${QUOTE_URL}?symbol=${encodeURIComponent(s.id)}`);
        const quote = await res.json();
        if (quote && quote.ok) {
          currentPrice = Number(quote.price);
          if (s.id.includes(".KS") || s.id.includes(".KQ") || quote.currency === "KRW") {
            currentPrice = currentPrice / rate;
          }
        }
      } catch {
        console.error(`${s.id} 시세 호출 오류`);
      }

      const buyP    = d.price;
      const val     = currentPrice * d.qty;
      const safeId  = escHtml(s.id);

      let profitRateText = "0.00%";
      let color = "var(--zero)", sign = "";

      if (buyP && currentPrice > 0) {
        const profitRate = ((currentPrice - buyP) / buyP) * 100;
        if      (profitRate >  0.01) { color = "var(--up)";   sign = "+"; }
        else if (profitRate < -0.01) { color = "var(--down)"; }
        profitRateText = `${sign}${profitRate.toFixed(2)}%`;
      } else if (!buyP) {
        profitRateText = "기록없음";
      } else if (currentPrice === 0) {
        profitRateText = "로딩실패";
      }

      return {
        html: `
          <div class="item-flex">
            <div style="flex:1; overflow:hidden;">
              <div class="port-name">${safeId} <span style="font-weight:400; color:var(--muted); font-size:12px;">${d.qty}주</span></div>
              <div class="port-detail">
                매수 ${buyP ? money(buyP) : "미기록"} &nbsp;·&nbsp;
                현재 <b style="color:var(--txt);">${money(currentPrice)}</b> &nbsp;·&nbsp;
                <span style="color:${color}; font-weight:700;">${profitRateText}</span>
              </div>
            </div>
            <button onclick="window.sellStock('${safeId}', this)" class="btn btn-sell" style="height:34px; font-size:12px; padding:0 12px;" ${currentPrice === 0 ? "disabled" : ""}>매도</button>
          </div>`,
        value: val
      };
    });

    const results = await Promise.all(portfolioPromises);
    results.forEach(r => { if (r) { pHtml += r.html; stockTotal += r.value; } });

    if ($("portfolioList")) $("portfolioList").innerHTML = pHtml || '<div class="empty">보유 주식이 없습니다.</div>';

    const total = (userData.cash || 0) + stockTotal;
    if ($("totalAssetsText")) $("totalAssetsText").textContent = money(total);

    await loadRankingAndHistory(user);

  } catch (e) {
    console.error("데이터 갱신 중 오류:", e);
  }
}

async function loadRankingAndHistory(user) {
  try {
    const idToken = await user.getIdToken();
    const rankRes = await fetch(RANKING_URL, { headers: { "Authorization": `Bearer ${idToken}` } });
    const rankData = await rankRes.json();

    if (rankData.ok) {
      let rHtml = "";
      rankData.ranking.forEach((rd, i) => {
        const rankClass = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
        const medal     = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
        const meStyle   = rd.isMe ? "background:rgba(43,124,255,0.08); border-radius:8px; padding:0 6px;" : "";
        rHtml += `<div class="rank-row" style="${meStyle}">
          <div class="rank-num ${rankClass}">${medal}</div>
          <div style="flex:1; font-size:13px;">${escHtml(rd.nickname)}${rd.isMe ? ' <span style="color:var(--pri); font-size:11px;">나</span>' : ""}</div>
          <div class="rank-asset" style="font-family:'Noto Sans KR',sans-serif;">${money(rd.totalAsset)}</div>
        </div>`;
      });
      if ($("rankingList")) $("rankingList").innerHTML = rHtml || '<div class="empty">랭킹 없음</div>';
    }

    // 거래내역: 본인 것만 직접 조회 (Firestore Rules에서 본인만 허용)
    const hSnaps = await getDocs(query(
      collection(db, "users", user.email, "history"),
      orderBy("timestamp", "desc"),
      limit(10)
    ));
    let hHtml = "";
    hSnaps.docs.forEach(d => {
      const h         = d.data();
      const isBuy     = h.type === "BUY";
      const typeLabel = isBuy ? "🔴 매수" : "🔵 매도";
      const typeColor = isBuy ? "var(--up)" : "var(--down)";
      hHtml += `<div class="item-flex">
        <span style="font-size:12px; color:${typeColor}; font-weight:700;">${typeLabel} <span style="color:var(--txt);">${escHtml(h.symbol)}</span></span>
        <span style="font-size:11px; color:var(--muted);">${h.qty}주 · ${money(h.price)}</span>
      </div>`;
    });
    if ($("transactionList")) $("transactionList").innerHTML = hHtml || '<div class="empty">거래 내역 없음</div>';

  } catch (e) {
    console.error("랭킹/내역 로딩 실패:", e);
  }
}

// ── globalRefresh: 이전에 조회한 종목이 있으면 시세 재조회, 없으면 포트폴리오만 갱신 ──
// (수정 전: lastRefresh만 리셋해 stale 가격으로 매수 버튼이 활성화되던 버그 수정)
const globalRefresh = async () => {
  const btn = $("globalRefreshBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ 업데이트 중..."; }
  try {
    if (curSym) {
      await fetchQuote(curSym); // 현재 심볼 재조회 → lastRefresh 갱신
    }
    await refreshData();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "↻ 현재 시세 업데이트"; }
  }
};

if ($("qBtn"))          $("qBtn").onclick          = () => fetchQuote();
if ($("buyBtn"))        $("buyBtn").onclick         = buyStock;
if ($("globalRefreshBtn")) $("globalRefreshBtn").onclick = globalRefresh;
if ($("logoutBtn"))     $("logoutBtn").onclick      = () => signOut(auth).then(() => { window.location.href = "login.html"; });
window.sellStock = sellStock;

onAuthStateChanged(auth, (u) => {
  if (u) {
    if ($("dashView")) $("dashView").style.display = "block";
    globalRefresh();
  } else {
    window.location.href = "login.html";
  }
});
