// 근사 정책 반복(API): 고정된 모델로 자가대국 데이터를 모으고(collect), 오프라인 회귀로 표를 고친다(fit).
// 목표값 = 각 배치 직후 판에서 "이후 H손 동안 실제로 얻은 점수"(100점 단위). 부트스트랩이 없어 발산하지 않는다.
//   node api3.js collect <모델.bin> <출력.dat> <판 수> [탐색 폭=8] [H=300] [시작 시드=1]
//   node api3.js fit <모델.bin> <출력.bin> <에폭> <학습률> <데이터.dat ...>
//   node api3.js distill <모델.bin> <출력.dat> <판 수> [K=8] [M=16] [시작 시드=1]
//     탐색 증류: 한 손 앞보기로 자가대국하며, 앞보기가 후보마다 계산한 "다음 손 기대값"(손패 M개 평균)을
//     그 후보 결과판의 목표값으로 기록한다. 목표 분산이 작고 추가 계산이 들지 않는다.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), os = require('os');
const C = require('./core.js'), V = require('./ntv2.js');
const { load } = require('./td2.js');
const W3 = Object.assign({}, C.WEIGHTS, JSON.parse(fs.readFileSync(__dirname + '/weights3.json')).mean);
const MAX_HANDS = 3000;
const REC = 16 + 3; // 표본 1개: 행 16개 + f1, f2, 목표 (float32 19개)

function save(f, M, games) {
  const head = Buffer.from(JSON.stringify({ games, L: Array.from(M.L), sizes: M.T.map(t => t.length) }));
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length, 0);
  fs.writeFileSync(f + '.tmp', Buffer.concat([len, head].concat(M.T.map(t => Buffer.from(t.buffer, t.byteOffset, t.byteLength)))));
  fs.renameSync(f + '.tmp', f);
}

// 한 판을 두며 배치마다 판을 기록하고, 끝나면 H손 득점 목표를 붙여 반환
function playRecord(M, seed, beam, H) {
  const vf = V.makeVF(M, W3), opts = { w: W3, vf, beam, finalK: beam * 2 };
  const R = C.rng(seed), st = C.newState(); C.fillHand(st, R);
  const traj = [], startScore = []; let hands = 0, alive = true;
  const record = () => traj.push({ rows: st.rows.slice(), f1: V.feat1(st.rows, st.icons, st.dot, st.reroll, W3), f2: V.feat2(st.rows, st.lines, W3), score: st.score, hand: hands });
  while (alive && hands < MAX_HANDS) {
    startScore[hands] = st.score;
    let done = false;
    for (let guard = 0; guard < 30; guard++) {
      if (st.hand.every(h => h < 0)) { done = true; break; }
      const res = C.plan(st, opts);
      if (res.complete && res.plans.length) { for (const s of res.plans[0].steps) { C.applyStep(st, s, R); if (s.type === 'piece') record(); } done = true; break; }
      if (res.plans.length && res.depth > 0) { C.applyStep(st, res.plans[0].steps.find(s => s.type === 'piece'), R); record(); continue; }
      if (!C.rescue(st, R, W3)) break;
    }
    if (!done) { alive = false; break; }
    hands++; C.fillHand(st, R);
  }
  startScore[hands] = st.score;
  const out = [];
  for (const t of traj) {
    const end = t.hand + 1 + H; // 이 손이 끝난 뒤부터 H손
    let G;
    if (end <= hands) G = startScore[end] - t.score;
    else if (!alive) G = st.score - t.score;
    else continue;
    out.push(t.rows, t.f1, t.f2, G / 100);
  }
  return { score: st.score, hands, rec: out };
}

function playDistill(M, seed, K, Mn) {
  const vf = V.makeVF(M, W3), out = [];
  const look = { K, M: Mn, beam: 4, onCand: (c, next) => out.push(c.rows.slice(), V.feat1(c.rows, c.icons, c.dot, c.reroll, W3), V.feat2(c.rows, c.lines, W3), next / 100) };
  const opts = { w: W3, vf, beam: 8, finalK: 16, look, lookR: C.rng(seed ^ 0x5bd1e995) };
  const r = C.simulate(C.newState(), C.rng(seed), opts, 1e6);
  return { score: r.score, hands: r.hands, rec: out };
}

