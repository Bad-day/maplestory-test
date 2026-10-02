const C=require('./core.js'); const assert=require('assert');
// 2줄 동시 제거: 행 14,15를 9칸 채우고 ㅣ(세로) 로 x=9 두 줄 채우기
let s=C.newState(); s.rows[14]=511; s.rows[15]=511; s.hand=[0,-1,-1]; // ㅡ 3칸: 가로라 2줄 불가 → ㄴ 사용
s.hand=[C.PIECES.findIndex(p=>p.name==='ㅣ'),-1,-1];
const p=C.PIECES[s.hand[0]]; const vi=p.variants.findIndex(v=>v.h===5);
s.rows[11]=511;s.rows[12]=511;s.rows[13]=511;
let r=C.placePiece(s,0,vi,9,11); assert.equal(r.cleared,5); assert.equal(r.gain,5+7500); 
assert.ok(s.rows.every(x=>x===0)); assert.equal(s.lines,5);
// 아이콘 획득 +50, 능력 최대면 획득 안 함
s=C.newState(); s.rows[15]=1023-1; s.icons=[{x:3,y:15,t:0}]; s.hand=[C.PIECES.findIndex(p=>p.name==='·'),-1,-1];
r=C.placePiece(s,0,0,0,15); assert.equal(r.gain,1+300+50); assert.equal(s.dot,1); assert.equal(s.icons.length,0);
s=C.newState(); s.dot=3; s.reroll=4; s.rows[15]=1022; s.icons=[{x:3,y:15,t:1}]; s.hand=[C.PIECES.findIndex(p=>p.name==='·'),-1,-1];
r=C.placePiece(s,0,0,0,15); assert.equal(r.gain,301); assert.equal(s.icons.length,1);
// 세로로 가득 차도 제거 안 됨
s=C.newState(); for(let y=0;y<16;y++) s.rows[y]=1; assert.equal(C.clearRows(s,false).n,0);
// 점찍기는 카운터 미포함
s=C.newState(); s.dot=1; C.placeDot(s,0,0); assert.equal(s.counter,0);
// 중력 옵션
s=C.newState(); s.gravity=true; s.rows[14]=5; s.rows[15]=1022; s.hand=[C.PIECES.findIndex(p=>p.name==='·'),-1,-1];
C.placePiece(s,0,0,0,15); assert.equal(s.rows[15],5);
console.log('rules OK');
