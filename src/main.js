/**
 * src/main.js
 * 应用入口：状态管理 + 视图渲染 + 事件绑定。
 * 无框架、无构建，直接用 ES Module 跑在浏览器里。
 */
import { loadGameData, propertyName, propertyIsPercent } from './core/data.js';
import { computePanel, relicMainValue } from './core/stats.js';
import {
  computeDamage,
  skillMultipliers,
  DEFAULT_ENEMY,
  formatDamage,
} from './core/damage.js';
import {
  ascensionForLevel,
  RELIC_SLOTS,
  PANEL_ROWS,
  BUFF_FIELDS,
  ASCENSION_RANGES,
} from './core/constants.js';

const $ = (sel) => document.querySelector(sel);
const $id = (id) => document.getElementById(id);

let db = null;
let state = null;
/** 仅影响列表展示的筛选条件，不进入分享链接 */
const ui = { q: '', rarity: 0, path: '', element: '' };

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

function emptyRelic(slot) {
  const subs = [];
  for (let i = 0; i < 4; i++) subs.push({ type: '', value: 0 });
  return {
    setId: '',
    rarity: 5,
    level: slot.fixedMain ? 15 : 15,
    mainType: slot.fixedMain ?? '',
    subs,
  };
}

function defaultState() {
  const characterId = '1003';
  const char = db.charById.get(characterId);
  const relics = {};
  for (const slot of RELIC_SLOTS) relics[slot.key] = emptyRelic(slot);

  const traceLevels = {};
  for (const s of char.skills) traceLevels[s.id] = s.maxLevel;

  return {
    characterId,
    level: 80,
    lightConeId: '',
    lcLevel: 80,
    superimpose: 1,
    relics,
    buffs: {},
    minorEnabled: {},
    traceLevels,
    enemy: { ...DEFAULT_ENEMY },
    damageSkillId: firstDamageSkillId(char),
    damageParamIndex: 0,
    damageMultiplier: null,
  };
}

/** 切换角色时，把光锥、行迹等与角色绑定的状态重置到合理默认值 */
function switchCharacter(characterId) {
  const char = db.charById.get(characterId);
  if (!char) return;
  state.characterId = characterId;

  if (!state.lightConeId || db.lcById.get(state.lightConeId)?.path !== char.path) {
    state.lightConeId = '';
  }

  state.traceLevels = {};
  for (const s of char.skills) state.traceLevels[s.id] = s.maxLevel;
  state.minorEnabled = {};
  state.damageSkillId = firstDamageSkillId(char);
  state.damageParamIndex = 0;
  state.damageMultiplier = null;
  renderAll();
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const stars = (n) => '★'.repeat(n);

/** 行迹里的技能类型（数据里是 Normal / BPSkill / Ultra / Talent） */
const SKILL_TYPES = ['Normal', 'BPSkill', 'Ultra', 'Talent'];
const SKILL_LABELS = { Normal: '普攻', BPSkill: '战技', Ultra: '终结技', Talent: '天赋' };

/** 伤害模拟里优先展示的技能类型顺序 */
const DAMAGE_SKILL_ORDER = ['BPSkill', 'Ultra', 'Normal', 'Talent'];

/** 敌方参数的百分比字段（内部存小数） */
const ENEMY_PERCENT_FIELDS = ['res', 'resPen', 'defShred', 'defIgnore', 'vulnerability', 'dmgReduction'];

function firstDamageSkillId(char) {
  const list = (char?.skills ?? []).filter((s) => SKILL_TYPES.includes(s.type));
  for (const type of DAMAGE_SKILL_ORDER) {
    const found = list.find((s) => s.type === type && (s.params?.length ?? 0) > 0);
    if (found) return found.id;
  }
  return list[0]?.id ?? '';
}

function elementMeta(element) {
  return { name: db.meta.elements[element]?.name ?? element, color: db.meta.elements[element]?.color ?? '#888' };
}

function pathName(path) {
  return db.meta.paths[path]?.name ?? path;
}

/** 属性值展示：百分比特例 */
function displayValue(type, fraction) {
  return propertyIsPercent(db, type) ? (Number(fraction) * 100).toFixed(2) : Number(fraction).toFixed(2);
}

function fmtNumber(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('zh-CN');
}

/* ------------------------------------------------------------------ */
/* 左侧：角色列表                                                       */
/* ------------------------------------------------------------------ */

function renderFilters() {
  const paths = Object.entries(db.meta.paths).map(([id, p]) => ({ id, name: p.name }));
  const elements = Object.entries(db.meta.elements).map(([id, e]) => ({ id, name: e.name }));

  $('.sidebar').innerHTML = `
    <div class="filters">
      <input type="search" id="search" placeholder="搜索角色…" autocomplete="off" />
      <div class="chips" id="rarity-chips">
        <button class="chip active" data-rarity="0">全部</button>
        <button class="chip" data-rarity="5">五星</button>
        <button class="chip" data-rarity="4">四星</button>
      </div>
      <div class="filter-row">
        <select id="path-filter">
          <option value="">全部命途</option>
          ${paths.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <select id="element-filter">
          <option value="">全部属性</option>
          ${elements.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="char-list" id="char-list"></div>
  `;

  $id('search').addEventListener('input', (e) => {
    ui.q = e.target.value.trim();
    updateCharList();
  });
  $id('rarity-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rarity]');
    if (!btn) return;
    ui.rarity = Number(btn.dataset.rarity);
    for (const b of $id('rarity-chips').querySelectorAll('.chip')) b.classList.toggle('active', b === btn);
    updateCharList();
  });
  $id('path-filter').addEventListener('change', (e) => {
    ui.path = e.target.value;
    updateCharList();
  });
  $id('element-filter').addEventListener('change', (e) => {
    ui.element = e.target.value;
    updateCharList();
  });
}

