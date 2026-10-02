/* n-tuple 가치 함수 v2: 행쌍(대칭 4) + 창 패턴 5종(3x4, 4x3, 4x4, 2x5, 5x2)
   V = L0 + Σ표 + L1·기존평가(빠른) + L2·기존평가(배치가능), 단위 100점. 브라우저/Node 공용 */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.MoaCore;
  const H = 16, FULL = 1023;
  const MIR = new Uint16Array(1024);
  for (let i = 0; i < 1024; i++) { let m = 0; for (let b = 0; b < 10; b++) if ((i >> b) & 1) m |= 1 << (9 - b); MIR[i] = m; }
  // 창: [높이, 너비]
  const WINS = [[3, 4], [4, 3], [4, 4], [2, 5], [5, 2]];
  const SIZES = [1 << 20].concat(WINS.map(([h, w]) => 1 << (h * w)));
  const NWLOOK = WINS.map(([h, w]) => (H - h + 1) * (10 - w + 1));
  const NLOOK = 68 + NWLOOK.reduce((a, b) => a + b, 0);

  function create() { return { T: SIZES.map(n => new Float32Array(n)), L: new Float32Array([0, 1, 1]) }; }
  const ext = new Int32Array(H + 2);
  function lutSum(M, rows) {
    ext[0] = FULL; ext[H + 1] = FULL; for (let y = 0; y < H; y++) ext[y + 1] = rows[y];
    const P = M.T[0]; let s = 0;
    for (let y = 0; y <= H; y++) {
      const a = ext[y], b = ext[y + 1], ma = MIR[a], mb = MIR[b];
      s += P[(a << 10) | b] + P[(b << 10) | a] + P[(ma << 10) | mb] + P[(mb << 10) | ma];
    }
    { const t = M.T[1]; for (let y = 0; y < 14; y++) { const r0 = rows[y], r1 = rows[y + 1], r2 = rows[y + 2];
      for (let x = 0; x < 7; x++) s += t[((r0 >> x) & 15) | (((r1 >> x) & 15) << 4) | (((r2 >> x) & 15) << 8)]; } }
    { const t = M.T[2]; for (let y = 0; y < 13; y++) { const r0 = rows[y], r1 = rows[y + 1], r2 = rows[y + 2], r3 = rows[y + 3];
      for (let x = 0; x < 8; x++) s += t[((r0 >> x) & 7) | (((r1 >> x) & 7) << 3) | (((r2 >> x) & 7) << 6) | (((r3 >> x) & 7) << 9)]; } }
    { const t = M.T[3]; for (let y = 0; y < 13; y++) { const r0 = rows[y], r1 = rows[y + 1], r2 = rows[y + 2], r3 = rows[y + 3];
      for (let x = 0; x < 7; x++) s += t[((r0 >> x) & 15) | (((r1 >> x) & 15) << 4) | (((r2 >> x) & 15) << 8) | (((r3 >> x) & 15) << 12)]; } }
    { const t = M.T[4]; for (let y = 0; y < 15; y++) { const r0 = rows[y], r1 = rows[y + 1];
      for (let x = 0; x < 6; x++) s += t[((r0 >> x) & 31) | (((r1 >> x) & 31) << 5)]; } }
    { const t = M.T[5]; for (let y = 0; y < 12; y++) { const r0 = rows[y], r1 = rows[y + 1], r2 = rows[y + 2], r3 = rows[y + 3], r4 = rows[y + 4];
      for (let x = 0; x < 9; x++) s += t[((r0 >> x) & 3) | (((r1 >> x) & 3) << 2) | (((r2 >> x) & 3) << 4) | (((r3 >> x) & 3) << 6) | (((r4 >> x) & 3) << 8)]; } }
    return s;
  }
  // 정규화 LMS 갱신
  const idx = SIZES.map((_, i) => new Int32Array(i === 0 ? 68 : NWLOOK[i - 1]));
  const cnt = new Map();
  function sq(arr) { cnt.clear(); for (const i of arr) cnt.set(i, (cnt.get(i) || 0) + 1); let s = 0; for (const c of cnt.values()) s += c * c; return s; }
  function lutAddNorm(M, rows, delta, alpha) {
    ext[0] = FULL; ext[H + 1] = FULL; for (let y = 0; y < H; y++) ext[y + 1] = rows[y];
    let k = 0; const a0 = idx[0];
    for (let y = 0; y <= H; y++) { const a = ext[y], b = ext[y + 1], ma = MIR[a], mb = MIR[b];
      a0[k++] = (a << 10) | b; a0[k++] = (b << 10) | a; a0[k++] = (ma << 10) | mb; a0[k++] = (mb << 10) | ma; }
    WINS.forEach(([h, w], wi) => {
      const arr = idx[wi + 1], mask = (1 << w) - 1; let n = 0;
      for (let y = 0; y <= H - h; y++) for (let x = 0; x <= 10 - w; x++) {
        let v = 0; for (let i = 0; i < h; i++) v |= ((rows[y + i] >> x) & mask) << (i * w);
        arr[n++] = v;
      }
    });
    let norm = 0; for (const a of idx) norm += sq(a);
    const d = alpha * delta / norm;
    idx.forEach((a, ti) => { const t = M.T[ti]; for (const i of a) t[i] += d; });
  }
  function feat1(rows, icons, dot, reroll, w) { return (C.quickEval(rows, icons, dot + reroll < 7, w) + w.dot * dot + w.reroll * reroll) / 100; }
  function feat2(rows, lines, w) { return C.fitEval(rows, lines, w) / 100; }
  function makeVF(M, w) {
    const base = n => M.L[0] + lutSum(M, n.rows) + M.L[1] * feat1(n.rows, n.icons, n.dot, n.reroll, w);
    return { cheap: n => 100 * base(n), full: n => 100 * (base(n) + M.L[2] * feat2(n.rows, n.lines, w)) };
  }
  // 브라우저 내장 데이터: 표마다 int16 + scale, base64
  function b64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function decode(D) {
    return { T: D.t.map(({ s, d }) => { const q = new Int16Array(b64(d)), f = new Float32Array(q.length); for (let i = 0; i < q.length; i++) f[i] = q[i] * s; return f; }), L: Float32Array.from(D.L) };
  }
  const api = { create, lutSum, lutAddNorm, feat1, feat2, makeVF, decode, SIZES, NLOOK, WINS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MoaNTV = api;
})(typeof self !== 'undefined' ? self : this);
