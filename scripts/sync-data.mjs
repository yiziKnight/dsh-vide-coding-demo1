#!/usr/bin/env node
/**
 * scripts/sync-data.mjs
 * ------------------------------------------------------------------
 * 从 Mar-7th/StarRailRes 拉取游戏数据，裁剪成前端可直接消费的精简 JSON。
 *
 * 用法：
 *   node scripts/sync-data.mjs
 *
 * 需要代理时（例如本机需要 127.0.0.1:10808）：
 *   $env:HTTPS_PROXY="http://127.0.0.1:10808"; $env:NODE_USE_ENV_PROXY="1"
 *   node scripts/sync-data.mjs
 *
 * 产物（提交进仓库，离线可用）：
 *   data/version.json      数据快照元信息
 *   data/meta.json         属性 / 命途 中文名与配色
 *   data/properties.json   属性字典（58 项）
 *   data/characters.json   98 名角色
 *   data/lightcones.json   170 张光锥
 *   data/relics.json       遗器套装 / 部件 / 主副词条
 *
 * 数据来源许可：AGPL-3.0（https://github.com/Mar-7th/StarRailRes）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const BASE = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/cn';

const FILES = {
  characters: 'characters.json',
  promotions: 'character_promotions.json',
  skillTrees: 'character_skill_trees.json',
  skills: 'character_skills.json',
  ranks: 'character_ranks.json',
  lightCones: 'light_cones.json',
  lightConePromotions: 'light_cone_promotions.json',
  lightConeRanks: 'light_cone_ranks.json',
  relics: 'relics.json',
  relicSets: 'relic_sets.json',
  relicMainAffixes: 'relic_main_affixes.json',
  relicSubAffixes: 'relic_sub_affixes.json',
  properties: 'properties.json',
  elements: 'elements.json',
  paths: 'paths.json',
};

const charStatKeys = ['hp', 'atk', 'def', 'spd', 'taunt', 'crit_rate', 'crit_dmg'];

async function fetchJson(file) {
  const url = `${BASE}/${file}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'dsh-hsr-sim/0.1' } });
  if (!res.ok) throw new Error(`下载失败 ${file}: HTTP ${res.status}`);
  process.stdout.write(`  ✓ ${file}\n`);
  return res.json();
}

/** 把 {base, step} 压成 [base, step] 元组，进一步压缩 JSON 体积 */
function pair(obj) {
  return [obj.base, obj.step];
}

function buildCharacters(chars, promotions, skillTrees, skills, ranks) {
  return Object.values(chars)
    .map((c) => {
      const promo = promotions[c.id];
      const stats = (promo?.values ?? []).map((v) => {
        const row = {};
        for (const k of charStatKeys) {
          if (v[k]) row[k] = pair(v[k]);
        }
        return row;
      });

      const traces = (c.skill_trees ?? [])
        .map((nodeId) => skillTrees[nodeId])
        .filter(Boolean)
        .map((n) => ({
          id: n.id,
          name: n.name || '',
          maxLevel: n.max_level,
          anchor: n.anchor || '',
          // 只保留带属性的节点（小行迹）；主技能靠 level_up_skills 提升技能等级
          levels: (n.levels ?? []).map((lv) => ({
            promotion: lv.promotion,
            properties: (lv.properties ?? []).map((p) => [p.type, p.value]),
          })),
        }))
        .filter((n) => n.levels.some((lv) => lv.properties.length > 0));

      const skillList = (c.skills ?? [])
        .map((sid) => skills[sid])
        .filter(Boolean)
        .map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          typeText: s.type_text,
          maxLevel: s.max_level,
          element: s.element,
          params: s.params,
          desc: s.desc,
        }));

      const rankList = (c.ranks ?? [])
        .map((rid) => ranks[rid])
        .filter(Boolean)
        .map((r) => ({ id: r.id, rank: r.rank, name: r.name, desc: r.desc }));

      return {
        id: c.id,
        name: c.name,
        tag: c.tag,
        rarity: c.rarity,
        path: c.path,
        element: c.element,
        maxSp: c.max_sp,
        stats,
        traces,
        skills: skillList,
        ranks: rankList,
      };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function buildLightCones(lcs, promos, ranks) {
  return Object.values(lcs).map((lc) => {
    const promo = promos[lc.id];
    const stats = (promo?.values ?? []).map((v) => ({
      hp: pair(v.hp),
      atk: pair(v.atk),
      def: pair(v.def),
    }));
    const r = ranks[lc.id];
    return {
      id: lc.id,
      name: lc.name,
      rarity: lc.rarity,
      path: lc.path,
      stats,
      rank: r ? { skill: r.skill, desc: r.desc, params: r.params } : null,
    };
  });
}