if (!isMainThread) {
  const { file, beam, H, distill } = workerData; const o = load(file);
  const M = { T: o.T, L: Float32Array.from(o.L) };
  parentPort.on('message', seed => {
    if (seed < 0) process.exit(0);
    const r = distill ? playDistill(M, seed, distill[0], distill[1]) : playRecord(M, seed, beam, H);
    const n = r.rec.length / 4, buf = new Float32Array(n * REC);
    for (let i = 0; i < n; i++) { buf.set(r.rec[i * 4], i * REC); buf[i * REC + 16] = r.rec[i * 4 + 1]; buf[i * REC + 17] = r.rec[i * 4 + 2]; buf[i * REC + 18] = r.rec[i * 4 + 3]; }
    parentPort.postMessage({ score: r.score, hands: r.hands, buf }, [buf.buffer]);
  });
}

function collect(file, out, N, beam, H, start, distill) {
  const nt = os.cpus().length; let next = 0, got = 0; const sc = [], t0 = Date.now();
  const fd = fs.openSync(out, 'w'); let samples = 0;
  for (let i = 0; i < nt; i++) {
    const w = new Worker(__filename, { workerData: { file, beam, H, distill } });
    w.on('message', r => {
      fs.writeSync(fd, Buffer.from(r.buf.buffer)); samples += r.buf.length / REC; sc.push(r.score); got++;
      if (next < N) w.postMessage(start + next++); else w.postMessage(-1);
      if (got === N) {
        fs.closeSync(fd); const m = sc.reduce((a, b) => a + b, 0) / N;
        console.log(`collect ${file} games ${N} mean ${m.toFixed(0)} samples ${samples} sec ${((Date.now() - t0) / 1000).toFixed(0)}`);
      }
    });
    if (next < N) w.postMessage(start + next++);
  }
}

function fit(file, out, epochs, alpha, dats) {
  const o = load(file); const M = { T: o.T, L: Float32Array.from(o.L) };
  const bufs = dats.map(f => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); });
  const all = new Float32Array(bufs.reduce((a, b) => a + b.length, 0)); { let k = 0; for (const b of bufs) { all.set(b, k); k += b.length; } }
  const n = all.length / REC, rows = new Int32Array(16);
  const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  const R = C.rng(12345);
  const nVal = Math.min(20000, n >> 4); // 앞쪽 일부를 검증용으로 섞은 뒤 분리
  for (let i = n - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  const pred = i => { const b = i * REC; for (let y = 0; y < 16; y++) rows[y] = all[b + y]; return M.L[0] + V.lutSum(M, rows) + M.L[1] * all[b + 16] + M.L[2] * all[b + 17]; };
  const rmse = (from, to) => { let s = 0, m = 0; for (let k = from; k < to; k++) { const i = order[k]; const d = all[i * REC + 18] - pred(i); s += d * d; m += d; } return [Math.sqrt(s / (to - from)), m / (to - from)]; };
  // 상수항을 먼저 평균 잔차로 맞춘다
  const [r0, bias] = rmse(0, n); M.L[0] += bias;
  console.log(`fit samples ${n} start rmse ${r0.toFixed(1)} bias ${bias.toFixed(1)} -> val rmse ${rmse(0, nVal)[0].toFixed(1)}`);
  for (let ep = 0; ep < epochs; ep++) {
    const t0 = Date.now();
    for (let i = n - 1; i > nVal; i--) { const j = nVal + ((R() * (i - nVal + 1)) | 0); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const a = alpha / (1 + ep); // 에폭마다 학습률 감소
    for (let k = nVal; k < n; k++) {
      const i = order[k]; let d = all[i * REC + 18] - pred(i);
      if (d > 500) d = 500; else if (d < -500) d = -500;
      V.lutAddNorm(M, rows, d, a); // pred()가 rows를 채워 둠
      M.L[0] += 0.00002 * d;
    }
    const [vr, vb] = rmse(0, nVal), [tr] = rmse(nVal, Math.min(n, nVal * 2));
    console.log(`epoch ${ep + 1} alpha ${a.toFixed(4)} train ${tr.toFixed(1)} val ${vr.toFixed(1)} valBias ${vb.toFixed(1)} sec ${((Date.now() - t0) / 1000).toFixed(0)}`);
  }
  save(out, M, o.games);
}

if (isMainThread && require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === 'collect') collect(a[1], a[2], +a[3], +a[4] || 8, +a[5] || 300, +a[6] || 1);
  else if (a[0] === 'distill') collect(a[1], a[2], +a[3], 8, 0, +a[6] || 1, [+a[4] || 8, +a[5] || 16]);
  else if (a[0] === 'fit') fit(a[1], a[2], +a[3], +a[4], a.slice(5));
  else console.log('usage: collect | fit');
}
module.exports = { playRecord, save };
