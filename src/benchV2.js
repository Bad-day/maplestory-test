const C=require('./core.js'), fs=require('fs'); const {load}=require('./td2.js'); const V=require('./ntv2.js');
const [N,beam,start]=process.argv.slice(2,5).map(Number); const file=process.argv[5];
const w=Object.assign({},C.WEIGHTS,JSON.parse(fs.readFileSync('weights3.json')).mean);
const o=load(file); const vf=V.makeVF({T:o.T,L:Float32Array.from(o.L)},w);
const sc=[]; const t=Date.now();
for(let i=0;i<N;i++){ const r=C.simulate(C.newState(),C.rng(start+i),{w,vf,beam,finalK:beam*2},1e6); sc.push(r.score); }
sc.sort((a,b)=>a-b); console.log(file,'games',o.games,'beam',beam,'N',N,'mean',Math.round(sc.reduce((a,b)=>a+b)/N),'median',sc[N>>1],'max',sc[N-1],'sec',((Date.now()-t)/1000).toFixed(0));