function buildRelics(relics, sets, mainAffixes, subAffixes) {
  const setList = Object.values(sets).map((s) => ({
    id: s.id,
    name: s.name,
    desc: s.desc,
    // 2 件 / 4 件：[[{'type','value'}], [...]]
    properties: (s.properties ?? []).map((arr) => (arr ?? []).map((p) => [p.type, p.value])),
  }));

  const pieceList = Object.values(relics).map((r) => ({
    id: r.id,
    setId: r.set_id,
    name: r.name,
    rarity: r.rarity,
    type: r.type,
    maxLevel: r.max_level,
    mainAffixId: r.main_affix_id,
    subAffixId: r.sub_affix_id,
  }));

  const main = {};
  for (const [gid, group] of Object.entries(mainAffixes)) {
    main[gid] = Object.values(group.affixes ?? {}).map((a) => ({
      type: a.property,
      base: a.base,
      step: a.step,
    }));
  }

  const sub = {};
  for (const [gid, group] of Object.entries(subAffixes)) {
    sub[gid] = Object.values(group.affixes ?? {}).map((a) => ({
      type: a.property,
      base: a.base,
      step: a.step,
    }));
  }

  // 套装是「内圈（位面）」还是「外圈（隧洞）」由部件类型推断
  // 数据里位面球 = OBJECT，连结绳 = NECK
  const setTypes = {};
  for (const p of pieceList) {
    (setTypes[p.setId] ??= new Set()).add(p.type);
  }
  const setKind = {};
  for (const [setId, types] of Object.entries(setTypes)) {
    setKind[setId] = types.has('OBJECT') || types.has('NECK') ? 'planar' : 'cavern';
  }

  return { sets: setList, pieces: pieceList, mainAffixes: main, subAffixes: sub, setKind };
}

function buildMeta(elements, paths) {
  const el = {};
  for (const [id, e] of Object.entries(elements)) {
    el[id] = { id, name: e.name, color: e.color };
  }
  const pa = {};
  for (const [id, p] of Object.entries(paths)) {
    pa[id] = { id, name: p.name, text: p.text };
  }
  return { elements: el, paths: pa };
}

function buildProperties(properties) {
  const out = {};
  for (const [type, p] of Object.entries(properties)) {
    out[type] = { name: p.name, percent: !!p.percent };
  }
  return out;
}

async function main() {
  console.log(`拉取 StarRailRes 数据 → ${BASE}`);
  const raw = {};
  for (const [key, file] of Object.entries(FILES)) {
    raw[key] = await fetchJson(file);
  }

  const characters = buildCharacters(
    raw.characters,
    raw.promotions,
    raw.skillTrees,
    raw.skills,
    raw.ranks,
  );
  const lightcones = buildLightCones(raw.lightCones, raw.lightConePromotions, raw.lightConeRanks);
  const relics = buildRelics(raw.relics, raw.relicSets, raw.relicMainAffixes, raw.relicSubAffixes);
  const meta = buildMeta(raw.elements, raw.paths);
  const properties = buildProperties(raw.properties);

  const version = {
    source: 'Mar-7th/StarRailRes',
    sourceUrl: 'https://github.com/Mar-7th/StarRailRes',
    license: 'AGPL-3.0',
    snapshot: new Date().toISOString(),
    counts: {
      characters: characters.length,
      lightCones: lightcones.length,
      relicSets: relics.sets.length,
      relicPieces: relics.pieces.length,
    },
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  const write = async (name, value) => {
    const file = path.join(DATA_DIR, name);
    const text = JSON.stringify(value);
    await fs.writeFile(file, text, 'utf8');
    console.log(`  → data/${name}  ${(text.length / 1024).toFixed(1)} KB`);
  };

  await write('version.json', version);
  await write('meta.json', meta);
  await write('properties.json', properties);
  await write('characters.json', characters);
  await write('lightcones.json', lightcones);
  await write('relics.json', relics);

  console.log(
    `完成：${characters.length} 角色 / ${lightcones.length} 光锥 / ${relics.sets.length} 套装 / ${relics.pieces.length} 遗器部件`,
  );
  console.log('提示：需要重新校准时，改这里即可，前端只读 data/ 下的产物。');
}

main().catch((err) => {
  console.error('\n✗ 同步失败：', err.message);
  console.error('  若网络需要代理：$env:HTTPS_PROXY="http://127.0.0.1:10808"; $env:NODE_USE_ENV_PROXY="1"');
  process.exit(1);
});
