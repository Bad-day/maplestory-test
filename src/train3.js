// 전체 판 CEM: node train3.js <gens> <pop> <games> <init.json> <out.json> <beam>
const { Worker, isMainThread, parentPort } = require('worker_threads');
const C = require('./core.js'); const fs = require('fs');
if (!isMainThread) {
  parentPort.on('message', ({ id, w, seeds, beam }) => {
    const scores = [];
    for (const sd of seeds) { const s = C.newState(); const r = C.simulate(s, C.rng(sd), { w, beam, finalK: beam * 2 }, 1e6); scores.push(r.score); }
    parentPort.postMessage({ id, scores });
  });
  return;
}
const [GENS, POP, GAMES] = process.argv.slice(2, 5).map(Number), INIT = process.argv[5], OUT = process.argv[6], BEAM = +process.argv[7] || 4;
const keys = C.WKEYS; const init = JSON.parse(fs.readFileSync(INIT));
let mean = keys.map(k => init.mean[k] ?? ({ fitCnt: 200, minFit: 100 })[k] ?? C.WEIGHTS[k]);
let sd = mean.map((v, i) => (keys[i] === 'fitCnt' || keys[i] === 'minFit') ? 150 : Math.abs(v) * 0.3 + 2);
let total = 0, prev = init.totalGames || 0;
const nw = 2, workers = Array.from({ length: nw }, () => new Worker(__filename));
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function evalAll(cands, seeds) {
  // 후보×게임 분할을 작업 단위로 쪼개 두 스레드에 분배
  const jobs = []; const chunk = Math.ceil(seeds.length / 2);
  cands.forEach((w, id) => { for (let i = 0; i < seeds.length; i += chunk) jobs.push({ id, w, seeds: seeds.slice(i, i + chunk) }); });
  const out = cands.map(() => []);
  return new Promise(res => {
    let next = 0, done = 0;
    const run = wk => { if (next >= jobs.length) return; const j = jobs[next++];
      wk.once('message', m => { out[m.id].push(...m.scores); total += m.scores.length; if (++done === jobs.length) res(out); else run(wk); });
      wk.postMessage({ id: j.id, w: j.w, seeds: j.seeds, beam: BEAM }); };
    workers.forEach(run);
  });
}
(async () => {
  for (let g = 0; g < GENS; g++) {
    const seeds = Array.from({ length: GAMES }, (_, i) => 1e6 + g * 9973 + i * 31);
    const vecs = [mean.slice()]; for (let i = 1; i < POP; i++) vecs.push(mean.map((m, k) => m + sd[k] * gauss()));
    const cands = vecs.map(v => Object.fromEntries(keys.map((k, i) => [k, v[i]])));
    const t0 = Date.now(); const sc = await evalAll(cands, seeds);
    const fit = sc.map(a => a.reduce((x, y) => x + y, 0) / a.length);
    const order = fit.map((_, i) => i).sort((a, b) => fit[b] - fit[a]); const elite = order.slice(0, Math.max(4, POP >> 2));
    mean = keys.map((_, k) => elite.reduce((a, i) => a + vecs[i][k], 0) / elite.length);
    sd = keys.map((_, k) => { const m = mean[k]; return Math.sqrt(elite.reduce((a, i) => a + (vecs[i][k] - m) ** 2, 0) / elite.length) + Math.abs(m) * 0.04 + 0.5; });
    const line = `gen ${g} best ${fit[order[0]].toFixed(0)} meanCand ${fit[0].toFixed(0)} max ${Math.max(...sc.flat())} games ${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`;
    console.log(line);
    fs.writeFileSync(OUT, JSON.stringify({ mean: Object.fromEntries(keys.map((k, i) => [k, +mean[i].toFixed(3)])), totalGames: prev + total, gen: g }, null, 1));
  }
  workers.forEach(w => w.terminate());
})();
