/* 한글 모아모아 엔진 + 플래너 (브라우저/Node 공용) */
(function (root) {
  'use strict';
  const W = 10, H = 16, FULL = 1023;
  const POP = new Uint8Array(1024);
  for (let i = 1; i < 1024; i++) POP[i] = POP[i >> 1] + (i & 1);

  // 19종 (사용자 번호/색 순서). rows: '#'=칸
  const PIECE_DEFS = [
    { no: 1, name: 'ㅡ', color: 'blue', label: '파랑 1', rows: ['###'] },
    { no: 2, name: 'ㅏ', color: 'blue', label: '파랑 2', rows: ['#.', '##', '#.'] },
    { no: 3, name: 'ㅣ', color: 'blue', label: '파랑 3', rows: ['#####'] },
    { no: 4, name: 'ㅑ', color: 'blue', label: '파랑 4', rows: ['#.', '##', '#.', '##', '#.'] },
    { no: 5, name: '·', color: 'red', label: '빨강 1', rows: ['#'] },
    { no: 6, name: 'ㄴ', color: 'red', label: '빨강 2', rows: ['#.', '##'] },
    { no: 7, name: 'ㄱ', color: 'red', label: '빨강 3', rows: ['##', '.#', '.#'] },
    { no: 8, name: 'ㄷ', color: 'red', label: '빨강 4', rows: ['##', '#.', '##'] },
    { no: 9, name: 'ㄹ', color: 'red', label: '빨강 5', rows: ['##', '.#', '##', '#.', '##'] },
    { no: 10, name: 'ㅅ', color: 'green', label: '초록 1', rows: ['.#.', '#.#'] },
    { no: 11, name: 'ㅇ', color: 'green', label: '초록 2', rows: ['.#.', '#.#', '.#.'] },
    { no: 12, name: 'ㅂ', color: 'green', label: '초록 3', rows: ['#.#', '###', '#.#', '###'] },
    { no: 13, name: 'ㅈ', color: 'green', label: '초록 4', rows: ['###', '.#.', '#.#'] },
    { no: 14, name: 'ㅁ', color: 'green', label: '초록 5', rows: ['###', '#.#', '###'] },
    { no: 15, name: 'ㅋ', color: 'yellow', label: '노랑 1', rows: ['##', '.#', '##', '.#'] },
    { no: 16, name: 'ㅎ', color: 'yellow', label: '노랑 2', rows: ['..#..', '#####', '.#.#.', '..#..'] },
    { no: 17, name: 'ㅊ', color: 'yellow', label: '노랑 3', rows: ['.#.', '###', '.#.', '#.#'] },
    { no: 18, name: 'ㅍ', color: 'yellow', label: '노랑 4', rows: ['####', '.##.', '####'] },
    { no: 19, name: 'ㅌ', color: 'yellow', label: '노랑 5', rows: ['##', '#.', '##', '#.', '##'] },
  ];

  function norm(cells) {
    let mx = 1e9, my = 1e9;
    for (const [x, y] of cells) { if (x < mx) mx = x; if (y < my) my = y; }
    return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  // transform t: rot 0..3 (시계방향 90도씩), flip 0/1 (좌우반전 후 회전)
  function transformCells(base, rot, flip) {
    let c = base.map(([x, y]) => [flip ? -x : x, y]);
    for (let r = 0; r < rot; r++) c = c.map(([x, y]) => [-y, x]);
    return norm(c);
  }
  function buildPiece(def, idx) {
    const base = [];
    def.rows.forEach((s, y) => { for (let x = 0; x < s.length; x++) if (s[x] === '#') base.push([x, y]); });
    const variants = [], seen = new Map(), orient = []; // orient[flip*4+rot] -> variant idx
    for (let flip = 0; flip < 2; flip++) for (let rot = 0; rot < 4; rot++) {
      const cells = transformCells(base, rot, flip), key = JSON.stringify(cells);
      if (!seen.has(key)) {
        let w = 0, h = 0; for (const [x, y] of cells) { if (x + 1 > w) w = x + 1; if (y + 1 > h) h = y + 1; }
        const masks = new Int32Array(h); for (const [x, y] of cells) masks[y] |= 1 << x;
        seen.set(key, variants.length); variants.push({ cells, w, h, masks, rot, flip });
      }
      orient.push(seen.get(key));
    }
    return { ...def, idx, size: base.length, base, variants, orient };
  }
  const PIECES = PIECE_DEFS.map(buildPiece);
  const NP = PIECES.length;

  // ---------- 확률 (가정, 수정 가능) ----------
  function stageOf(lines) { return lines <= 30 ? 0 : lines <= 60 ? 1 : lines <= 100 ? 2 : lines <= 150 ? 3 : 4; }
  // 5단계에서 1칸 조각 가중치 = ratio × 10칸 조각 가중치, 단계별 기하 보간 (공식 확률 미공개)
  function makeProbTable(finalRatio) {
    const t = [];
    for (let s = 0; s < 5; s++) {
      const r = Math.pow(finalRatio, s / 4);
      const w = PIECES.map(p => Math.pow(r, (10 - p.size) / 9));
      const sum = w.reduce((a, b) => a + b, 0);
      t.push(w.map(v => v / sum));
    }
    return t;
  }
  let PROB = makeProbTable(0.6);
  function setFinalRatio(r) { PROB = makeProbTable(r); api.PROB = PROB; }

  // ---------- RNG ----------
  function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function drawPiece(lines, R) {
    const pr = PROB[stageOf(lines)]; let u = R();
    for (let i = 0; i < NP; i++) { u -= pr[i]; if (u < 0) return i; }
    return NP - 1;
  }

  // ---------- 보드 ----------
  function fits(rows, v, x, y) {
    const m = v.masks;
    for (let i = 0; i < v.h; i++) if (rows[y + i] & (m[i] << x)) return false;
    return true;
  }
  function countFit(rows, p, cap) {
    let n = 0;
    for (const v of p.variants) {
      const mw = W - v.w, mh = H - v.h;
      for (let y = 0; y <= mh; y++) for (let x = 0; x <= mw; x++) if (fits(rows, v, x, y) && ++n >= cap) return n;
    }
    return n;
  }
  function anyFit(rows, p) {
    for (const v of p.variants) {
      const mw = W - v.w, mh = H - v.h;
      for (let y = 0; y <= mh; y++) for (let x = 0; x <= mw; x++) if (fits(rows, v, x, y)) return true;
    }
    return false;
  }
  // 줄 제거. gravity=false: 줄만 비움 / true: 위 줄이 내려옴. icons 배열 수정. 반환: 제거 줄 수, 획득 능력수
  function clearRows(st, gravity) {
    const rows = st.rows; let n = 0, full = 0;
    for (let y = 0; y < H; y++) if (rows[y] === FULL) { n++; full |= 1 << y; }
    if (!n) return { n: 0, acq: 0 };
    let acq = 0;
    if (st.icons.length) {
      const keep = [];
      for (const ic of st.icons) {
        if ((full >> ic.y) & 1 && st.dot + st.reroll < 7) { if (ic.t === 0) st.dot++; else st.reroll++; acq++; }
        else keep.push(ic);
      }
      st.icons = keep;
    }
    if (!gravity) { for (let y = 0; y < H; y++) if ((full >> y) & 1) rows[y] = 0; }
    else {
      const map = new Int32Array(H); let w = H - 1;
      for (let y = H - 1; y >= 0; y--) { if ((full >> y) & 1) { map[y] = -1; continue; } map[y] = w; rows[w--] = rows[y]; }
      while (w >= 0) rows[w--] = 0;
      for (const ic of st.icons) ic.y = map[ic.y] >= 0 ? map[ic.y] : ic.y;
    }
    st.lines += n;
    return { n, acq };
  }
  function lineScore(n) { return 300 * n * n; }

  function newState() {
    return { rows: new Int32Array(H), lines: 0, score: 0, dot: 0, reroll: 0, icons: [], counter: 0, hand: [-1, -1, -1], gravity: false };
  }
  function cloneState(s) {
    return { rows: s.rows.slice(), lines: s.lines, score: s.score, dot: s.dot, reroll: s.reroll,
      icons: s.icons.map(i => ({ x: i.x, y: i.y, t: i.t })), counter: s.counter, hand: s.hand.slice(), gravity: s.gravity };
  }
  // 조각 배치 (검증된 위치 가정). 반환 획득점수
  function placePiece(st, slot, vi, x, y) {
    const p = PIECES[st.hand[slot]], v = p.variants[vi];
    for (let i = 0; i < v.h; i++) st.rows[y + i] |= v.masks[i] << x;
    st.hand[slot] = -1; st.counter++;
    const c = clearRows(st, st.gravity);
    const g = p.size + lineScore(c.n) + 50 * c.acq;
    st.score += g;
    return { gain: g, cleared: c.n, acq: c.acq };
  }
  function placeDot(st, x, y) {
    st.rows[y] |= 1 << x; st.dot--;
    const c = clearRows(st, st.gravity);
    const g = lineScore(c.n) + 50 * c.acq;
    st.score += g; return { gain: g, cleared: c.n, acq: c.acq };
  }
  function iconAt(st, x, y) { return st.icons.some(i => i.x === x && i.y === y); }
  // 7회 배치 후 능력 아이콘 생성 (시뮬레이션용 무작위)
  function maybeSpawn(st, R) {
    if (st.counter < 7) return null;
    st.counter = 0;
    if (st.dot + st.reroll >= 7) return null;
    const empty = [];
    for (let y = 0; y < H; y++) { const e = ~st.rows[y] & FULL; if (!e) continue; for (let x = 0; x < W; x++) if ((e >> x) & 1 && !iconAt(st, x, y)) empty.push(y * W + x); }
    if (!empty.length) return null;
    if (st.icons.length >= 3) st.icons.shift();
    const c = empty[(R() * empty.length) | 0];
    const ic = { x: c % W, y: (c / W) | 0, t: R() < 0.4 ? 0 : 1 };
    st.icons.push(ic); return ic;
  }

  // ---------- 평가 ----------
  // 가중치 키 (학습 대상)
  const WKEYS = ['holes', 'segs', 'rowTrans', 'colTrans', 'fill2', 'near', 'emptyRows', 'filled', 'space3', 'icon', 'dot', 'reroll', 'fitP', 'fitMiss', 'deep', 'combo', 'fitCnt', 'minFit'];
  let WEIGHTS = { holes: -40, segs: -15, rowTrans: -6, colTrans: -5, fill2: 1.5, near: 15, emptyRows: 25, filled: -3, space3: 3, icon: 8, dot: 150, reroll: 200, fitP: 800, fitMiss: -150, deep: -30, combo: 20, fitCnt: 0, minFit: 0 };

  // 저비용 특징: rows, icons, powersFull 여부
  function quickEval(rows, icons, canAcq, w) {
    let holes = 0, segs = 0, rT = 0, cT = 0, f2 = 0, near = 0, er = 0, filled = 0, sp = 0, deep = 0, combo = 0, run = 0, runHole = -1;
    for (let y = 0; y < H; y++) {
      const r = rows[y], n = POP[r], e = ~r & FULL;
      filled += n; f2 += n * n;
      if (!r) { er++; segs++; }
      else {
        if (n >= 8) near++;
        segs += POP[e & ~(e << 1) & FULL]; // 빈 구간 시작 수
        rT += POP[(r ^ (r >> 1)) & 511];
        const up = y > 0 ? ~rows[y - 1] & FULL : 0, dn = y < H - 1 ? ~rows[y + 1] & FULL : 0;
        const nb = ((e << 1) | (e >> 1) | up | dn) & FULL;
        holes += POP[e & ~nb & FULL];
        // 좌우가 막힌 세로 우물(가로 1칸 폭)
        deep += POP[e & ~((e << 1) | (e >> 1)) & FULL & nb];
      }
      if (n === 9) { const hb = e; if (hb === runHole) run++; else { if (run > 1) combo += run * run; run = 1; runHole = hb; } }
      else { if (run > 1) combo += run * run; run = 0; runHole = -1; }
      if (y < H - 1) cT += POP[r ^ rows[y + 1]];
      if (y < H - 2) { const m = e & ~rows[y + 1] & ~rows[y + 2] & FULL; sp += POP[m & (m >> 1) & (m >> 2) & 255]; }
    }
    if (run > 1) combo += run * run;
    let ic = 0;
    if (canAcq) for (const i of icons) ic += POP[rows[i.y]];
    return w.holes * holes + w.segs * segs + w.rowTrans * rT + w.colTrans * cT + w.fill2 * f2 / 10 +
      w.near * near + w.emptyRows * er + w.filled * filled / 10 + w.space3 * sp / 10 + w.icon * ic + w.deep * deep + w.combo * Math.min(combo, 25);
  }
  // fitP: 놓을 수 있는 조각 확률 합 / fitMiss: 못 놓는 조각 수 / fitCnt: 조각별 배치 가능 위치 수(최대 8, 확률 가중) / minFit: 가장 빡빡한 조각의 위치 수
  function fitEval(rows, lines, w) {
    const pr = PROB[stageOf(lines)]; let fp = 0, miss = 0, fc = 0, mn = 8;
    const useCnt = w.fitCnt || w.minFit;
    for (let i = 0; i < NP; i++) {
      if (useCnt) { const c = countFit(rows, PIECES[i], 8); if (c) fp += pr[i]; else miss++; fc += pr[i] * c / 8; if (c < mn) mn = c; }
      else if (anyFit(rows, PIECES[i])) fp += pr[i]; else miss++;
    }
    return w.fitP * fp + w.fitMiss * miss + (w.fitCnt || 0) * fc + (w.minFit || 0) * mn / 8;
  }
  function fullEval(n, w) {
    return quickEval(n.rows, n.icons, n.dot + n.reroll < 7, w) + fitEval(n.rows, n.lines, w) + w.dot * n.dot + w.reroll * n.reroll;
  }

  // ---------- 플래너 (빔 탐색) ----------
  // 노드: {rows, icons, dot, reroll, lines, used(bitmask), gain, steps}
  function rowsKey(rows, used) { let s = used + ':'; for (let y = 0; y < H; y++) s += rows[y] + ','; return s; }
  function expandNode(node, hand, gravity, w, out) {
    for (let s = 0; s < 3; s++) {
      if ((node.used >> s) & 1 || hand[s] < 0) continue;
      // 같은 조각 중복 슬롯은 앞 슬롯만
      let dup = false; for (let t = 0; t < s; t++) if (!((node.used >> t) & 1) && hand[t] === hand[s]) dup = true;
      if (dup) continue;
      const p = PIECES[hand[s]];
      for (let vi = 0; vi < p.variants.length; vi++) {
        const v = p.variants[vi], mw = W - v.w, mh = H - v.h;
        for (let y = 0; y <= mh; y++) for (let x = 0; x <= mw; x++) {
          if (!fits(node.rows, v, x, y)) continue;
          const st = { rows: node.rows.slice(), icons: node.icons, dot: node.dot, reroll: node.reroll, lines: node.lines };
          for (let i = 0; i < v.h; i++) st.rows[y + i] |= v.masks[i] << x;
          let g = p.size, cl = 0;
          // 줄 체크 빠르게
          let anyFull = false; for (let i = 0; i < v.h; i++) if (st.rows[y + i] === FULL) { anyFull = true; break; }
          if (anyFull) { st.icons = node.icons.map(i => ({ x: i.x, y: i.y, t: i.t })); const c = clearRows(st, gravity); cl = c.n; g += lineScore(c.n) + 50 * c.acq; }
          const child = { rows: st.rows, icons: st.icons, dot: st.dot, reroll: st.reroll, lines: st.lines, used: node.used | (1 << s),
            gain: node.gain + g, steps: node.steps.concat([{ type: 'piece', slot: s, piece: hand[s], v: vi, x, y, gain: g, cleared: cl }]) };
          child.q = child.gain + qv(child, w, vfCur);
          out.push(child);
        }
      }
    }
  }
  function dotChildren(node, gravity, w, maxDots) {
    const res = [];
    if (node.dot <= 0 || node.dotsUsed >= maxDots) return res;
    for (let y = 0; y < H; y++) {
      const r = node.rows[y]; if (POP[r] !== 9) continue;
      const x = Math.log2((~r) & FULL) | 0;
      const st = { rows: node.rows.slice(), icons: node.icons.map(i => ({ x: i.x, y: i.y, t: i.t })), dot: node.dot - 1, reroll: node.reroll, lines: node.lines };
      st.rows[y] |= 1 << x;
      const c = clearRows(st, gravity); const g = lineScore(c.n) + 50 * c.acq;
      const ch = { rows: st.rows, icons: st.icons, dot: st.dot, reroll: st.reroll, lines: st.lines, used: node.used, gain: node.gain + g,
        dotsUsed: (node.dotsUsed || 0) + 1, steps: node.steps.concat([{ type: 'dot', x, y, gain: g, cleared: c.n }]) };
      ch.q = ch.gain + qv(ch, w, vfCur);
      res.push(ch);
    }
    return res;
  }
  function selectTop(arr, k) {
    arr.sort((a, b) => b.q - a.q);
    const out = [], seen = new Set();
    for (const n of arr) {
      const key = rowsKey(n.rows, n.used) + n.dot;
      if (seen.has(key)) continue; seen.add(key); out.push(n);
      if (out.length >= k) break;
    }
    return out;
  }
  // state: {rows, icons, dot, reroll, lines, hand, gravity}
  // opts: beam, finalK, w, useDots
  // 가치 함수(학습된 n-tuple) 연결: opts.vf = { cheap(node), full(node) } (점 단위)
  let vfCur = null;
  function qv(n, w, vf) { return vf ? vf.cheap(n) : quickEval(n.rows, n.icons, n.dot + n.reroll < 7, w) + w.dot * n.dot + w.reroll * n.reroll; }
  function plan(state, opts) {
    vfCur = opts.vf || null;
    const w = opts.w || WEIGHTS, beam = opts.beam || 8, finalK = opts.finalK || beam * 2, maxDots = opts.useDots === false ? 0 : (opts.maxDots ?? 2);
    const hand = state.hand;
    let need = 0; for (const h of hand) if (h >= 0) need++;
    const root = { rows: state.rows.slice(), icons: state.icons.map(i => ({ x: i.x, y: i.y, t: i.t })), dot: state.dot, reroll: state.reroll, lines: state.lines, used: 0, gain: 0, steps: [], dotsUsed: 0 };
    root.q = qv(root, w, vfCur);
    let layer = [root];
    if (maxDots) layer = layer.concat(dotChildren(root, state.gravity, w, maxDots));
    let lastLayer = layer, depth = 0;
    for (let d = 0; d < need; d++) {
      const children = [];
      for (const n of layer) expandNode(n, hand, state.gravity, w, children);
      if (!children.length) break;
      let top = selectTop(children, d === need - 1 ? finalK : beam);
      if (maxDots && d < need - 1) {
        const extra = []; for (const n of top) for (const c of dotChildren(n, state.gravity, w, maxDots)) { c.dotsUsed = (n.dotsUsed || 0) + 1; extra.push(c); }
        if (extra.length) top = selectTop(top.concat(extra), beam + 4);
      }
      layer = top; lastLayer = top; depth = d + 1;
    }
    if (maxDots) { // 마지막 단계 이후 점찍기로 줄 완성 가능하면 후보 추가
      const extra = []; for (const n of lastLayer) for (const c of dotChildren(n, state.gravity, w, maxDots)) extra.push(c);
      lastLayer = lastLayer.concat(extra);
    }
    const complete = depth === need;
    for (const n of lastLayer) n.v = n.gain + (vfCur ? vfCur.full(n) : fullEval(n, w)) - (complete ? 0 : 5000 * (need - depth));
    lastLayer.sort((a, b) => b.v - a.v);
    return { complete, depth, need, plans: lastLayer };
  }

  // 첫 수가 서로 다른 후보 k개 + 각 후보의 최선 후속 수순
  function diversePlans(state, opts, k) {
    const w = opts.w || WEIGHTS, beam = opts.beam || 12;
    const full = plan(state, { w, beam, finalK: beam * 4, vf: opts.vf });
    const root = { rows: state.rows.slice(), icons: state.icons.map(i => ({ x: i.x, y: i.y, t: i.t })), dot: state.dot, reroll: state.reroll, lines: state.lines, used: 0, gain: 0, steps: [], dotsUsed: 0 };
    let firsts = [];
    vfCur = opts.vf || null; expandNode(root, state.hand, state.gravity, w, firsts);
    firsts = firsts.concat(dotChildren(root, state.gravity, w, 1));
    firsts = selectTop(firsts, k * 3);
    const sig = t => t.type + ':' + t.piece + ':' + t.v + ':' + t.x + ':' + t.y;
    const out = [], seen = new Set();
    const push = n => { const key = n.steps.map(sig).join('/'); if (seen.has(key)) return; seen.add(key); out.push(n); };
    for (const f of firsts) {
      const st = { rows: f.rows.slice(), icons: f.icons.map(i => ({ ...i })), dot: f.dot, reroll: f.reroll, lines: f.lines, gravity: state.gravity, hand: state.hand.slice() };
      for (let s = 0; s < 3; s++) if ((f.used >> s) & 1) st.hand[s] = -1;
      const rest = plan(st, { w, vf: opts.vf, beam: Math.max(6, beam >> 1), finalK: beam, maxDots: f.steps[0].type === 'dot' ? 1 : 2 });
      if (rest.plans.length && (rest.depth > 0 || rest.need === 0)) {
        const b = rest.plans[0];
        push({ steps: f.steps.concat(b.steps), gain: f.gain + b.gain, v: f.gain + b.v, rows: b.rows, dot: b.dot, complete: rest.complete });
      } else if (rest.need === 0) push({ steps: f.steps, gain: f.gain, v: f.gain + (opts.vf ? opts.vf.full(f) : fullEval(f, w)), rows: f.rows, dot: f.dot, complete: true });
      else push({ steps: f.steps, gain: f.gain, v: f.gain + (opts.vf ? opts.vf.full(f) : fullEval(f, w)) - 5000 * rest.need, rows: f.rows, dot: f.dot, complete: false });
    }
    if (full.plans.length) push(full.plans[0]);
    out.sort((a, b) => b.v - a.v);
    // 같은 첫 수는 1개만 (최상위 전체 수순은 유지)
    const res = [], firstSeen = new Set(), boardSeen = new Set();
    for (const n of out) {
      const f = sig(n.steps[0]), b = Array.prototype.join.call(n.rows, ',') + '|' + n.dot;
      if (firstSeen.has(f) || boardSeen.has(b)) continue;
      firstSeen.add(f); boardSeen.add(b); res.push(n); if (res.length >= k) break;
    }
    return { complete: full.complete, depth: full.depth, need: full.need, plans: res };
  }

  // 막혔을 때: 바꿔뽑기 → 점찍기 순. 시뮬레이션 정책용
  function rescue(st, R, w) {
    // 배치 불가 슬롯 찾기
    for (let s = 0; s < 3; s++) {
      if (st.hand[s] < 0) continue;
      if (!anyFit(st.rows, PIECES[st.hand[s]]) && st.reroll > 0) { st.reroll--; st.hand[s] = drawPiece(st.lines, R); return true; }
    }
    if (st.dot > 0) {
      let by = -1, bf = -1;
      for (let y = 0; y < H; y++) { const f = POP[st.rows[y]]; if (f < 10 && f > bf) { bf = f; by = y; } }
      if (by >= 0) { const x = Math.log2((~st.rows[by]) & FULL & -((~st.rows[by]) & FULL)) | 0; placeDot(st, x, by); return true; }
    }
    if (st.reroll > 0) { for (let s = 0; s < 3; s++) if (st.hand[s] >= 0) { st.reroll--; st.hand[s] = drawPiece(st.lines, R); return true; } }
    return false;
  }
  function fillHand(st, R) { if (st.hand.every(h => h < 0)) for (let s = 0; s < 3; s++) st.hand[s] = drawPiece(st.lines, R); }

  // 한 손(3조각) 진행. 반환 false=게임오버
  function playHand(st, R, opts) {
    for (let guard = 0; guard < 30; guard++) {
      if (st.hand.every(h => h < 0)) return true;
      const res = plan(st, opts);
      if (res.complete && res.plans.length) {
        applyPlan(st, res.plans[0], R);
        return true;
      }
      // 일부만 가능: 가능한 첫 수 진행 후 구조
      if (res.plans.length && res.depth > 0) {
        const step = res.plans[0].steps.find(s => s.type === 'piece');
        applyStep(st, step, R);
        continue;
      }
      if (!rescue(st, R, opts.w)) return false;
    }
    return false;
  }
  function applyStep(st, s, R) {
    if (s.type === 'dot') return placeDot(st, s.x, s.y);
    const r = placePiece(st, s.slot, s.v, s.x, s.y);
    if (R) maybeSpawn(st, R);
    return r;
  }
  function applyPlan(st, p, R) { for (const s of p.steps) applyStep(st, s, R); }

  function simulate(startState, R, opts, maxHands) {
    const st = cloneState(startState);
    fillHand(st, R);
    let hands = 0, alive = true;
    while (hands < maxHands && st.score < 500000) {
      if (!playHand(st, R, opts)) { alive = false; break; }
      hands++;
      fillHand(st, R);
    }
    return { score: st.score, lines: st.lines, hands, alive, state: st };
  }

  const api = { W, H, FULL, POP, PIECE_DEFS, PIECES, NP, PROB, WKEYS, get WEIGHTS() { return WEIGHTS; }, setWeights(w) { WEIGHTS = Object.assign({}, WEIGHTS, w); },
    makeProbTable, setFinalRatio, stageOf, rng, drawPiece, fits, anyFit, countFit, clearRows, lineScore, newState, cloneState, placePiece, placeDot,
    maybeSpawn, quickEval, fitEval, fullEval, plan, diversePlans, rescue, fillHand, playHand, applyStep, applyPlan, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoaCore = api;
})(typeof self !== 'undefined' ? self : this);
