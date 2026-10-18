/**
 * tests/ui.smoke.test.mjs
 * 用 jsdom 真正跑一遍 index.html + src/main.js，验证首屏渲染与交互。
 *
 * 该测试是开发辅助（devDependency jsdom），不参与页面运行时。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const waitFor = async (fn, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('等待超时');
};

test('首屏渲染与角色切换（jsdom 冒烟测试）', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8000/' });

  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.history = dom.window.history;

  // 用本地文件模拟 fetch，避免依赖静态服务器
  global.fetch = async (url) => {
    const name = String(url).replace(/^\.?\/?data\//, '');
    const file = path.join(ROOT, 'data', name);
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };

  await import('../src/main.js');
  await waitFor(() => document.querySelectorAll('.char-item').length > 0);

  // 1. 角色列表渲染出全部角色
  const items = document.querySelectorAll('.char-item');
  assert.equal(items.length, 98, '应渲染 98 名角色');

  // 2. 版本信息写入顶栏
  assert.match(document.querySelector('#data-version').textContent, /98 角色/);

  // 3. 右侧面板渲染出 11 项属性
  const stats = document.querySelectorAll('.result .stat');
  assert.equal(stats.length, 11, '面板应有 11 行');

  // 4. 默认角色（姬子 lv80、无光锥、无遗器）生命值 = 1047.816 → 显示 1,048
  const hpRow = [...stats].find((s) => s.textContent.includes('生命值'));
  assert.ok(hpRow, '面板应包含生命值');
  assert.equal(hpRow.querySelector('b').textContent.replace(/,/g, ''), '1048');

  // 5. 点击「三月七」切换角色后，面板应随角色变化
  const march = [...items].find((i) => i.textContent.includes('三月七'));
  assert.ok(march, '列表应包含三月七');
  march.click();
  await waitFor(() => document.querySelector('.result .char-summary h2')?.textContent === '三月七');

  const marchHp = [...document.querySelectorAll('.result .stat')].find((s) => s.textContent.includes('生命值'));
  assert.equal(marchHp.querySelector('b').textContent.replace(/,/g, ''), '1058');

  // 6. 给头部装备「云无留迹的过客」→ 主词条数值与面板实时更新
  const headSet = document.querySelector('[data-set="head"]');
  headSet.value = '101';
  headSet.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  await waitFor(() => document.querySelector('[data-main-value="head"]')?.textContent === '705.60');
  const hpAfter = [...document.querySelectorAll('.result .stat')].find((s) => s.textContent.includes('生命值'));
  assert.equal(hpAfter.querySelector('b').textContent.replace(/,/g, ''), '1764');

  // 7. 状态已序列化进 URL（分享链接）
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(dom.window.location.hash.length > 10, '状态应写入 URL hash');

  // 8. 伤害模拟结果区渲染（v0.2）
  const damageTitle = [...document.querySelectorAll('.result .section-title')].find((t) =>
    t.textContent.includes('伤害模拟'),
  );
  assert.ok(damageTitle, '伤害模拟结果应渲染');
  const damageSection = damageTitle.closest('.section');
  const damageValues = [...damageSection.querySelectorAll('.base-item b')].map((b) =>
    Number(b.textContent.replace(/[^\d.]/g, '')),
  );
  assert.ok(damageValues.length >= 3, '应展示不暴击/暴击/期望伤害');
  assert.ok(damageValues.every((v) => v > 0), '伤害数值应为正数');

  // 9. 加强角色显示「加强前 / 加强后」模板切换
  const walter = [...document.querySelectorAll('.char-item')].find((i) => i.textContent.includes('瓦尔特'));
  walter.click();
  await waitFor(() => document.querySelectorAll('[data-skill-mode]').length === 2);
  document.querySelector('[data-skill-mode="enhanced"]').click();
  await waitFor(() => document.querySelector('[data-skill-mode="enhanced"]').classList.contains('active'));
  assert.ok(document.querySelector('[data-skill-mode="base"]'), '应保留加强前按钮');

  // 10. 有变体的角色出现「变体技能」折叠区
  const danheng = [...document.querySelectorAll('.char-item')].find((i) => i.textContent.includes('丹恒•饮月'));
  danheng.click();
  await waitFor(() => document.querySelector('.variant-box') !== null);
  assert.match(document.querySelector('.variant-box summary').textContent, /变体技能/);

  // 11. v0.3 词条收益卡 + 快照对比
  assert.ok(document.querySelector('.gain-list'), '词条收益应渲染');
  document.querySelector('[data-action="snapshot"]').click();
  await waitFor(() => document.querySelector('.diff-table') !== null);
  assert.ok(document.querySelector('.diff-head'), '快照对比表应出现');
});
