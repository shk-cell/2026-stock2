import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0Cl5VyhKivRExMLECf5uR7FhaCOov-s0",
  authDomain: "stock2-c7470.firebaseapp.com",
  projectId: "stock2-c7470",
  storageBucket: "stock2-c7470.firebasestorage.app",
  messagingSenderId: "283664471206",
  appId: "1:283664471206:web:3db65c9d1296149b749067",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const TRADE_URL = "https://asia-northeast3-stock2-c7470.cloudfunctions.net/tradeStock";
const QUOTE_URL = "https://asia-northeast3-stock2-c7470.cloudfunctions.net/quote";

const $ = (id) => document.getElementById(id);
const money = (v) => `$${Number(v || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;

let curPrice = 0, curSym = "", lastRefresh = 0;

function updateTimer() {
  const msgElem = $("expireMsg");
  if (!msgElem) return;
  const diff = Date.now() - lastRefresh;
  const isExp = lastRefresh === 0 || diff >= 3600000;
  if($("buyBtn")) $("buyBtn").disabled = isExp || !curSym;
  msgElem.textContent = isExp ? "시세 갱신 필요" : `거래 가능: ${Math.floor((3600000-diff)/60000)}분 ${Math.floor(((3600000-diff)%60000)/1000)}초`;
}
setInterval(updateTimer, 1000);

async function getExchangeRate() {
  try {
    const res = await fetch(`${QUOTE_URL}?symbol=USDKRW=X`);
    const data = await res.json();
    const rate = (data.ok && data.price) ? data.price : 1465; 
    if($("currentRateText")) $("currentRateText").textContent = `(현재 환율: ${rate.toLocaleString()}원)`;
    return rate;
  } catch (e) { 
    return 1465; 
  }
}

async function fetchQuote() {
  const sym = $("qSymbol").value.trim().toUpperCase();
  if (!sym) return;
  $("qBtn").disabled = true;
  try {
    const res = await fetch(`${QUOTE_URL}?symbol=${sym}`);
    const data = await res.json();
    if (data.ok) {
      const rate = await getExchangeRate();
      let p = data.price;
      if (sym.includes(".KS") || sym.includes(".KQ") || data.currency === "KRW") {
        p = p / rate;
      }
      curSym = data.symbol; curPrice = p;
      if($("qOutBox")) $("qOutBox").style.display = "flex";
      if($("qSymbolText")) $("qSymbolText").textContent = curSym;
      if($("qPriceText")) $("qPriceText").textContent = money(curPrice);
      lastRefresh = Date.now();
      updateTimer();
    } else { alert("종목을 찾을 수 없습니다."); }
  } catch (e) { alert("시세 호출 실패"); } finally { $("qBtn").disabled = false; }
}

async function callTradeAPI(payload) {
  const user = auth.currentUser;
  const idToken = await user.getIdToken();
  const res = await fetch(TRADE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ data: payload })
  });
  return await res.json();
}

async function buyStock() {
  const user = auth.currentUser;
  if(!user || !curSym || curPrice <= 0) return;
  const qty = parseInt(prompt(`[${curSym}] 매수 수량:`, "1"));
  if(isNaN(qty) || qty <= 0) return;
  try {
    const result = await callTradeAPI({ type: "BUY", symbol: curSym, qty: qty, price: curPrice });
    if(result.data.success) { alert("매수 완료!"); refreshData(); }
  } catch(e) { alert("매수 실패"); }
}

async function sellStock(sym, currentPrice) {
  const qty = parseInt(prompt(`[${sym}] 매도 수량:`, "1"));
  if(isNaN(qty) || qty <= 0) return;
  try {
    const result = await callTradeAPI({ type: "SELL", symbol: sym, qty: qty, price: currentPrice });
    if(result.data.success) { alert("매도 완료!"); refreshData(); }
  } catch(e) { alert("매도 실패"); }
}

async function refreshData() {
  const user = auth.currentUser; 
  if (!user) return;
  
  try {
    const userRef = doc(db, "users", user.email);
    let uSnap = await getDoc(userRef);

    if (!uSnap.exists()) {
      const initialData = {
        cash: 70000,
        totalAsset: 70000,
        nickname: user.email.split('@')[0],
        role: "student",
        createdAt: new Date()
      };
      await setDoc(userRef, initialData);
      uSnap = await getDoc(userRef);
      alert("신규 계정 초기 자금 $70,000가 지급되었습니다.");
    }
    
    const userData = uSnap.data();
    const rate = await getExchangeRate();

    if($("userNickname")) $("userNickname").textContent = `${user.email} (${userData.nickname || '사용자'})`;
    if($("cashText")) $("cashText").textContent = money(userData.cash);

    const pSnaps = await getDocs(collection(db, "users", user.email, "portfolio"));
    let pHtml = "";
    let stockTotal = 0;

    const portfolioPromises = pSnaps.docs.map(async (s) => {
      const d = s.data();
      if (d.qty <= 0) return null;

      let currentPrice = 0;
      try {
        const res = await fetch(`${QUOTE_URL}?symbol=${encodeURIComponent(s.id)}`);
        const quote = await res.json();
        
        if (quote && quote.ok) {
          currentPrice = Number(quote.price);
          if (s.id.includes(".KS") || s.id.includes(".KQ") || quote.currency === "KRW") {
            currentPrice = currentPrice / rate;
          }
        }
      } catch (e) {
        console.error(`${s.id} 시세 호출 에러:`, e);
      }

      const buyP = d.price; 
      const val = currentPrice * d.qty;
      
      let profitRate = 0;
      let profitRateText = "0.00%";
      let color = "var(--zero)";
      let sign = "";

      if (buyP && currentPrice > 0) {
        profitRate = ((currentPrice - buyP) / buyP) * 100;
        if (profitRate > 0.01) { color = "var(--up)"; sign = "+"; }
        else if (profitRate < -0.01) { color = "var(--down)"; sign = ""; }
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
              <div class="port-name">${s.id} <span style="font-weight:400; color:var(--muted); font-size:12px;">${d.qty}주</span></div>
              <div class="port-detail">
                매수 ${buyP ? money(buyP) : '미기록'} &nbsp;·&nbsp;
                현재 <b style="color:var(--txt);">${money(currentPrice)}</b> &nbsp;·&nbsp;
                <span style="color:${color}; font-weight:700;">${profitRateText}</span>
              </div>
            </div>
            <button onclick="window.sellStock('${s.id}', ${currentPrice})" class="btn btn-sell" style="height:34px; font-size:12px; padding:0 12px;" ${currentPrice === 0 ? 'disabled' : ''}>매도</button>
          </div>`,
        value: val
      };
    });

    const results = await Promise.all(portfolioPromises);
    results.forEach(res => {
      if (res) {
        pHtml += res.html;
        stockTotal += res.value;
      }
    });

    if($("portfolioList")) $("portfolioList").innerHTML = pHtml || "보유 주식이 없습니다.";

    const total = (userData.cash || 0) + stockTotal;
    if($("totalAssetsText")) $("totalAssetsText").textContent = money(total);
    await setDoc(userRef, { totalAsset: total }, { merge: true });

    await updateRankingAndHistory(user.email, userData.school);

  } catch (e) { 
    console.error("데이터 갱신 중 치명적 오류:", e); 
  }
}