function updateCharList() {
  const list = db.characters.filter(
    (c) =>
      (!ui.q || c.name.includes(ui.q) || c.tag.toLowerCase().includes(ui.q.toLowerCase())) &&
      (!ui.rarity || c.rarity === ui.rarity) &&
      (!ui.path || c.path === ui.path) &&
      (!ui.element || c.element === ui.element),
  );

  const html = list.length
    ? list
        .map((c) => {
          const em = elementMeta(c.element);
          const active = c.id === state.characterId ? ' active' : '';
          return `
            <button class="char-item${active}" data-character="${c.id}">
              <span class="char-avatar" style="color:${em.color};border-color:${em.color}44">${escapeHtml(c.name.slice(0, 1))}</span>
              <span class="char-meta">
                <span class="char-name">${escapeHtml(c.name)}</span>
                <span class="char-tags">
                  <span class="stars">${stars(c.rarity)}</span>
                  <span>${escapeHtml(pathName(c.path))}</span>
                  <span style="color:${em.color}">${escapeHtml(em.name)}</span>
                </span>
              </span>
            </button>`;
        })
        .join('')
    : '<p class="hint">没有匹配的角色</p>';

  $id('char-list').innerHTML = html;
}

/* ------------------------------------------------------------------ */
/* 中间：配装编辑                                                       */
/* ------------------------------------------------------------------ */

