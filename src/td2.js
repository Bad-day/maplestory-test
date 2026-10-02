// TD(0) 자가대국 학습: node td.js <minutes> <alpha> [resume.bin]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const C = require('./core.js');
const V = require('./ntv2.js');
const W3 = Object.assign({}, C.WEIGHTS, JSON.parse(fs.readFileSync(__dirname + '/weights3.json')).mean);

function tablesFrom(sab) { return { T: sab.T.map(b => new Float32Array(b)), L: new Float32Array(sab.L) }; }

// 한 수 고르기: 1수(조각 1개) 탐욕, 상위 K개만 배치가능 평가 추가
const K = 8;
const topRows = Array.from({ length: K }, () => new Int32Array(16));
function choose(st, T) {
  const L = T.L; let n = 0;
  const top = [];
  for (let s = 0; s < 3; s++) {
    const pid = st.hand[s]; if (pid < 0) continue;
    let dup = false; for (let t = 0; t < s; t++) if (st.hand[t] === pid) dup = true; if (dup) continue;
    const p = C.PIECES[pid];
    for (let vi = 0; vi < p.variants.length; vi++) {
      const v = p.variants[vi], mw = 10 - v.w, mh = 16 - v.h;
      for (let y = 0; y <= mh; y++) for (let x = 0; x <= mw; x++) {
        if (!C.fits(st.rows, v, x, y)) continue;
        const rows = st.rows.slice(); let full = false;
        for (let i = 0; i < v.h; i++) { rows[y + i] |= v.masks[i] << x; if (rows[y + i] === 1023) full = true; }
        let reward = p.size, icons = st.icons, dot = st.dot, rr = st.reroll, lines = st.lines;
        if (full) {
          const t = { rows, icons: st.icons.map(i => ({ ...i })), dot, reroll: rr, lines };
          const c = C.clearRows(t, st.gravity); reward += C.lineScore(c.n) + 50 * c.acq;
          icons = t.icons; dot = t.dot; rr = t.reroll; lines = t.lines;
        }
        const f1 = V.feat1(rows, icons, dot, rr, W3);
        const cheap = reward / 100 + L[0] + V.lutSum(T, rows) + L[1] * f1;
        n++;
        if (top.length < K || cheap > top[top.length - 1].cheap) {
          const e = { s, vi, x, y, cheap, f1, reward, icons, dot, rr, lines, rows };
          let i = top.length < K ? top.length : K - 1; top[i] = e;
          while (i > 0 && top[i - 1].cheap < top[i].cheap) { const tmp = top[i - 1]; top[i - 1] = top[i]; top[i] = tmp; i--; }
        }
      }
    }
  }
  if (!top.length) return null;
  let best = null;
  for (const e of top) { e.f2 = V.feat2(e.rows, e.lines, W3); e.full = e.cheap + L[2] * e.f2; if (!best || e.full > best.full) best = e; }
  best.V = best.full - best.reward / 100;
  return best;
}

function playGame(T, seed, alpha, alphaLin, learn) {
  const R = C.rng(seed); const st = C.newState(); C.fillHand(st, R);
  let prev = null, prevScore = 0, moves = 0;
  const L = T.L, al = alpha / V.NLOOK;
  const update = (target) => {
    if (!prev || !learn) return;
    let d = target - prev.V; if (d > 200) d = 200; else if (d < -200) d = -200;
    V.lutAddNorm(T, prev.rows, d, alpha);
    L[0] += alphaLin * d; // 기존 평가 계수(L1,L2)는 고정: 학습 불안정 방지
  };
  while (st.score < 500000) {
    if (st.hand.every(h => h < 0)) C.fillHand(st, R);
    let e = choose(st, T);
    while (!e) {
      if (!C.rescue(st, R)) break;
      if (st.hand.every(h => h < 0)) C.fillHand(st, R);
      e = choose(st, T);
    }
    if (!e) break;
    const r = (st.score - prevScore) + e.reward;
    update(r / 100 + e.V);
    C.placePiece(st, e.s, e.vi, e.x, e.y);
    C.maybeSpawn(st, R);
    prevScore = st.score;
    prev = { rows: st.rows.slice(), f1: e.f1, f2: e.f2, V: e.V };
    moves++;
  }
  update(0 + (st.score - prevScore) / 100);
  return { score: st.score, lines: st.lines, moves };
}

