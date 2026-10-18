/**
 * src/core/data.js
 * 游戏数据的加载与索引。浏览器里 fetch data/*.json；测试环境可直接读文件后调用 buildDb。
 */

const FILES = ['version', 'meta', 'properties', 'characters', 'lightcones', 'relics'];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`);
  return res.json();
}

/** 拉取 data/ 目录下的全部数据文件 */
export async function loadGameData(basePath = './data/') {
  const entries = await Promise.all(FILES.map((name) => fetchJson(`${basePath}${name}.json`)));
  const raw = Object.fromEntries(FILES.map((name, i) => [name, entries[i]]));
  return buildDb(raw);
}

/** 把原始数据整理成带索引的数据库对象 */
export function buildDb(raw) {
  const { version, meta, properties, characters, lightcones, relics } = raw;

  const charById = new Map(characters.map((c) => [c.id, c]));
  const lcById = new Map(lightcones.map((l) => [l.id, l]));
  const setById = new Map(relics.sets.map((s) => [s.id, s]));

  const cavernSets = relics.sets.filter((s) => relics.setKind[s.id] !== 'planar');
  const planarSets = relics.sets.filter((s) => relics.setKind[s.id] === 'planar');

  const piecesBySet = new Map();
  for (const p of relics.pieces) {
    if (!piecesBySet.has(p.setId)) piecesBySet.set(p.setId, []);
    piecesBySet.get(p.setId).push(p);
  }

  /** 某个遗器部件的主词条可选列表 */
  const mainAffixOptions = (setId, slotType, rarity = 5) => {
    const pieces = piecesBySet.get(setId) ?? [];
    const piece = pieces.find((p) => p.type === slotType && p.rarity === rarity);
    const groupId =
      piece?.mainAffixId ?? String((rarity - 1) * 10 + slotTypeIndex(slotType));
    const group = relics.mainAffixes[groupId];
    if (group) return group.map((a) => ({ ...a, groupId }));
    // 兜底：按稀有度+槽位推导
    const fallback = relics.mainAffixes[String((rarity - 1) * 10 + slotTypeIndex(slotType))];
    return (fallback ?? []).map((a) => ({ ...a, groupId }));
  };

  return {
    version,
    meta,
    properties,
    characters,
    charById,
    lightcones,
    lcById,
    relics,
    setById,
    cavernSets,
    planarSets,
    piecesBySet,
    mainAffixOptions,
  };
}

function slotTypeIndex(type) {
  if (type === 'HEAD') return 1;
  if (type === 'HAND') return 2;
  if (type === 'BODY') return 3;
  if (type === 'FEET') return 4;
  if (type === 'NECK' || type === 'SPHERE') return 5;
  return 6;
}

/** 属性类型的中文名 */
export function propertyName(db, type) {
  return db.properties[type]?.name ?? type;
}

/** 属性是否为百分比 */
export function propertyIsPercent(db, type) {
  return !!db.properties[type]?.percent;
}