function renderConfig() {
  const char = db.charById.get(state.characterId);
  const asc = ascensionForLevel(state.level);
  const range = ASCENSION_RANGES[asc];

  const lcOptions = db.lightcones
    .filter((lc) => lc.path === char.path)
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));

  const lc = state.lightConeId ? db.lcById.get(state.lightConeId) : null;

  $('.config').innerHTML = `
    <section class="section">
      <h3 class="section-title">角色 <small>${escapeHtml(char.name)} · ${stars(char.rarity)}</small></h3>
      <div class="field">
        <label>等级</label>
        <div class="slider-row">
          <input type="range" id="level-range" min="1" max="80" value="${state.level}" data-bind="level" />
          <output id="level-out">${state.level}</output>
        </div>
      </div>
      <p class="hint" id="asc-hint">晋阶 ${asc} · 等级区间 ${range[0]}–${range[1]}</p>
    </section>

    <section class="section">
      <h3 class="section-title">光锥</h3>
      <div class="field">
        <label>光锥</label>
        <select data-bind="lightConeId">
          <option value="">不装备光锥</option>
          ${lcOptions
            .map(
              (o) =>
                `<option value="${o.id}"${o.id === state.lightConeId ? ' selected' : ''}>${escapeHtml(o.name)}（${stars(o.rarity)}）</option>`,
            )
            .join('')}
        </select>
      </div>
      ${
        lc
          ? `
      <div class="field">
        <label>等级</label>
        <div class="slider-row">
          <input type="range" id="lc-level-range" min="1" max="80" value="${state.lcLevel}" data-bind="lcLevel" />
          <output id="lc-level-out">${state.lcLevel}</output>
        </div>
      </div>
      <div class="field">
        <label>叠影</label>
        <select data-bind="superimpose">
          ${[1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === state.superimpose ? ' selected' : ''}>叠影 ${i} 阶</option>`).join('')}
        </select>
      </div>
      <p class="hint">${escapeHtml(lc.rank?.desc ?? '')}</p>`
          : ''
      }
    </section>

    <section class="section">
      <h3 class="section-title">行迹 <small>小行迹默认全部点亮</small></h3>
      <div class="trace-grid">
        ${char.skills
          .filter((s) => SKILL_TYPES.includes(s.type))
          .map((s) => {
            const lv = state.traceLevels[s.id] ?? s.maxLevel;
            return `
            <div class="field">
              <label>${escapeHtml(SKILL_LABELS[s.type] ?? s.typeText ?? s.name)}</label>
              <div class="slider-row">
                <input type="range" min="1" max="${s.maxLevel}" value="${lv}" data-bind="trace.${s.id}" />
                <output>Lv.${lv}</output>
              </div>
            </div>`;
          })
          .join('')}
      </div>
      <p class="hint">技能等级会用于「伤害模拟」的倍率取用，面板计算本身不计技能倍率。</p>
      <div class="minor-traces">
        ${char.traces
          .map((t) => {
            const on = state.minorEnabled[t.id] !== false;
            const prop = t.levels.flatMap((lv) => lv.properties)[0];
            const label = prop ? `${propertyName(db, prop[0])} +${displayValue(prop[0], prop[1])}%` : t.name;
            return `
              <label class="minor-chip${on ? ' on' : ''}">
                <input type="checkbox" data-minor="${t.id}" ${on ? 'checked' : ''} />
                ${escapeHtml(label)}
              </label>`;
          })
          .join('')}
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">遗器 <small>4 件隧洞 + 2 件位面</small></h3>
      <div class="relic-grid">
        ${RELIC_SLOTS.map((slot) => renderRelicCard(slot)).join('')}
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">手动增益 <small>模拟战斗内 buff</small></h3>
      <div class="relic-grid">
        ${BUFF_FIELDS.map((f) => {
          const value = state.buffs[f.key] ?? 0;
          return `
            <div class="field">
              <label>${escapeHtml(f.label)}</label>
              <input type="number" step="any" value="${value}" data-buff="${f.key}" />
            </div>`;
        }).join('')}
      </div>
    </section>

    ${renderDamageConfig(char)}
  `;
}

/** 伤害模拟的输入区 */
function renderDamageConfig(char) {
  const skills = char.skills.filter((s) => SKILL_TYPES.includes(s.type) && (s.params?.length ?? 0) > 0);
  const skill = skills.find((s) => s.id === state.damageSkillId) ?? skills[0];
  if (!skill) return '';

  const level = state.traceLevels[skill.id] ?? skill.maxLevel;
  const multipliers = skillMultipliers(skill, level);
  const paramIndex = Math.min(state.damageParamIndex ?? 0, Math.max(0, multipliers.length - 1));
  const autoMultiplier = multipliers[paramIndex] ?? 0;
  const override = state.damageMultiplier;

  const pct = (key) => (Number(state.enemy[key] ?? 0) * 100).toFixed(1);

  return `
    <section class="section">
      <h3 class="section-title">伤害模拟 <small>直伤公式 · v0.2</small></h3>

      <div class="field">
        <label>技能</label>
        <select data-damage-skill>
          ${skills
            .map(
              (s) =>
                `<option value="${s.id}"${s.id === skill.id ? ' selected' : ''}>${SKILL_LABELS[s.type] ?? s.type} · ${escapeHtml(s.name)}</option>`,
            )
            .join('')}
        </select>
      </div>

      <div class="field">
        <label>倍率段</label>
        <select data-damage-param>
          ${
            multipliers.length
              ? multipliers
                  .map(
                    (v, i) =>
                      `<option value="${i}"${i === paramIndex ? ' selected' : ''}>第 ${i + 1} 段 · ${(v * 100).toFixed(1)}%</option>`,
                  )
                  .join('')
              : '<option value="0">该技能无倍率数据</option>'
          }
        </select>
      </div>

      <div class="field">
        <label>倍率 %</label>
        <input type="number" step="any" placeholder="自动：${(autoMultiplier * 100).toFixed(1)}"
               value="${override == null ? '' : override}" data-damage-multiplier />
      </div>

      <p class="hint">技能等级跟随「行迹」设置（当前 Lv.${level}）；倍率留空则使用数据表自动值。</p>

      <div class="relic-grid">
        <div class="field">
          <label>敌方等级</label>
          <input type="number" min="1" max="100" value="${state.enemy.level}" data-enemy="level" />
        </div>
        <div class="field">
          <label>抗性 %</label>
          <input type="number" step="any" value="${pct('res')}" data-enemy="res" />
        </div>
        <div class="field">
          <label>穿透 %</label>
          <input type="number" step="any" value="${pct('resPen')}" data-enemy="resPen" />
        </div>
        <div class="field">
          <label>减防 %</label>
          <input type="number" step="any" value="${pct('defShred')}" data-enemy="defShred" />
        </div>
        <div class="field">
          <label>无视防御 %</label>
          <input type="number" step="any" value="${pct('defIgnore')}" data-enemy="defIgnore" />
        </div>
        <div class="field">
          <label>易伤 %</label>
          <input type="number" step="any" value="${pct('vulnerability')}" data-enemy="vulnerability" />
        </div>
        <div class="field">
          <label>减伤 %</label>
          <input type="number" step="any" value="${pct('dmgReduction')}" data-enemy="dmgReduction" />
        </div>
        <div class="field">
          <label>韧性</label>
          <label class="minor-chip${state.enemy.broken ? ' on' : ''}" style="width:100%">
            <input type="checkbox" data-enemy-broken ${state.enemy.broken ? 'checked' : ''} /> 已击破
          </label>
        </div>
      </div>
    </section>`;
}

function renderRelicCard(slot) {
  const relic = state.relics[slot.key];
  const sets = slot.kind === 'cavern' ? db.cavernSets : db.planarSets;

  let mainField;
  if (slot.fixedMain) {
    const mainValue = relicMainValue(db, slot, relic);
    mainField = `
      <div class="field">
        <label>主词条</label>
        <span class="relic-main">${escapeHtml(propertyName(db, slot.fixedMain))}
          <b data-main-value="${slot.key}">${displayValue(slot.fixedMain, mainValue.value)}</b></span>
      </div>`;
  } else {
    const options = relic.setId ? db.mainAffixOptions(relic.setId, slot.type, relic.rarity) : [];
    const mainValue = relicMainValue(db, slot, relic);
    mainField = `
      <div class="field">
        <label>主词条</label>
        <select data-main="${slot.key}">
          ${
            options.length
              ? options
                  .map(
                    (o) =>
                      `<option value="${o.type}"${o.type === relic.mainType ? ' selected' : ''}>${escapeHtml(propertyName(db, o.type))}</option>`,
                  )
                  .join('')
              : '<option value="">先选择套装</option>'
          }
        </select>
      </div>
      <p class="relic-main">数值 <b data-main-value="${slot.key}">${relic.mainType ? displayValue(relic.mainType, mainValue.value) : '—'}</b></p>`;
  }

  return `
    <div class="relic-card">
      <div class="relic-head">
        <span class="relic-slot">${escapeHtml(slot.label)}</span>
        <span class="relic-main">${slot.kind === 'cavern' ? '隧洞' : '位面'}</span>
      </div>

      <div class="field">
        <label>套装</label>
        <select data-set="${slot.key}">
          <option value="">不装备</option>
          ${sets
            .map(
              (s) =>
                `<option value="${s.id}"${s.id === relic.setId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`,
            )
            .join('')}
        </select>
      </div>

      <div class="field">
        <label>强化</label>
        <div class="slider-row">
          <input type="range" min="0" max="15" value="${relic.level}" data-relic-level="${slot.key}" />
          <output>+${relic.level}</output>
        </div>
      </div>

      ${mainField}

      <div class="subs">
        ${relic.subs
          .map(
            (sub, i) => `
          <div class="sub-row">
            <select data-sub-type="${slot.key}" data-index="${i}">
              <option value="">副词条 ${i + 1}</option>
              ${subAffixOptions()
                .map(
                  (o) =>
                    `<option value="${o.type}"${o.type === sub.type ? ' selected' : ''}>${escapeHtml(propertyName(db, o.type))}</option>`,
                )
                .join('')}
            </select>
            <input type="number" step="any" value="${sub.type ? displayValue(sub.type, sub.value) : ''}"
                   data-sub-value="${slot.key}" data-index="${i}" ${sub.type ? '' : 'disabled'} />
          </div>`,
          )
          .join('')}
      </div>
    </div>`;
}

/** 副词条候选项：取五星副词条表里的全部属性 */
function subAffixOptions() {
  const list = db.relics.subAffixes['5'] ?? [];
  const seen = new Set();
  return list.filter((a) => (seen.has(a.type) ? false : (seen.add(a.type), true)));
}

/* ------------------------------------------------------------------ */
/* 右侧：面板结果                                                       */
/* ------------------------------------------------------------------ */

function renderResult() {
  const r = computePanel(db, state);
  const { char, base, panel, dmgBonus, activeSets } = r;
  const em = elementMeta(char.element);

  const barMax = {
    hp: 12000,
    atk: 5000,
    def: 3000,
    spd: 200,
    cr: 1,
    cd: 3,
    ehr: 1.5,
    res: 1,
    be: 4,
    err: 2,
    heal: 1,
  };

  const statsHtml = PANEL_ROWS.map((row) => {
    const value = panel[row.key];
    const digits = row.digits ?? (row.kind === 'percent' ? 1 : 0);
    const shown = row.kind === 'percent' ? `${(value * 100).toFixed(digits)}%` : value.toFixed(digits);
    const pct = Math.max(0, Math.min(1, value / (barMax[row.key] ?? 1)));
    return `
      <div class="stat">
        <div class="stat-top"><span>${row.label}</span><b>${shown}</b></div>
        <div class="bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      </div>`;
  }).join('');

  const dmgChips = Object.entries(dmgBonus)
    .map(([element, bonus]) => {
      const m = elementMeta(element);
      const highlight = element === char.element ? ' style="border-color:' + m.color + '"' : '';
      return `<span class="dmg-chip"${highlight}>${escapeHtml(m.name)}增伤 <b>${((bonus - 1) * 100).toFixed(1)}%</b></span>`;
    })
    .join('');

  const setHtml = activeSets.length
    ? activeSets
        .map(
          (s) => `<div class="set-item"><b>${escapeHtml(s.name)}</b>（${s.pieces} 件）${escapeHtml(s.desc)}</div>`,
        )
        .join('')
    : '<p class="hint">未激活套装效果</p>';

  $('.result').innerHTML = `
    <div class="char-summary">
      <div class="avatar" style="color:${em.color}">${escapeHtml(char.name.slice(0, 1))}</div>
      <div>
        <h2>${escapeHtml(char.name)}</h2>
        <p><span class="stars">${stars(char.rarity)}</span> · ${escapeHtml(pathName(char.path))} · ${escapeHtml(em.name)} · Lv.${state.level}</p>
      </div>
    </div>

    <section class="section">
      <h3 class="section-title">面板</h3>
      <div class="panel-list">${statsHtml}</div>
    </section>

    ${renderDamageResult(r)}

    <section class="section">
      <h3 class="section-title">基础白字 <small>角色 + 光锥</small></h3>
      <div class="base-grid">
        <div class="base-item">生命<b>${fmtNumber(base.hp)}</b></div>
        <div class="base-item">攻击<b>${fmtNumber(base.atk)}</b></div>
        <div class="base-item">防御<b>${fmtNumber(base.def)}</b></div>
        <div class="base-item">速度<b>${base.spd.toFixed(0)}</b></div>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">属性增伤</h3>
      <div class="dmg-bonus">${dmgChips}</div>
    </section>

    <section class="section">
      <h3 class="section-title">套装效果</h3>
      <div class="set-list">${setHtml}</div>
    </section>

    <p class="hint">条件型加成（如「对负面状态敌人增伤」）不会自动计入，请用「手动增益」补正。</p>
  `;
}