// 3조각 탐색(빔)으로 두면서 학습: 실제 추천 방식과 같은 분포의 판을 학습
function playGamePlan(T, seed, alpha, alphaLin, learn, beam) {
  const R = C.rng(seed); const st = C.newState(); C.fillHand(st, R);
  const vf = { cheap: n => 100 * (T.L[0] + V.lutSum(T, n.rows) + T.L[1] * V.feat1(n.rows, n.icons, n.dot, n.reroll, W3)),
               full: n => 100 * (T.L[0] + V.lutSum(T, n.rows) + T.L[1] * V.feat1(n.rows, n.icons, n.dot, n.reroll, W3) + T.L[2] * V.feat2(n.rows, n.lines, W3)) };
  const opts = { w: W3, vf, beam, finalK: beam * 2 };
  let prev = null, prevScore = 0;
  const L = T.L;
  const valueNow = () => { const n = { rows: st.rows, icons: st.icons, dot: st.dot, reroll: st.reroll, lines: st.lines };
    const f1 = V.feat1(n.rows, n.icons, n.dot, n.reroll, W3), f2 = V.feat2(n.rows, n.lines, W3);
    return { rows: st.rows.slice(), f1, f2, V: L[0] + V.lutSum(T, n.rows) + L[1] * f1 + L[2] * f2 }; };
  const step = () => {
    const cur = valueNow(); const r = (st.score - prevScore) / 100;
    if (prev && learn) { let d = r + cur.V - prev.V; if (d > 200) d = 200; else if (d < -200) d = -200; V.lutAddNorm(T, prev.rows, d, alpha); L[0] += alphaLin * d; }
    prev = cur; prevScore = st.score;
  };
  let alive = true;
  while (st.score < 500000 && alive) {
    if (st.hand.every(h => h < 0)) C.fillHand(st, R);
    const res = C.plan(st, opts);
    // 손패를 다 쓴 시점(다음 조각이 무작위인 판)만 학습 대상
    if (res.complete && res.plans.length) { for (const s of res.plans[0].steps) C.applyStep(st, s, R); step(); continue; }
    if (res.plans.length && res.depth > 0) { const s = res.plans[0].steps.find(x => x.type === 'piece'); C.applyStep(st, s, R); if (st.hand.every(h => h < 0)) step(); continue; }
    if (!C.rescue(st, R)) alive = false;
  }
  if (prev && learn) { let d = (st.score - prevScore) / 100 - prev.V; if (d < -200) d = -200; V.lutAddNorm(T, prev.rows, d, alpha); }
  return { score: st.score, lines: st.lines };
}

if (!isMainThread) {
  const T = tablesFrom(workerData.sab);
  const A = new Float32Array(workerData.sab.A);
  const { alphaLin, learn } = workerData;
  let seed = workerData.seed;
  for (;;) {
    const r = workerData.beam ? playGamePlan(T, seed++, A[0], alphaLin, learn, workerData.beam) : playGame(T, seed++, A[0], alphaLin, learn);
    parentPort.postMessage(r);
  }
}

