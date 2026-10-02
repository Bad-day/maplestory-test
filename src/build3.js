// 페이지 빌드: node build3.js td2.bin "<벤치 문구>" [출력경로=../index.html]
const fs=require('fs'); const {load}=require('./td2.js');
const wj=JSON.parse(fs.readFileSync('weights3.json')); const o=load(process.argv[2]);
const b64=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64');
const t=o.T.map(f=>{ let mx=0; for(const v of f) mx=Math.max(mx,Math.abs(v)); const s=(mx||1)/32767; const q=new Int16Array(f.length); for(let i=0;i<f.length;i++) q[i]=Math.round(f[i]/s); return {s,d:b64(q)}; });
const nt=`self.MOA_NT=${JSON.stringify({L:o.L,games:o.games,t})};`;
let h=fs.readFileSync('app.html','utf8');
h=h.replace('/*CORE*/',()=>fs.readFileSync('core.js','utf8'));
h=h.replace('/*NTV*/',()=>fs.readFileSync('ntv2.js','utf8'));
h=h.replace('/*NTDATA*/',()=>nt);
h=h.replace('/*WEIGHTS*/',()=>`self.MOA_TRAIN=${JSON.stringify({games:wj.totalGames, td:o.games, bench:process.argv[3]||''})};\nself.MoaCore.setWeights(${JSON.stringify(wj.mean)});`);
const out=process.argv[4]||'../index.html'; fs.writeFileSync(out,h); console.log('built',(h.length/1e6).toFixed(2),'MB td games',o.games);