// 랭킹: 같은 학교 학생끼리만 표시
async function updateRankingAndHistory(email, school) {
  try {
    // 전체 유저 가져온 뒤 클라이언트에서 학교 필터링 + 정렬
    const allSnaps = await getDocs(collection(db, "users"));
    let users = [];
    allSnaps.forEach(d => {
      const data = d.data();
      if (!school || data.school === school) {
        users.push({ id: d.id, ...data });
      }
    });
    users.sort((a, b) => (b.totalAsset || 0) - (a.totalAsset || 0));
    users = users.slice(0, 10);

    let rHtml = "";
    users.forEach((rd, i) => {
      const rankClass = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      rHtml += `<div class="rank-row"><div class="rank-num ${rankClass}">${medal}</div><div style="flex:1; font-size:13px;">${rd.nickname || rd.id.split('@')[0]}</div><div class="rank-asset">${money(rd.totalAsset)}</div></div>`;
    });
    if($("rankingList")) $("rankingList").innerHTML = rHtml || '<div class="empty">랭킹 없음</div>';

    const hSnaps = await getDocs(query(collection(db, "users", email, "history"), orderBy("timestamp", "desc"), limit(10)));
    let hHtml = "";
    hSnaps.docs.forEach(doc => {
      const h = doc.data();
      const isBuy = h.type === 'BUY' || h.type === '매수';
      const typeLabel = isBuy ? '🔴 매수' : '🔵 매도';
      const typeColor = isBuy ? 'var(--up)' : 'var(--down)';
      hHtml += `<div class="item-flex"><span style="font-size:12px; color:${typeColor}; font-weight:700;">${typeLabel} <span style="color:var(--txt);">${h.symbol}</span></span><span style="font-size:11px; color:var(--muted);">${h.qty}주 · ${money(h.price)}</span></div>`;
    });
    if($("transactionList")) $("transactionList").innerHTML = hHtml || '<div class="empty">거래 내역 없음</div>';
  } catch(e) { 
    console.error("랭킹/내역 로딩 실패:", e); 
  }
}

const globalRefresh = () => { lastRefresh = Date.now(); refreshData(); updateTimer(); };

if($("qBtn")) $("qBtn").onclick = fetchQuote;
if($("buyBtn")) $("buyBtn").onclick = buyStock;
if($("globalRefreshBtn")) $("globalRefreshBtn").onclick = globalRefresh;
if($("logoutBtn")) $("logoutBtn").onclick = () => signOut(auth).then(() => { window.location.href = "login.html"; });
window.sellStock = sellStock;

// 비로그인 시 login.html 로 이동 / 로그인 시 대시보드 표시
onAuthStateChanged(auth, (u) => {
  if (u) {
    if($("dashView")) $("dashView").style.display = "block";
    globalRefresh();
  } else {
    window.location.href = "login.html";
  }
});