if (isMainThread && require.main === module) {
  const minutes = +process.argv[2] || 10, alpha = +process.argv[3] || 0.05, resume = process.argv[4], learn = process.argv[5] !== 'eval', beam = +process.argv[6] || 0;
  const sab = { T: V.SIZES.map(n => new SharedArrayBuffer(n * 4)), L: new SharedArrayBuffer(12), A: new SharedArrayBuffer(4) };
  const T = tablesFrom(sab); T.L.set([0, 1, 1]); const A = new Float32Array(sab.A); A[0] = alpha;
  let games0 = 0;
  if (resume && fs.existsSync(resume)) { const o = load(resume); o.T.forEach((t, i) => T.T[i].set(t)); T.L.set(o.L); games0 = o.games; }
  const nw = 2, ws = [];
  for (let i = 0; i < nw; i++) ws.push(new Worker(__filename, { workerData: { sab, alpha, alphaLin: 0.0002, learn, beam, seed: (Date.now() % 1e9) + i * 1e7 } }));
  const HN = beam ? 200 : 400; const CUR = 'td2.bin', BEST = 'td2_best.bin';
  const hist = []; let games = 0, t0 = Date.now(), lastLog = t0, lastSave = t0, best = 0, sinceBest = 0, restores = 0;
  const out = fs.createWriteStream('td2.log', { flags: 'a' });
  const avgN = n => { const l = hist.slice(-n); return l.reduce((a, b) => a + b, 0) / Math.max(1, l.length); };
  const logN = n => { const l = hist.slice(-n); return l.reduce((a, b) => a + Math.log(1000 + b), 0) / Math.max(1, l.length); };
  ws.forEach(w => w.on('message', r => {
    hist.push(r.score); games++; sinceBest++;
    const now = Date.now();
    if (learn && hist.length >= HN && sinceBest >= HN) {
      const a = logN(HN);
      if (a > best) { best = a; sinceBest = 0; save(BEST, T, games0 + games); }
      else if (a < best - 1.2) {
        // 붕괴 감지: 최고 저장본으로 되돌리고 학습률 절반
        const o = load(BEST); o.T.forEach((t, i) => T.T[i].set(t)); T.L.set(o.L);
        A[0] = A[0] * 0.5; restores++; hist.length = 0; sinceBest = 0;
        const line = `RESTORE bestLog ${best.toFixed(3)} newAlpha ${A[0]}`; console.log(line); out.write(line + '\n');
      }
    }
    if (now - lastLog > 30000) {
      lastLog = now; const last = hist.slice(-200); const m = avgN(200);
      const line = `${((now - t0) / 60000).toFixed(1)}m games ${games0 + games} avg200 ${m.toFixed(0)} max200 ${last.length ? Math.max(...last) : 0} bestLog ${best.toFixed(3)} log ${logN(200).toFixed(3)} alpha ${A[0].toFixed(4)} L ${Array.from(T.L).map(v => v.toFixed(2)).join(',')}`;
      console.log(line); out.write(line + '\n');
    }
    if (learn && now - lastSave > 120000) { lastSave = now; save(CUR, T, games0 + games); }
    if (now - t0 > minutes * 60000) { if (learn) save(CUR, T, games0 + games); ws.forEach(x => x.terminate()); console.log('done games', games, 'bestLog', best.toFixed(3), 'restores', restores); process.exit(0); }
  }));
}
function save(f, M, games) {
  const head = Buffer.from(JSON.stringify({ games, L: Array.from(M.L), sizes: M.T.map(t => t.length) }));
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length, 0);
  fs.writeFileSync(f + '.tmp', Buffer.concat([len, head].concat(M.T.map(t => Buffer.from(t.buffer.slice(0))))));
  fs.renameSync(f + '.tmp', f);
}
function load(f) {
  const b = fs.readFileSync(f), n = b.readUInt32LE(0), h = JSON.parse(b.slice(4, 4 + n).toString());
  let off = 4 + n; const T = [];
  for (const sz of h.sizes) { const ab = b.buffer.slice(b.byteOffset + off, b.byteOffset + off + sz * 4); T.push(new Float32Array(ab)); off += sz * 4; }
  return { games: h.games, L: h.L, T };
}
module.exports = { load, choose, playGame, playGamePlan, W3 };