/** 伤害模拟的结果区 */
function renderDamageResult(panelResult) {
  const { char } = panelResult;
  const skills = char.skills.filter((s) => SKILL_TYPES.includes(s.type) && (s.params?.length ?? 0) > 0);
  const skill = skills.find((s) => s.id === state.damageSkillId) ?? skills[0];
  if (!skill) return '';

  const level = state.traceLevels[skill.id] ?? skill.maxLevel;
  const multipliers = skillMultipliers(skill, level);
  const idx = Math.min(state.damageParamIndex ?? 0, Math.max(0, multipliers.length - 1));
  const multiplier = state.damageMultiplier != null ? state.damageMultiplier / 100 : (multipliers[idx] ?? 0);

  const dmg = computeDamage(panelResult, skill, {
    level: state.level,
    multiplier,
    enemy: state.enemy,
  });

  return `
    <section class="section">
      <h3 class="section-title">伤害模拟 <small>${escapeHtml(SKILL_LABELS[skill.type] ?? '')} · ${escapeHtml(skill.name)} Lv.${level}</small></h3>
      <div class="base-grid">
        <div class="base-item">不暴击<b>${formatDamage(dmg.nonCrit)}</b></div>
        <div class="base-item">暴击<b>${formatDamage(dmg.crit)}</b></div>
      </div>
      <div class="base-grid" style="margin-top:8px">
        <div class="base-item">期望伤害<b>${formatDamage(dmg.expected)}</b></div>
        <div class="base-item">技能倍率<b>${(dmg.multiplier * 100).toFixed(1)}%</b></div>
      </div>
      <p class="hint">
        基础 ${formatDamage(dmg.base)}（${dmg.scalingLabel} ${formatDamage(dmg.statValue)}） ·
        增伤 ${(dmg.dmgMul * 100).toFixed(1)}% ·
        防御 ${dmg.defMul.toFixed(3)} ·
        抗性 ${dmg.resMul.toFixed(2)} ·
        易伤 ${dmg.vulnMul.toFixed(2)} ·
        减伤 ${dmg.redMul.toFixed(2)} ·
        韧性 ${dmg.toughnessMul.toFixed(2)}
      </p>
      <p class="hint">敌方默认 20% 抗性；直伤公式不含击破伤害与持续伤害。</p>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 全量渲染                                                            */
/* ------------------------------------------------------------------ */

function renderAll() {
  updateCharList();
  renderConfig();
  renderResult();
  saveUrl();
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

function onInput(e) {
  const t = e.target;

  if (t.dataset.bind === 'level') {
    state.level = Number(t.value);
    $id('level-out').textContent = state.level;
    const asc = ascensionForLevel(state.level);
    const range = ASCENSION_RANGES[asc];
    $id('asc-hint').textContent = `晋阶 ${asc} · 等级区间 ${range[0]}–${range[1]}`;
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.bind === 'lcLevel') {
    state.lcLevel = Number(t.value);
    const out = $id('lc-level-out');
    if (out) out.textContent = state.lcLevel;
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.bind?.startsWith('trace.')) {
    const id = t.dataset.bind.slice('trace.'.length);
    state.traceLevels[id] = Number(t.value);
    t.nextElementSibling.textContent = `Lv.${t.value}`;
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.relicLevel) {
    const key = t.dataset.relicLevel;
    state.relics[key].level = Number(t.value);
    t.nextElementSibling.textContent = `+${t.value}`;
    const slot = RELIC_SLOTS.find((s) => s.key === key);
    const valueEl = document.querySelector(`[data-main-value="${key}"]`);
    if (valueEl && slot) {
      const mv = relicMainValue(db, slot, state.relics[key]);
      valueEl.textContent = displayValue(mv.type, mv.value);
    }
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.subValue) {
    const key = t.dataset.subValue;
    const i = Number(t.dataset.index);
    const sub = state.relics[key].subs[i];
    if (!sub.type) return;
    const raw = Number(t.value) || 0;
    sub.value = propertyIsPercent(db, sub.type) ? raw / 100 : raw;
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.enemy) {
    const key = t.dataset.enemy;
    const num = Number(t.value) || 0;
    state.enemy[key] = ENEMY_PERCENT_FIELDS.includes(key) ? num / 100 : num;
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.damageMultiplier !== undefined) {
    state.damageMultiplier = t.value === '' ? null : Number(t.value);
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.buff) {
    state.buffs[t.dataset.buff] = Number(t.value) || 0;
    renderResult();
    saveUrl();
  }
}

function onChange(e) {
  const t = e.target;

  if (t.dataset.bind === 'lightConeId') {
    state.lightConeId = t.value;
    renderConfig();
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.bind === 'superimpose') {
    state.superimpose = Number(t.value);
    return;
  }

  const minorId = t.dataset.minor;
  if (minorId) {
    state.minorEnabled[minorId] = t.checked;
    t.closest('.minor-chip')?.classList.toggle('on', t.checked);
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.set) {
    const key = t.dataset.set;
    const slot = RELIC_SLOTS.find((s) => s.key === key);
    const relic = state.relics[key];
    relic.setId = t.value;
    if (!slot.fixedMain) {
      const options = relic.setId ? db.mainAffixOptions(relic.setId, slot.type, relic.rarity) : [];
      relic.mainType = options[0]?.type ?? '';
    }
    renderConfig();
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.main) {
    state.relics[t.dataset.main].mainType = t.value;
    renderConfig();
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.subType) {
    const key = t.dataset.subType;
    const i = Number(t.dataset.index);
    const sub = state.relics[key].subs[i];
    sub.type = t.value;
    sub.value = 0;
    if (sub.type) {
      // 默认填入一个最大单次强化的数值，方便快速手填
      const opts = subAffixOptions();
      const opt = opts.find((o) => o.type === sub.type);
      if (opt) sub.value = opt.base;
    }
    renderConfig();
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.damageSkill !== undefined) {
    state.damageSkillId = t.value;
    state.damageParamIndex = 0;
    state.damageMultiplier = null;
    renderConfig();
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.damageParam !== undefined) {
    state.damageParamIndex = Number(t.value);
    renderConfig();
    renderResult();
    saveUrl();
    return;
  }

  if (t.dataset.enemyBroken !== undefined) {
    state.enemy.broken = t.checked;
    t.closest('.minor-chip')?.classList.toggle('on', t.checked);
    renderResult();
    saveUrl();
  }
}

function onClick(e) {
  const charBtn = e.target.closest('[data-character]');
  if (charBtn) {
    switchCharacter(charBtn.dataset.character);
    return;
  }

  if (e.target.id === 'share-btn') {
    copyShareLink();
  }
}

/* ------------------------------------------------------------------ */
/* 分享链接                                                            */
/* ------------------------------------------------------------------ */

let saveTimer = null;
function saveUrl() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const payload = {
        c: state.characterId,
        l: state.level,
        lc: state.lightConeId,
        ll: state.lcLevel,
        s: state.superimpose,
        b: state.buffs,
        m: state.minorEnabled,
        t: state.traceLevels,
        e: state.enemy,
        ds: state.damageSkillId,
        dp: state.damageParamIndex,
        dm: state.damageMultiplier,
        r: Object.fromEntries(
          Object.entries(state.relics).map(([k, r]) => [
            k,
            { s: r.setId, t: r.mainType, v: r.level, u: r.subs.map((x) => [x.type, x.value]) },
          ]),
        ),
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=+$/, '');
      history.replaceState(null, '', `#${encoded}`);
    } catch {
      /* 忽略序列化异常 */
    }
  }, 250);
}

