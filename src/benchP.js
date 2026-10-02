// 병렬 벤치마크: node benchP.js <판 수> <탐색 폭> <시작 시드> <모델.bin> [스레드=CPU 수]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
if (!isMainThread) {
  const C = require('./core.js'), fs = require('fs'), V = require('./ntv2.js'); const { load } = require('./td2.js');
  const { file, beam } = workerData;
  const w = Object.assign({}, C.WEIGHTS, JSON.parse(fs.readFileSync(__dirname + '/weights3.json')).mean);
  const o = load(file);
  if (process.env.VF_L) { const l = process.env.VF_L.split(',').map(Number); if (l[0] >= 0) o.L[1] = l[0]; if (l[1] >= 0) o.L[2] = l[1]; }
  const vf = V.makeVF({ T: o.T, L: Float32Array.from(o.L) }, w);
  parentPort.on('message', seed => {
    if (seed < 0) process.exit(0);
    const opts = { w, vf, beam, finalK: beam * 2 };
    if (process.env.LOOK) { const [K, M, b] = process.env.LOOK.split(',').map(Number); opts.look = { K, M, beam: b }; opts.lookR = C.rng(seed ^ 0x5bd1e995); }
    const r = C.simulate(C.newState(), C.rng(seed), opts, 1e6);
    parentPort.postMessage({ seed, score: r.score, lines: r.lines });
  });
} else {
  const [N, beam, start] = process.argv.slice(2, 5).map(Number), file = process.argv[5];
  const nt = +process.argv[6] || os.cpus().length;
  const sc = []; let next = 0; const t = Date.now();
  for (let i = 0; i < nt; i++) {
    const wk = new Worker(__filename, { workerData: { file, beam } });
    wk.on('message', r => {
      sc.push(r.score);
      if (next < N) wk.postMessage(start + next++); else wk.postMessage(-1);
      if (sc.length === N) {
        sc.sort((a, b) => a - b); const m = sc.reduce((a, b) => a + b) / N;
        const sd = Math.sqrt(sc.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1));
        console.log(file, 'beam', beam, 'N', N, 'mean', Math.round(m), '±', Math.round(1.96 * sd / Math.sqrt(N)), 'median', sc[N >> 1],
          'p10', sc[Math.floor(N * .1)], 'cap', sc.filter(s => s >= 500000).length, 'max', sc[N - 1], 'sec', ((Date.now() - t) / 1000).toFixed(0));
      }
    });
    if (next < N) wk.postMessage(start + next++);
  }
}
