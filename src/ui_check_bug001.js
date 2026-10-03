// 버그 001 회귀 확인 (docs/bugs/001-추천-수순-일부만-표시.md)
// 추천 후보를 누르면 판에 그 수순의 모든 수 번호가 보여야 한다. 1수째가 줄을 지우는 경우도 마찬가지.
// node ui_check_bug001.js [페이지 경로=../index.html]   (Playwright 필요: npm i -g playwright)
const path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
(async () => {
  const page = 'file://' + path.resolve(__dirname, process.argv[2] || '../index.html');
  const b = await pw.chromium.launch(); const pg = await b.newPage({ viewport: { width: 1300, height: 1000 } });
  await pg.addInitScript(() => { try { localStorage.clear(); } catch (e) {} }); // 예시 판으로 시작
  await pg.goto(page);
  await pg.waitForFunction(() => /완료/.test(document.getElementById('prog').textContent), null, { timeout: 60000 });
  if (await pg.locator('#moreRecs').isVisible()) await pg.click('#moreRecs'); // 후보 모두 펼치기
  const n = await pg.locator('#recs button.rec').count();
  let ok = 0, firstClear = 0; const bad = [];
  for (let i = 0; i < n; i++) {
    await pg.locator('#recs button.rec').nth(i).click();
    const r = await pg.evaluate(() => {
      const sel = document.querySelector('#recs button.rec[aria-pressed="true"]');
      const steps = sel.querySelectorAll('.st .num').length, first = sel.querySelector('.st');
      const shown = new Set(); document.querySelectorAll('#board .cell > .no').forEach(e => e.textContent.split('·').forEach(t => shown.add(t)));
      return { steps, firstClears: !!(first && first.querySelector('.cl')), shown: [...shown] };
    });
    if (Array.from({ length: r.steps }, (_, k) => String(k + 1)).every(k => r.shown.includes(k))) ok++; else bad.push(r);
    if (r.firstClears) firstClear++;
  }
  console.log(`후보 ${n}개 중 전체 수 번호 표시 ${ok}개, 1수째가 줄을 지우는 후보 ${firstClear}개`);
  await pg.locator('#recs button.rec').first().click();
  const view0 = await pg.textContent('#stepTxt'); console.log('기본 보기:', view0);
  await pg.click('#stepNext'); const view1 = await pg.textContent('#stepTxt'); console.log('다음 수 ▶:', view1);
  await b.close();
  const pass = n > 0 && ok === n && /겹쳐 보기/.test(view0) && /1수째 두기 직전/.test(view1);
  if (!pass) { console.log('FAIL', JSON.stringify(bad)); process.exit(1); }
  console.log('OK');
})();