function restoreFromUrl() {
  const hash = location.hash.slice(1);
  if (!hash) return;
  try {
    const json = decodeURIComponent(escape(atob(hash)));
    const p = JSON.parse(json);
    if (!db.charById.get(p.c)) return;
    state.characterId = p.c;
    state.level = p.l ?? 80;
    state.lightConeId = p.lc ?? '';
    state.lcLevel = p.ll ?? 80;
    state.superimpose = p.s ?? 1;
    state.buffs = p.b ?? {};
    state.minorEnabled = p.m ?? {};
    state.traceLevels = p.t ?? {};
    state.enemy = { ...DEFAULT_ENEMY, ...(p.e ?? {}) };
    state.damageSkillId = p.ds ?? firstDamageSkillId(db.charById.get(state.characterId));
    state.damageParamIndex = p.dp ?? 0;
    state.damageMultiplier = p.dm ?? null;
    if (p.r) {
      for (const slot of RELIC_SLOTS) {
        const saved = p.r[slot.key];
        if (!saved) continue;
        state.relics[slot.key] = {
          setId: saved.s ?? '',
          rarity: 5,
          level: saved.v ?? 15,
          mainType: saved.t ?? slot.fixedMain ?? '',
          subs: (saved.u ?? []).map(([type, value]) => ({ type: type ?? '', value: value ?? 0 })).slice(0, 4),
        };
        while (state.relics[slot.key].subs.length < 4) state.relics[slot.key].subs.push({ type: '', value: 0 });
      }
    }
  } catch {
    /* 链接损坏时忽略 */
  }
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('已复制分享链接');
  } catch {
    toast('复制失败，请手动复制地址栏链接');
  }
}

let toastTimer = null;
function toast(message) {
  const el = $id('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    db = await loadGameData();
  } catch (err) {
    document.body.innerHTML = `<div class="loading">数据加载失败：${escapeHtml(err.message)}<br/>请通过本地静态服务器打开（例如 <code>python -m http.server</code>）。</div>`;
    return;
  }

  state = defaultState();
  restoreFromUrl();

  const v = db.version;
  $id('data-version').textContent = `数据 ${v.counts.characters} 角色 · ${v.counts.lightCones} 光锥 · 快照 ${v.snapshot.slice(0, 10)}`;

  renderFilters();
  renderConfig();
  updateCharList();
  renderResult();

  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
}

boot();
