const C=require('./core.js'); const fs=require('fs');
const [N,beam,start]=process.argv.slice(2,5).map(Number), f=process.argv[5];
const w=Object.assign({},C.WEIGHTS,JSON.parse(fs.readFileSync(f)).mean);
const sc=[]; let t=Date.now();
for(let i=0;i<N;i++){ const r=C.simulate(C.newState(),C.rng(start+i),{w,beam,finalK:beam*2},1e6); sc.push(r.score); }
sc.sort((a,b)=>a-b); const m=sc.reduce((a,b)=>a+b)/N;
console.log(f,'beam',beam,'N',N,'mean',Math.round(m),'median',sc[N>>1],'p90',sc[Math.floor(N*.9)],'max',sc[N-1],'sec',((Date.now()-t)/1000).toFixed(0));
