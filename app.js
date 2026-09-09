/* Pokémon Competitive Search — data via PokeAPI GraphQL (beta.pokeapi.co), cached in IndexedDB. */

const GRAPHQL_URL = 'https://beta.pokeapi.co/graphql/v1beta';
const DB_NAME = 'pokedex-search-cache';
const DB_VERSION = 1;
const STORE_GAMES = 'games';
const STORE_META = 'meta';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const NATIONAL_DEX_VG = 'national-dex';
const CHAMPIONS_VG = 'champions';

// Curated, human-friendly game list. "Pokémon Champions" uses its own authoritative roster,
// stats/types/abilities/movesets scraped from pokebase.app (which reflects Champions-specific
// balance changes PokeAPI doesn't know about, e.g. Incineroar losing Knock Off), enriched with
// real competitive usage stats (moves/items/teammates/abilities/EVs/natures) from
// championsbattledata.com.
const GAMES = [
  { vg: NATIONAL_DEX_VG, label: 'National Dex — All Pokémon (latest data per Pokémon)', gen: 'All' },
  { vg: CHAMPIONS_VG, label: 'Pokémon Champions — with usage data', gen: 'Latest' },
  { vg: 'red-blue', label: 'Pokémon Red / Blue', gen: 1 },
  { vg: 'yellow', label: 'Pokémon Yellow', gen: 1 },
  { vg: 'gold-silver', label: 'Pokémon Gold / Silver', gen: 2 },
  { vg: 'crystal', label: 'Pokémon Crystal', gen: 2 },
  { vg: 'ruby-sapphire', label: 'Pokémon Ruby / Sapphire', gen: 3 },
  { vg: 'emerald', label: 'Pokémon Emerald', gen: 3 },
  { vg: 'firered-leafgreen', label: 'Pokémon FireRed / LeafGreen', gen: 3 },
  { vg: 'colosseum', label: 'Pokémon Colosseum', gen: 3 },
  { vg: 'xd', label: 'Pokémon XD: Gale of Darkness', gen: 3 },
  { vg: 'diamond-pearl', label: 'Pokémon Diamond / Pearl', gen: 4 },
  { vg: 'platinum', label: 'Pokémon Platinum', gen: 4 },
  { vg: 'heartgold-soulsilver', label: 'Pokémon HeartGold / SoulSilver', gen: 4 },
  { vg: 'black-white', label: 'Pokémon Black / White', gen: 5 },
  { vg: 'black-2-white-2', label: 'Pokémon Black 2 / White 2', gen: 5 },
  { vg: 'x-y', label: 'Pokémon X / Y', gen: 6 },
  { vg: 'omega-ruby-alpha-sapphire', label: 'Pokémon Omega Ruby / Alpha Sapphire', gen: 6 },
  { vg: 'sun-moon', label: 'Pokémon Sun / Moon', gen: 7 },
  { vg: 'ultra-sun-ultra-moon', label: 'Pokémon Ultra Sun / Ultra Moon', gen: 7 },
  { vg: 'lets-go-pikachu-lets-go-eevee', label: "Pokémon Let's Go, Pikachu! / Let's Go, Eevee!", gen: 7 },
  { vg: 'sword-shield', label: 'Pokémon Sword / Shield', gen: 8 },
  { vg: 'the-isle-of-armor', label: 'Pokémon Sword/Shield: Isle of Armor (DLC)', gen: 8 },
  { vg: 'the-crown-tundra', label: 'Pokémon Sword/Shield: Crown Tundra (DLC)', gen: 8 },
  { vg: 'brilliant-diamond-and-shining-pearl', label: 'Pokémon Brilliant Diamond / Shining Pearl', gen: 8 },
  { vg: 'legends-arceus', label: 'Pokémon Legends: Arceus', gen: 8 },
  { vg: 'scarlet-violet', label: 'Pokémon Scarlet / Violet', gen: 9 },
  { vg: 'the-teal-mask', label: 'Pokémon Scarlet/Violet: The Teal Mask (DLC)', gen: 9 },
  { vg: 'the-indigo-disk', label: 'Pokémon Scarlet/Violet: The Indigo Disk (DLC)', gen: 9 },
];

// Newest -> oldest. Used only to decide, per Pokémon, which game's data is the
// most current ("latest version of Pokémon info") for National Dex mode.
// Legends-series games (e.g. Legends: Arceus) are deliberately excluded — their
// drastically simplified movepools (almost no TMs/breeding) make for a misleadingly
// sparse "latest" moveset, so National Dex falls back to the next real mainline game.
const RECENCY_ORDER = [
  'the-indigo-disk', 'the-teal-mask', 'scarlet-violet',
  'brilliant-diamond-and-shining-pearl', 'the-crown-tundra', 'the-isle-of-armor', 'sword-shield',
  'lets-go-pikachu-lets-go-eevee', 'ultra-sun-ultra-moon', 'sun-moon',
  'omega-ruby-alpha-sapphire', 'x-y', 'black-2-white-2', 'black-white',
  'heartgold-soulsilver', 'platinum', 'diamond-pearl', 'xd', 'colosseum',
  'firered-leafgreen', 'emerald', 'ruby-sapphire', 'crystal', 'gold-silver',
  'yellow', 'red-blue', 'red-green-japan', 'blue-japan',
];

const TYPE_COLORS = {
  normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C',
  grass: '#7AC74C', ice: '#96D9D6', fighting: '#C22E28', poison: '#A33EA1',
  ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
  rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746',
  steel: '#B7B7CE', fairy: '#D685AD',
};
const TYPE_ORDER = Object.keys(TYPE_COLORS);

const STAT_KEYS = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const STAT_LABELS = { hp: 'HP', attack: 'Atk', defense: 'Def', 'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe' };

const DISPLAY_LEVEL = 50;

// EV caps per game. Champions redesigned EVs to a smaller, cleaner 0-32-per-stat / 66-total
// scale instead of the mainline 0-252 / 510. Verified against pokebase.app's own team builder
// (base-stat + Lvl-50 numbers matched the standard formula exactly at 0 EV, for two different
// Pokémon across all six stats) that Champions keeps the SAME stat formula shape and fixes IVs
// at a flat 31 — the one thing not independently confirmed is whether a nonzero EV contributes
// directly (assumed here, since 32 is a clean number to use as a 1:1 contribution cap) or via
// some other divisor; if in-game numbers ever look off, this is the term to revisit.
function evCapsForGame(vg) {
  return vg === CHAMPIONS_VG ? { perStat: 32, total: 66 } : { perStat: 252, total: 510 };
}

// Standard Pokémon Lvl-50 stat formula. For Champions, IV is always fixed at 31 and the EV
// term is added directly (no /4 division); for other games EVs still divide by 4 as normal.
function computeStat(base, statKey, ev, iv, isChampions) {
  const evTerm = isChampions ? (ev || 0) : Math.floor((ev || 0) / 4);
  const ivTerm = isChampions ? 31 : (iv ?? 31);
  const level = DISPLAY_LEVEL;
  if (statKey === 'hp') {
    return Math.floor((2 * base + ivTerm + evTerm) * level / 100) + level + 10;
  }
  return Math.floor((2 * base + ivTerm + evTerm) * level / 100) + 5;
}
const METHOD_MAP = { 'level-up': 'level-up', machine: 'machine', egg: 'egg', tutor: 'tutor' };
const METHOD_LABELS = { 'level-up': 'Level-up', machine: 'TM/TR', egg: 'Egg', tutor: 'Tutor', other: 'Other' };

// Abilities that are exclusive to Pokémon Champions and don't exist in PokeAPI's dictionary.
// Descriptions sourced from pokebase.app/pokemon-champions/abilities/{slug}.
const CHAMPIONS_ABILITY_OVERRIDES = {
  'piercing-drill': { shortEffect: "When the Pokémon uses contact moves, it can hit even targets that are protecting themselves, dealing 1/4 of the damage that the move would otherwise deal. Everything aside from the target's protective effects is still triggered." },
  'eelevate': { shortEffect: 'The Pokémon floats off the ground, making it immune to Ground-type moves, as well as the Spikes, Toxic Spikes, and Sticky Web statuses. When the Pokémon knocks out a target with an attack, its highest stat is boosted by 1 stage.' },
  'mega-sol': { shortEffect: 'Even when the sunlight has not turned harsh, the Pokémon can use its moves as if the weather were harsh sunlight.' },
  'spicy-spray': { shortEffect: 'When the Pokémon takes damage from a move, it burns the attacker.' },
  'fire-mane': { shortEffect: "Boosts the power of the Pokémon's Fire-type moves by 50%." },
  'dragonize': { shortEffect: "The Pokémon's Normal-type moves become Dragon-type moves and their power is boosted by 20%." },
};

// PokeAPI's "default" pokemon name doesn't always match pokebase.app's bare/generic slug for
// a species with multiple forms (e.g. PokeAPI has no bare "meowstic" — its default form is
// named "meowstic-male"). Used only to look up national-dex id/dex#/sprite for these entries.
const CHAMPIONS_NAME_ALIASES = {
  basculegion: 'basculegion-male',
  maushold: 'maushold-family-of-four',
  aegislash: 'aegislash-shield',
  palafin: 'palafin-zero',
  meowstic: 'meowstic-male',
  mimikyu: 'mimikyu-disguised',
  gourgeist: 'gourgeist-average',
  lycanroc: 'lycanroc-midday',
  morpeko: 'morpeko-full-belly',
  'tauros-paldea': 'tauros-paldea-combat-breed',
};

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_GAMES)) db.createObjectStore(STORE_GAMES);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- GraphQL ----------
async function gql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

// ---------- Global reference dictionaries (moves / abilities / evolution) ----------
let evolutionGraph = null;
let hasNextEvolution = null; // Set<speciesId> that have at least one species evolving from them
let moveDetails = null; // Map<moveName, {type,damageClass,power,accuracy,pp,priority,shortEffect}>
let abilityDetails = null; // Map<abilityName, {generation, shortEffect}>

async function loadEvolutionGraph() {
  const cached = await idbGet(STORE_META, 'evolution-graph');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    hasNextEvolution = new Set(cached.hasNext);
    return;
  }
  const data = await gql(`query { pokemon_v2_pokemonspecies { id evolves_from_species_id } }`);
  const species = data.pokemon_v2_pokemonspecies;
  const nextSet = new Set();
  for (const s of species) {
    if (s.evolves_from_species_id) nextSet.add(s.evolves_from_species_id);
  }
  hasNextEvolution = nextSet;
  await idbSet(STORE_META, 'evolution-graph', { hasNext: Array.from(nextSet), fetchedAt: Date.now() });
}

const MOVES_QUERY = `
query { pokemon_v2_move {
  name power pp accuracy priority move_effect_chance
  pokemon_v2_type { name }
  pokemon_v2_movedamageclass { name }
  pokemon_v2_moveeffect {
    pokemon_v2_moveeffecteffecttexts(where: {pokemon_v2_language: {name: {_eq: "en"}}}) { short_effect }
  }
} }`;

async function loadMoveDictionary() {
  const cached = await idbGet(STORE_META, 'move-dictionary');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    moveDetails = new Map(cached.entries);
    return;
  }
  const data = await gql(MOVES_QUERY);
  const map = new Map();
  for (const m of data.pokemon_v2_move) {
    const effectTexts = m.pokemon_v2_moveeffect ? m.pokemon_v2_moveeffect.pokemon_v2_moveeffecteffecttexts : [];
    let shortEffect = effectTexts[0] ? effectTexts[0].short_effect : '';
    if (shortEffect && m.move_effect_chance) {
      shortEffect = shortEffect.replace(/\$effect_chance/g, m.move_effect_chance);
    }
    map.set(m.name, {
      type: m.pokemon_v2_type ? m.pokemon_v2_type.name : null,
      damageClass: m.pokemon_v2_movedamageclass ? m.pokemon_v2_movedamageclass.name : null,
      power: m.power,
      accuracy: m.accuracy,
      pp: m.pp,
      priority: m.priority,
      shortEffect,
    });
  }
  moveDetails = map;
  await idbSet(STORE_META, 'move-dictionary', { entries: Array.from(map.entries()), fetchedAt: Date.now() });
}

const ABILITIES_QUERY = `
query { pokemon_v2_ability {
  name generation_id
  pokemon_v2_abilityeffecttexts(where: {pokemon_v2_language: {name: {_eq: "en"}}}) { short_effect }
} }`;

async function loadAbilityDictionary() {
  const cached = await idbGet(STORE_META, 'ability-dictionary');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    abilityDetails = new Map(cached.entries);
    return;
  }
  const data = await gql(ABILITIES_QUERY);
  const map = new Map();
  for (const a of data.pokemon_v2_ability) {
    const texts = a.pokemon_v2_abilityeffecttexts;
    map.set(a.name, {
      generation: a.generation_id,
      shortEffect: texts[0] ? texts[0].short_effect : '',
    });
  }
  abilityDetails = map;
  await idbSet(STORE_META, 'ability-dictionary', { entries: Array.from(map.entries()), fetchedAt: Date.now() });
}

// ---------- Item catalogs (for the team builder) ----------
// Loaded from inline <script> globals (general-items.data.js / champions-items.data.js) —
// same file:// -friendly approach as the Champions Pokédex/usage data.
let generalItems = null; // Map<itemSlug, {category, effect, minGen}>
let championsItemsCatalog = null; // Map<itemSlug, {displayName, category, effect}>

function loadItemCatalogs() {
  if (!generalItems) {
    if (!window.GENERAL_ITEMS_DATA) throw new Error('General items data script (general-items.data.js) did not load.');
    generalItems = new Map(Object.entries(window.GENERAL_ITEMS_DATA));
  }
  if (!championsItemsCatalog) {
    if (!window.CHAMPIONS_ITEMS_DATA) throw new Error('Champions items data script (champions-items.data.js) did not load.');
    championsItemsCatalog = new Map(Object.entries(window.CHAMPIONS_ITEMS_DATA));
  }
}

// Which item catalog applies for a given game, and (for the general catalog) filtered to
// items that existed by that game's generation.
function itemsForGame(vg) {
  loadItemCatalogs();
  if (vg === CHAMPIONS_VG) {
    return Array.from(championsItemsCatalog.entries()).map(([slug, info]) => ({ slug, name: info.displayName, category: info.category, effect: info.effect }));
  }
  const gameInfo = GAMES.find(g => g.vg === vg);
  const gen = gameInfo ? gameInfo.gen : null;
  const entries = Array.from(generalItems.entries())
    .filter(([, info]) => typeof gen !== 'number' || info.minGen <= gen)
    .map(([slug, info]) => ({ slug, name: formatName(slug), category: info.category, effect: info.effect }));
  return entries;
}

const MEGA_STONE_CATEGORIES = new Set(['Mega Evolution', 'mega-stones']);
const MEGA_NAME_RE = /\b(?:An?|A special)\s+([A-Z][a-zA-Z0-9'.]*(?:[- ][A-Z][a-zA-Z0-9'.]*)*)\s+(?:holding|to Mega Evolve)/;

// Given a held item's catalog info, figure out which base Pokémon (species) it Mega Evolves,
// by parsing the item's own effect text (e.g. "A Charizard holding this stone..." or "Allows
// Gengar to Mega Evolve into Mega Gengar."). Both catalogs phrase it this way.
function megaStoneBaseSlug(itemInfo) {
  if (!itemInfo || !MEGA_STONE_CATEGORIES.has(itemInfo.category)) return null;
  const match = itemInfo.effect.match(MEGA_NAME_RE);
  if (!match) return null;
  return slugify(match[1]);
}

// Finds the specific Mega Pokémon entry (in this game's full roster) that a held item
// unlocks for a given base Pokémon, disambiguating X/Y-style dual megas via the item's own
// name (e.g. "Charizardite Y" -> the "-mega-y" variant).
function findMegaVariant(baseSlug, itemDisplayName, fullPokemonList) {
  const candidates = fullPokemonList.filter(p => p.name === `${baseSlug}-mega` || p.name.startsWith(`${baseSlug}-mega-`));
  if (candidates.length <= 1) return candidates[0] || null;
  const upper = itemDisplayName.toUpperCase();
  if (/\bY$/.test(upper)) return candidates.find(p => p.name.endsWith('-mega-y')) || candidates[0];
  if (/\bX$/.test(upper)) return candidates.find(p => p.name.endsWith('-mega-x')) || candidates[0];
  return candidates[0];
}

// ---------- Per-game Pokémon data ----------
const GAME_QUERY = `
query GameData($vg: String!) {
  pokemon_v2_pokemon(
    where: {pokemon_v2_pokemonmoves: {pokemon_v2_versiongroup: {name: {_eq: $vg}}}}
    order_by: {id: asc}
  ) {
    id
    name
    pokemon_v2_pokemonstats { base_stat pokemon_v2_stat { name } }
    pokemon_v2_pokemontypes(order_by: {slot: asc}) { slot pokemon_v2_type { name } }
    pokemon_v2_pokemonabilities(order_by: {slot: asc}) { is_hidden pokemon_v2_ability { name } }
    pokemon_v2_pokemonspecy { id evolves_from_species_id }
    pokemon_v2_pokemonmoves(where: {pokemon_v2_versiongroup: {name: {_eq: $vg}}}) {
      level
      pokemon_v2_movelearnmethod { name }
      pokemon_v2_move { name }
    }
  }
}`;

async function loadGameData(vg) {
  if (vg === NATIONAL_DEX_VG) return loadNationalDex();
  if (vg === CHAMPIONS_VG) return loadChampionsGame();

  const cached = await idbGet(STORE_GAMES, vg);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pokemon;
  }
  const data = await gql(GAME_QUERY, { vg });
  const pokemon = data.pokemon_v2_pokemon.map(rawToPokemon);
  await idbSet(STORE_GAMES, vg, { pokemon, fetchedAt: Date.now() });
  return pokemon;
}

function rawToPokemon(p) {
  const stats = {};
  for (const s of p.pokemon_v2_pokemonstats) stats[s.pokemon_v2_stat.name] = s.base_stat;
  const bst = STAT_KEYS.reduce((sum, k) => sum + (stats[k] || 0), 0);
  const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
  const abilities = p.pokemon_v2_pokemonabilities.map(a => ({ name: a.pokemon_v2_ability.name, hidden: a.is_hidden }));

  const movesByMethod = { 'level-up': [], machine: [], egg: [], tutor: [], other: [] };
  const seenMoveKeys = new Set();
  for (const m of p.pokemon_v2_pokemonmoves) {
    const methodName = m.pokemon_v2_movelearnmethod.name;
    const bucket = METHOD_MAP[methodName] || 'other';
    const key = bucket + ':' + m.pokemon_v2_move.name;
    if (seenMoveKeys.has(key)) continue;
    seenMoveKeys.add(key);
    movesByMethod[bucket].push({ name: m.pokemon_v2_move.name, level: m.level });
  }
  for (const bucket of Object.keys(movesByMethod)) {
    movesByMethod[bucket].sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));
  }
  const allMoveNames = new Set();
  for (const bucket of Object.keys(movesByMethod)) {
    for (const mv of movesByMethod[bucket]) allMoveNames.add(mv.name);
  }

  const speciesId = p.pokemon_v2_pokemonspecy.id;

  return {
    id: p.id,
    name: p.name,
    speciesId,
    dex: speciesId,
    types,
    stats,
    bst,
    abilities,
    movesByMethod,
    allMoveNames,
    isFinalEvolution: null, // filled once evolution graph is loaded
  };
}

function applyEvolutionFlags(list) {
  for (const mon of list) {
    mon.isFinalEvolution = !hasNextEvolution.has(mon.speciesId);
  }
}

// ---------- National Dex (per-Pokémon "most recent game with data") ----------
const RECENCY_PAIRS_QUERY = `
query {
  pokemon_v2_pokemonmove(distinct_on: [pokemon_id, version_group_id], order_by: {pokemon_id: asc, version_group_id: asc}) {
    pokemon_id
    pokemon_v2_versiongroup { name }
  }
}`;

async function loadRecencyPairs() {
  const cached = await idbGet(STORE_META, 'recency-pairs');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pairs;
  }
  const data = await gql(RECENCY_PAIRS_QUERY);
  const pairs = data.pokemon_v2_pokemonmove.map(r => [r.pokemon_id, r.pokemon_v2_versiongroup.name]);
  await idbSet(STORE_META, 'recency-pairs', { pairs, fetchedAt: Date.now() });
  return pairs;
}

async function loadNationalDex(onProgress) {
  const cached = await idbGet(STORE_GAMES, NATIONAL_DEX_VG);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pokemon;
  }

  const pairs = await loadRecencyPairs();
  const rank = new Map(RECENCY_ORDER.map((name, i) => [name, i]));
  const bestVg = new Map(); // pokemonId -> vg name

  for (const [pokemonId, vgName] of pairs) {
    if (!rank.has(vgName)) continue; // ignore excluded games (e.g. Legends: Arceus) entirely
    const r = rank.get(vgName);
    const current = bestVg.get(pokemonId);
    if (current === undefined || r < current.rank) {
      bestVg.set(pokemonId, { rank: r, vg: vgName });
    }
  }

  const groups = new Map(); // vg name -> Set<pokemonId>
  for (const [pokemonId, info] of bestVg) {
    if (!groups.has(info.vg)) groups.set(info.vg, new Set());
    groups.get(info.vg).add(pokemonId);
  }

  const vgNames = Array.from(groups.keys()).sort((a, b) => rank.get(a) - rank.get(b));
  const combined = [];
  let i = 0;
  for (const vgName of vgNames) {
    i++;
    if (onProgress) onProgress(`Loading National Dex — ${vgName} (${i}/${vgNames.length})…`);
    const gamePokemon = await loadGameData(vgName);
    const idSet = groups.get(vgName);
    for (const mon of gamePokemon) {
      if (idSet.has(mon.id)) combined.push(mon);
    }
  }
  combined.sort((a, b) => a.dex - b.dex || a.id - b.id);

  await idbSet(STORE_GAMES, NATIONAL_DEX_VG, { pokemon: combined, fetchedAt: Date.now() });
  return combined;
}

// ---------- Pokémon Champions (roster + real usage stats) ----------
let championsUsage = null; // Map<pokeApiSlug, {displayName, singles, doubles}>
let championsDex = null; // Map<pokeApiSlug, {displayName, types, stats, abilities, moves}>

// Champions data is loaded from inline <script> globals (champions-usage.data.js /
// pokebase-dex.data.js) rather than fetch() — fetch() to local files is blocked by browsers
// when the app is opened directly as a file:// page (no local server), so inlining is what
// makes Champions mode work without needing serve.ps1 / start.bat running.
async function loadChampionsUsage() {
  if (championsUsage) return championsUsage;
  if (!window.CHAMPIONS_USAGE_DATA) throw new Error('Champions usage data script (champions-usage.data.js) did not load.');
  championsUsage = new Map(Object.entries(window.CHAMPIONS_USAGE_DATA));
  return championsUsage;
}

async function loadChampionsDex() {
  if (championsDex) return championsDex;
  if (!window.CHAMPIONS_DEX_DATA) throw new Error('Champions Pokédex data script (pokebase-dex.data.js) did not load.');
  championsDex = new Map(Object.entries(window.CHAMPIONS_DEX_DATA));
  return championsDex;
}

// Matches PokeAPI's slug convention: lowercase, apostrophes dropped, everything else -> hyphens.
function slugify(raw) {
  return raw.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findNationalMatch(nationalByName, slug) {
  return nationalByName.get(slug)
    || nationalByName.get(CHAMPIONS_NAME_ALIASES[slug])
    || null;
}

async function loadChampionsGame() {
  const [dex, usage, nationalDex] = await Promise.all([loadChampionsDex(), loadChampionsUsage(), loadNationalDex()]);
  const nationalByName = new Map(nationalDex.map(m => [m.name, m]));
  const list = [];
  let syntheticId = 900000;
  const usedIds = new Set(); // guards against two Champions entries resolving to the same id
  // (e.g. generic "aegislash" aliases to the same national-dex id as the separately-listed
  // "aegislash-shield" entry) — whichever claims it second falls back to a synthetic id.

  for (const [slug, entry] of dex) {
    let natMatch = findNationalMatch(nationalByName, slug);
    let usedBaseFormFallback = false;
    if (!natMatch) {
      // Not found directly (typically a Champions-exclusive Mega with no PokeAPI entry at
      // all) — fall back to the base species so it at least gets a real Pokédex # and art.
      const baseSlug = slug.replace(/-mega(-[a-z])?$/, '');
      if (baseSlug !== slug) {
        natMatch = findNationalMatch(nationalByName, baseSlug);
        usedBaseFormFallback = !!natMatch;
      }
    }

    const s = entry.stats || {};
    const stats = {
      hp: s.hp || 0,
      attack: s.attack || 0,
      defense: s.defense || 0,
      'special-attack': s.specialAttack || 0,
      'special-defense': s.specialDefense || 0,
      speed: s.speed || 0,
    };
    const bst = STAT_KEYS.reduce((sum, k) => sum + (stats[k] || 0), 0);
    const types = (entry.types || []).map(t => t.toLowerCase());
    let abilities = (entry.abilities || []).map(a => ({ name: slugify(a.name), hidden: !!a.isHidden }));
    // Mega Evolution always has exactly one fixed ability. pokebase.app's page sometimes
    // carries over the base form's ability slot(s) alongside the real mega ability — the
    // first entry listed is reliably the actual mega ability, so drop the rest.
    if (/-mega(-[a-z])?$/.test(slug) && abilities.length > 1) {
      abilities = [abilities[0]];
    }

    // pokebase.app doesn't distinguish level-up/TM/egg/tutor — every learnable move is
    // bucketed under "other" so the move-know filter still works, just without that granularity.
    const movesByMethod = { 'level-up': [], machine: [], egg: [], tutor: [], other: [] };
    for (const moveName of entry.moves || []) {
      movesByMethod.other.push({ name: slugify(moveName), level: null });
    }
    const allMoveNames = new Set(movesByMethod.other.map(m => m.name));

    // Use the matched PokeAPI id as-is for a direct/alias match (it's this entry's own
    // unique id). For a base-form fallback, that id belongs to a DIFFERENT entry (the base
    // Pokémon, which is very likely also its own separate row in this same list) — reusing
    // it here would collide, so this entry still gets its own synthetic id; spriteId is what
    // actually points the artwork at the base form's art.
    let id = (natMatch && !usedBaseFormFallback && !usedIds.has(natMatch.id)) ? natMatch.id : null;
    if (id === null) id = syntheticId++;
    usedIds.add(id);

    const mon = {
      id,
      spriteId: natMatch ? natMatch.id : null,
      name: slug,
      displayNameOverride: entry.displayName,
      speciesId: natMatch ? natMatch.speciesId : null,
      dex: natMatch ? natMatch.dex : 99999,
      usesBaseFormArt: usedBaseFormFallback,
      types,
      stats,
      bst,
      abilities,
      movesByMethod,
      allMoveNames,
      isFinalEvolution: null,
    };
    const usageInfo = usage.get(slug);
    if (usageInfo) mon.champions = usageInfo;
    list.push(mon);
  }

  list.sort((a, b) => a.dex - b.dex || a.id - b.id);
  return list;
}

// ---------- Formatting ----------
function formatName(raw) {
  return raw.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function monDisplayName(mon) {
  return mon.displayNameOverride || formatName(mon.name);
}

function spriteUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}
function spriteFallbackUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}
const PLACEHOLDER_SPRITE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#33364a"/></svg>`
);

// ---------- App state ----------
const state = {
  game: null,
  pokemon: [],
  filters: {
    nameQuery: '',
    finalEvoOnly: true,
    typeGroups: [new Set()], // array of Sets; AND within a set, OR across sets
    bstMin: null,
    bstMax: null,
    statRange: {}, // key -> {min,max}
    abilities: new Set(),
    moveLogic: 'AND',
    methods: new Set(Object.keys(METHOD_MAP).map(k => METHOD_MAP[k]).concat(['other'])),
    moves: new Set(),
  },
  sort: { key: 'dex', dir: 'asc' },
};

let modalMoveSort = { key: 'name', dir: 'asc' };
let modalAbilitySort = { key: 'name', dir: 'asc' };
let modalChampFormat = 'singles';
let currentDetailMon = null;

// ---------- DOM refs ----------
const el = {
  gameSelect: document.getElementById('game-select'),
  loadStatus: document.getElementById('load-status'),
  nameSearch: document.getElementById('name-search'),
  finalEvo: document.getElementById('filter-final-evo'),
  typeGroups: document.getElementById('type-groups'),
  addTypeGroup: document.getElementById('add-type-group'),
  statFilterGrid: document.getElementById('stat-filter-grid'),
  abilitySearch: document.getElementById('ability-search'),
  abilityChipList: document.getElementById('ability-chip-list'),
  abilityDropdown: document.getElementById('ability-dropdown'),
  moveSearch: document.getElementById('move-search'),
  moveChipList: document.getElementById('move-chip-list'),
  moveDropdown: document.getElementById('move-dropdown'),
  methodChecks: document.getElementById('method-checks'),
  resetBtn: document.getElementById('reset-filters'),
  resultsHeadRow: document.getElementById('results-head-row'),
  resultCount: document.getElementById('result-count'),
  resultsBody: document.getElementById('results-body'),
  detailBackdrop: document.getElementById('detail-backdrop'),
  detailModal: document.getElementById('detail-modal'),
  searchTopbarRight: document.getElementById('search-topbar-right'),
  searchView: document.getElementById('search-view'),
  teamsView: document.getElementById('teams-view'),
  teamListPanel: document.getElementById('team-list-panel'),
  teamList: document.getElementById('team-list'),
  teamsEmptyHint: document.getElementById('teams-empty-hint'),
  newTeamBtn: document.getElementById('new-team-btn'),
  teamEditorPanel: document.getElementById('team-editor-panel'),
  backToTeamList: document.getElementById('back-to-team-list'),
  teamNameInput: document.getElementById('team-name-input'),
  teamGameSelect: document.getElementById('team-game-select'),
  saveTeamBtn: document.getElementById('save-team-btn'),
  teamSaveStatus: document.getElementById('team-save-status'),
  teamSlotsGrid: document.getElementById('team-slots-grid'),
  slotBackdrop: document.getElementById('slot-backdrop'),
  slotModal: document.getElementById('slot-modal'),
};

// ---------- Type group filter UI ----------
function renderTypeGroups() {
  el.typeGroups.innerHTML = '';
  state.filters.typeGroups.forEach((groupSet, idx) => {
    if (idx > 0) {
      const divider = document.createElement('div');
      divider.className = 'type-group-or-divider';
      divider.textContent = 'OR';
      el.typeGroups.appendChild(divider);
    }
    const box = document.createElement('div');
    box.className = 'type-group-box';

    const label = document.createElement('div');
    label.className = 'type-group-label';
    const canRemove = state.filters.typeGroups.length > 1;
    label.innerHTML = `<span>Group ${idx + 1} (AND)</span>`;
    if (canRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'type-group-remove';
      removeBtn.type = 'button';
      removeBtn.textContent = '× remove group';
      removeBtn.addEventListener('click', () => {
        state.filters.typeGroups.splice(idx, 1);
        renderTypeGroups();
        renderResults();
      });
      label.appendChild(removeBtn);
    }
    box.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'type-grid';
    for (const t of TYPE_ORDER) {
      const chip = document.createElement('div');
      chip.className = 'type-chip' + (groupSet.has(t) ? ' selected' : '');
      chip.innerHTML = `<span class="type-swatch" style="background:${TYPE_COLORS[t]}"></span>${formatName(t)}`;
      chip.addEventListener('click', () => {
        if (groupSet.has(t)) groupSet.delete(t);
        else groupSet.add(t);
        chip.classList.toggle('selected');
        renderResults();
      });
      grid.appendChild(chip);
    }
    box.appendChild(grid);
    el.typeGroups.appendChild(box);
  });
}

function initStatFilterGrid() {
  el.statFilterGrid.innerHTML = '';

  const bstRow = document.createElement('div');
  bstRow.className = 'stat-filter-row';
  bstRow.innerHTML = `
    <label>BST</label>
    <input type="number" placeholder="Min" data-bound="bstMin">
    <input type="number" placeholder="Max" data-bound="bstMax">
  `;
  bstRow.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      const val = input.value === '' ? null : Number(input.value);
      state.filters[input.dataset.bound] = val;
      renderResults();
    });
  });
  el.statFilterGrid.appendChild(bstRow);

  for (const k of STAT_KEYS) {
    state.filters.statRange[k] = { min: null, max: null };
    const row = document.createElement('div');
    row.className = 'stat-filter-row';
    row.innerHTML = `
      <label>${STAT_LABELS[k]}</label>
      <input type="number" placeholder="Min" data-stat="${k}" data-bound="min">
      <input type="number" placeholder="Max" data-stat="${k}" data-bound="max">
    `;
    row.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        const val = input.value === '' ? null : Number(input.value);
        state.filters.statRange[k][input.dataset.bound] = val;
        renderResults();
      });
    });
    el.statFilterGrid.appendChild(row);
  }
}

function initMethodChecks() {
  el.methodChecks.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.filters.methods.add(cb.value);
      else state.filters.methods.delete(cb.value);
      renderResults();
    });
  });
}

function initSimpleListeners() {
  el.nameSearch.addEventListener('input', () => {
    state.filters.nameQuery = el.nameSearch.value.trim().toLowerCase();
    renderResults();
  });
  el.finalEvo.addEventListener('change', () => {
    state.filters.finalEvoOnly = el.finalEvo.checked;
    renderResults();
  });
  el.addTypeGroup.addEventListener('click', () => {
    state.filters.typeGroups.push(new Set());
    renderTypeGroups();
    renderResults();
  });
  document.querySelectorAll('input[name="move-logic"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) { state.filters.moveLogic = r.value; renderResults(); }
    });
  });
  el.resultsHeadRow.querySelectorAll('th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = 'asc';
      }
      renderResults();
    });
  });
  el.resetBtn.addEventListener('click', resetFilters);
  el.detailBackdrop.addEventListener('click', (e) => {
    if (e.target === el.detailBackdrop) closeDetail();
  });
  el.detailModal.addEventListener('click', (e) => {
    const fmtBtn = e.target.closest('button[data-champ-format]');
    if (fmtBtn) {
      modalChampFormat = fmtBtn.dataset.champFormat;
      renderDetailModal();
      return;
    }
    const th = e.target.closest('th[data-sort-key]');
    if (!th) return;
    const table = th.dataset.table;
    const key = th.dataset.sortKey;
    const sortState = table === 'moves' ? modalMoveSort : modalAbilitySort;
    if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    else { sortState.key = key; sortState.dir = 'asc'; }
    renderDetailModal();
  });
}

// ---------- Searchable multi-select (moves / abilities) ----------
function setupSearchSelect({ searchInput, dropdown, chipList, selectedSet, getOptions, formatOption }) {
  function renderChips() {
    chipList.innerHTML = '';
    for (const val of selectedSet) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${formatOption(val)} <button type="button">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        selectedSet.delete(val);
        renderChips();
        renderResults();
      });
      chipList.appendChild(chip);
    }
  }
  function renderDropdown(query) {
    const options = getOptions();
    const q = query.trim().toLowerCase();
    let matches = options.filter(o => !selectedSet.has(o));
    if (q) matches = matches.filter(o => o.toLowerCase().includes(q));
    matches = matches.slice(0, 60);
    dropdown.innerHTML = '';
    if (!q || matches.length === 0) {
      dropdown.classList.remove('open');
      return;
    }
    for (const m of matches) {
      const div = document.createElement('div');
      div.textContent = formatOption(m);
      div.addEventListener('click', () => {
        selectedSet.add(m);
        searchInput.value = '';
        dropdown.classList.remove('open');
        renderChips();
        renderResults();
      });
      dropdown.appendChild(div);
    }
    dropdown.classList.add('open');
  }
  searchInput.addEventListener('input', () => renderDropdown(searchInput.value));
  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  document.addEventListener('click', (e) => {
    if (e.target !== searchInput) dropdown.classList.remove('open');
  });
  return { renderChips, refreshOptions: () => renderDropdown(searchInput.value) };
}

let abilitySelectUI, moveSelectUI;

function setupDynamicSelectors() {
  abilitySelectUI = setupSearchSelect({
    searchInput: el.abilitySearch,
    dropdown: el.abilityDropdown,
    chipList: el.abilityChipList,
    selectedSet: state.filters.abilities,
    getOptions: () => Array.from(new Set(state.pokemon.flatMap(p => p.abilities.map(a => a.name)))).sort(),
    formatOption: formatName,
  });
  moveSelectUI = setupSearchSelect({
    searchInput: el.moveSearch,
    dropdown: el.moveDropdown,
    chipList: el.moveChipList,
    selectedSet: state.filters.moves,
    getOptions: () => Array.from(new Set(state.pokemon.flatMap(p => Array.from(p.allMoveNames)))).sort(),
    formatOption: formatName,
  });
}

function resetFilters() {
  state.filters.nameQuery = '';
  state.filters.finalEvoOnly = true;
  state.filters.typeGroups = [new Set()];
  state.filters.bstMin = null;
  state.filters.bstMax = null;
  for (const k of STAT_KEYS) state.filters.statRange[k] = { min: null, max: null };
  state.filters.abilities.clear();
  state.filters.moveLogic = 'AND';
  state.filters.methods = new Set(['level-up', 'machine', 'egg', 'tutor', 'other']);
  state.filters.moves.clear();
  state.sort = { key: 'dex', dir: 'asc' };

  el.nameSearch.value = '';
  el.finalEvo.checked = true;
  renderTypeGroups();
  el.statFilterGrid.querySelectorAll('input').forEach(i => i.value = '');
  document.querySelector('input[name="move-logic"][value="AND"]').checked = true;
  el.methodChecks.querySelectorAll('input').forEach(cb => cb.checked = true);
  abilitySelectUI.renderChips();
  moveSelectUI.renderChips();
  renderResults();
}

// ---------- Filtering & sorting ----------
function typeGroupsMatch(mon) {
  const groups = state.filters.typeGroups.filter(g => g.size > 0);
  if (groups.length === 0) return true;
  return groups.some(g => Array.from(g).every(t => mon.types.includes(t)));
}

function passesFilters(mon) {
  const f = state.filters;
  if (f.nameQuery) {
    const haystack = mon.name.toLowerCase().replace(/-/g, ' ')
      + ' ' + (mon.displayNameOverride || '').toLowerCase();
    if (!haystack.includes(f.nameQuery)) return false;
  }
  if (f.finalEvoOnly && !mon.isFinalEvolution) return false;

  if (!typeGroupsMatch(mon)) return false;

  if (f.bstMin !== null && mon.bst < f.bstMin) return false;
  if (f.bstMax !== null && mon.bst > f.bstMax) return false;

  for (const k of STAT_KEYS) {
    const r = f.statRange[k];
    const val = mon.stats[k] || 0;
    if (r.min !== null && val < r.min) return false;
    if (r.max !== null && val > r.max) return false;
  }

  if (f.abilities.size > 0) {
    const monAbilities = mon.abilities.map(a => a.name);
    let any = false;
    for (const a of f.abilities) if (monAbilities.includes(a)) { any = true; break; }
    if (!any) return false;
  }

  if (f.moves.size > 0) {
    const knownInMethods = new Set();
    for (const method of f.methods) {
      for (const mv of mon.movesByMethod[method] || []) knownInMethods.add(mv.name);
    }
    if (f.moveLogic === 'AND') {
      for (const m of f.moves) if (!knownInMethods.has(m)) return false;
    } else {
      let any = false;
      for (const m of f.moves) if (knownInMethods.has(m)) { any = true; break; }
      if (!any) return false;
    }
  }

  return true;
}

function sortValue(mon, key) {
  switch (key) {
    case 'dex': return mon.dex;
    case 'name': return mon.name;
    case 'bst': return mon.bst;
    default: return mon.stats[key] || 0;
  }
}

function updateSortHeaderUI() {
  el.resultsHeadRow.querySelectorAll('th[data-key]').forEach(th => {
    const key = th.dataset.key;
    const baseLabel = th.dataset.label || th.textContent.replace(/[▲▼]/g, '').trim();
    th.dataset.label = baseLabel;
    if (key === state.sort.key) {
      th.classList.add('sort-active');
      th.innerHTML = `${baseLabel}<span class="sort-arrow">${state.sort.dir === 'asc' ? '▲' : '▼'}</span>`;
    } else {
      th.classList.remove('sort-active');
      th.textContent = baseLabel;
    }
  });
}

function renderResults() {
  updateSortHeaderUI();
  if (!state.pokemon.length) {
    el.resultsBody.innerHTML = '';
    el.resultCount.textContent = '';
    return;
  }
  let list = state.pokemon.filter(passesFilters);
  const { key, dir } = state.sort;
  list.sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key);
    let cmp;
    if (typeof va === 'string') cmp = va.localeCompare(vb);
    else cmp = va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });

  el.resultCount.textContent = `${list.length} of ${state.pokemon.length} Pokémon`;

  const rows = list.map(mon => {
    const typeBadges = mon.types.map(t =>
      `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${formatName(t)}</span>`).join('');
    const spriteId = mon.spriteId || mon.id;
    return `<tr data-id="${mon.id}">
      <td class="sprite-cell"><img loading="lazy" src="${spriteUrl(spriteId)}" onerror="this.onerror=null;this.src='${spriteFallbackUrl(spriteId)}';this.onerror=function(){this.src='${PLACEHOLDER_SPRITE}'};" alt=""></td>
      <td>${mon.dex}</td>
      <td>${monDisplayName(mon)}</td>
      <td>${typeBadges}</td>
      <td>${mon.stats.hp || 0}</td>
      <td>${mon.stats.attack || 0}</td>
      <td>${mon.stats.defense || 0}</td>
      <td>${mon.stats['special-attack'] || 0}</td>
      <td>${mon.stats['special-defense'] || 0}</td>
      <td>${mon.stats.speed || 0}</td>
      <td class="bst-cell">${mon.bst}</td>
    </tr>`;
  }).join('');

  el.resultsBody.innerHTML = rows || `<tr><td colspan="11" class="empty-state">No Pokémon match these filters.</td></tr>`;

  el.resultsBody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => openDetail(Number(tr.dataset.id)));
  });
}

// ---------- Detail modal ----------
const METHOD_PRIORITY = ['level-up', 'machine', 'tutor', 'egg', 'other'];

function buildMoveRows(mon) {
  const byName = new Map();
  for (const method of Object.keys(mon.movesByMethod)) {
    for (const mv of mon.movesByMethod[method]) {
      if (!byName.has(mv.name)) byName.set(mv.name, { name: mv.name, methods: new Set(), level: null });
      const entry = byName.get(mv.name);
      entry.methods.add(method);
      if (method === 'level-up' && (entry.level === null || mv.level < entry.level)) entry.level = mv.level;
    }
  }
  const rows = [];
  for (const entry of byName.values()) {
    const info = moveDetails.get(entry.name) || {};
    const methods = METHOD_PRIORITY.filter(m => entry.methods.has(m));
    rows.push({
      name: entry.name,
      method: methods.map(m => METHOD_LABELS[m]).join(', '),
      level: entry.level,
      type: info.type || null,
      damageClass: info.damageClass || null,
      power: info.power,
      accuracy: info.accuracy,
      pp: info.pp,
      shortEffect: info.shortEffect || '',
    });
  }
  return rows;
}

function sortRows(rows, sortState) {
  const { key, dir } = sortState;
  const sorted = rows.slice().sort((a, b) => {
    let va = a[key], vb = b[key];
    const aNull = va === null || va === undefined;
    const bNull = vb === null || vb === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1; // nulls (e.g. status moves' power) sort to the end
    if (bNull) return -1;
    let cmp;
    if (typeof va === 'string') cmp = va.localeCompare(vb);
    else cmp = va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

function sortHeaderHtml(label, key, table, sortState) {
  const active = sortState.key === key;
  const arrow = active ? `<span class="sort-arrow">${sortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
  return `<th data-sort-key="${key}" data-table="${table}" class="${active ? 'sort-active' : ''}">${label}${arrow}</th>`;
}

function renderMovesTable(mon) {
  const rows = sortRows(buildMoveRows(mon), modalMoveSort);
  const head = `<tr>
    ${sortHeaderHtml('Move', 'name', 'moves', modalMoveSort)}
    ${sortHeaderHtml('Type', 'type', 'moves', modalMoveSort)}
    ${sortHeaderHtml('Cat', 'damageClass', 'moves', modalMoveSort)}
    ${sortHeaderHtml('Pow', 'power', 'moves', modalMoveSort)}
    ${sortHeaderHtml('Acc', 'accuracy', 'moves', modalMoveSort)}
    ${sortHeaderHtml('PP', 'pp', 'moves', modalMoveSort)}
    ${sortHeaderHtml('Method', 'method', 'moves', modalMoveSort)}
    ${sortHeaderHtml('Lvl', 'level', 'moves', modalMoveSort)}
    <th>Effect</th>
  </tr>`;
  const body = rows.map(r => `<tr>
    <td>${formatName(r.name)}</td>
    <td>${r.type ? `<span class="type-badge" style="background:${TYPE_COLORS[r.type]}">${formatName(r.type)}</span>` : '—'}</td>
    <td>${r.damageClass ? `<span class="cat-badge cat-${r.damageClass}">${formatName(r.damageClass)}</span>` : '—'}</td>
    <td>${r.power ?? '—'}</td>
    <td>${r.accuracy ?? '—'}</td>
    <td>${r.pp ?? '—'}</td>
    <td><span class="method-badge">${r.method}</span></td>
    <td>${r.level ? r.level : '—'}</td>
    <td class="wrap">${r.shortEffect}</td>
  </tr>`).join('');
  return `<div class="detail-table-wrap"><table class="detail-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderAbilitiesTable(mon) {
  const rows = mon.abilities.map(a => {
    const info = abilityDetails.get(a.name) || CHAMPIONS_ABILITY_OVERRIDES[a.name] || {};
    return { name: a.name, hidden: a.hidden ? 1 : 0, generation: info.generation ?? null, shortEffect: info.shortEffect || '' };
  });
  const sorted = sortRows(rows, modalAbilitySort);
  const head = `<tr>
    ${sortHeaderHtml('Ability', 'name', 'abilities', modalAbilitySort)}
    ${sortHeaderHtml('Hidden', 'hidden', 'abilities', modalAbilitySort)}
    ${sortHeaderHtml('Gen', 'generation', 'abilities', modalAbilitySort)}
    <th>Effect</th>
  </tr>`;
  const body = sorted.map(r => `<tr>
    <td>${formatName(r.name)}</td>
    <td>${r.hidden ? 'Yes' : 'No'}</td>
    <td>${r.generation ?? '—'}</td>
    <td class="wrap">${r.shortEffect}</td>
  </tr>`).join('');
  return `<div class="detail-table-wrap"><table class="detail-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function pctToNum(pct) {
  return pct ? parseFloat(pct) : 0;
}

function usageTagList(entries, opts) {
  opts = opts || {};
  if (!entries || entries.length === 0) return '<div class="hint">No data</div>';
  return `<div class="move-tag-list">${entries.map(e => {
    let extra = '';
    if (opts.withType) {
      const info = moveDetails.get((e.name || '').toLowerCase().replace(/\s+/g, '-'));
      if (info && info.type) {
        extra = `<span class="type-badge" style="background:${TYPE_COLORS[info.type]}">${formatName(info.type)}</span> `;
      }
    }
    return `<span class="move-tag">${extra}${e.name} — ${e.pct}</span>`;
  }).join('')}</div>`;
}

function renderChampionsSection(mon) {
  if (!mon.champions) return '';
  const data = mon.champions[modalChampFormat];
  const tabBtn = (fmt, label) => `<button type="button" class="reset-btn champ-format-btn${modalChampFormat === fmt ? ' sort-active' : ''}" data-champ-format="${fmt}" style="width:auto;padding:4px 12px;margin-right:6px;">${label}</button>`;

  if (!data) {
    return `<div class="modal-section">
      <h3>Champions Battle Data</h3>
      <div>${tabBtn('singles', 'Singles')}${tabBtn('doubles', 'Doubles')}</div>
      <div class="hint">No ${formatName(modalChampFormat)} data available for this Pokémon.</div>
    </div>`;
  }

  const evRows = (data.evSpreads || []).slice(0, 6).map(ev => `<tr>
    <td>${ev.pct}</td><td>${ev.hp || 0}</td><td>${ev.atk || 0}</td><td>${ev.def || 0}</td>
    <td>${ev.spa || 0}</td><td>${ev.spd || 0}</td><td>${ev.spe || 0}</td>
  </tr>`).join('');

  const natureRows = (data.natures || []).slice(0, 8).map(n => `<tr>
    <td>${n.name}</td><td>${n.pct}</td><td>${n.up || '—'}</td><td>${n.down || '—'}</td>
  </tr>`).join('');

  return `<div class="modal-section">
    <h3>Champions Battle Data <span class="hint">— real usage stats via championsbattledata.com</span></h3>
    <div>${tabBtn('singles', 'Singles')}${tabBtn('doubles', 'Doubles')}</div>

    <div class="modal-section">
      <h4>Top Moves</h4>
      ${usageTagList(data.moves, { withType: true })}
    </div>
    <div class="modal-section">
      <h4>Top Held Items</h4>
      ${usageTagList(data.items)}
    </div>
    <div class="modal-section">
      <h4>Top Abilities Used</h4>
      ${usageTagList(data.abilities)}
    </div>
    <div class="modal-section">
      <h4>Common Teammates</h4>
      ${usageTagList(data.teammates)}
    </div>
    <div class="modal-section">
      <h4>Common Natures</h4>
      <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Nature</th><th>%</th><th>Raises</th><th>Lowers</th></tr></thead><tbody>${natureRows || '<tr><td colspan="4">No data</td></tr>'}</tbody></table></div>
    </div>
    <div class="modal-section">
      <h4>Common EV Spreads</h4>
      <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>%</th><th>HP</th><th>Atk</th><th>Def</th><th>SpA</th><th>SpD</th><th>Spe</th></tr></thead><tbody>${evRows || '<tr><td colspan="7">No data</td></tr>'}</tbody></table></div>
    </div>
  </div>`;
}

function renderDetailModal() {
  const mon = currentDetailMon;
  if (!mon) return;
  const maxStat = 255;
  const statBars = STAT_KEYS.map(k => {
    const val = mon.stats[k] || 0;
    const pct = Math.min(100, (val / maxStat) * 100);
    return `<div class="stat-bar-row">
      <span>${STAT_LABELS[k]}</span><span>${val}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  el.detailModal.innerHTML = `
    <button class="modal-close" id="modal-close-btn">✕</button>
    <h2>#${mon.dex} ${monDisplayName(mon)}</h2>
    <div>${mon.types.map(t => `<span class="type-badge" style="background:${TYPE_COLORS[t]}">${formatName(t)}</span>`).join('')}
    ${mon.isFinalEvolution ? '<span class="hint">Final evolution</span>' : '<span class="hint">Not final evolution</span>'}</div>
    <div class="modal-section">
      <h3>Base Stats (BST ${mon.bst})</h3>
      ${statBars}
    </div>
    <div class="modal-section">
      <h3>Abilities</h3>
      ${renderAbilitiesTable(mon)}
    </div>
    <div class="modal-section">
      <h3>Moves (${Object.values(mon.movesByMethod).reduce((s, a) => s + a.length, 0)})</h3>
      ${renderMovesTable(mon)}
    </div>
    ${renderChampionsSection(mon)}
  `;
  document.getElementById('modal-close-btn').addEventListener('click', closeDetail);
}

function openDetail(id) {
  const mon = state.pokemon.find(p => p.id === id);
  if (!mon) return;
  currentDetailMon = mon;
  modalMoveSort = { key: 'name', dir: 'asc' };
  modalAbilitySort = { key: 'name', dir: 'asc' };
  modalChampFormat = 'singles';
  renderDetailModal();
  el.detailBackdrop.classList.add('open');
}

function closeDetail() {
  el.detailBackdrop.classList.remove('open');
}

// ---------- Game switching ----------
async function selectGame(vg) {
  state.game = vg;
  el.loadStatus.textContent = 'Loading…';
  el.resultsBody.innerHTML = `<tr><td colspan="11" class="empty-state">Loading Pokémon data…</td></tr>`;
  try {
    const gameDataPromise = vg === NATIONAL_DEX_VG
      ? loadNationalDex((msg) => { el.loadStatus.textContent = msg; })
      : loadGameData(vg);
    const [pokemon] = await Promise.all([gameDataPromise, loadEvolutionGraph(), loadMoveDictionary(), loadAbilityDictionary()]);
    applyEvolutionFlags(pokemon);
    state.pokemon = pokemon;
    el.loadStatus.textContent = `${pokemon.length} loaded`;
    setupDynamicSelectors();
    state.filters.abilities.clear();
    state.filters.moves.clear();
    abilitySelectUI.renderChips();
    moveSelectUI.renderChips();
    renderResults();
  } catch (err) {
    console.error(err);
    el.loadStatus.textContent = 'Error loading data';
    el.resultsBody.innerHTML = `<tr><td colspan="11" class="empty-state">Failed to load data: ${err.message}<br>Check your internet connection and try again.</td></tr>`;
  }
}

// ---------- Team Builder ----------
const TEAMS_STORAGE_KEY = 'pokemon-team-builder-teams-v1';
const emptyEvs = () => ({ hp: 0, attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 });
const emptyIvs = () => ({ hp: 31, attack: 31, defense: 31, 'special-attack': 31, 'special-defense': 31, speed: 31 });

let teams = [];
let currentEditingTeam = null;
let currentSlotIndex = null;
let slotDraft = null;
let megaPreviewActive = false;
let slotEditorPokemonList = [];
const teamGamePokemonCache = new Map();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadTeams() {
  try {
    const raw = localStorage.getItem(TEAMS_STORAGE_KEY);
    teams = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load saved teams', err);
    teams = [];
  }
}

function saveTeamsToStorage() {
  localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(teams));
}

function switchView(view) {
  document.querySelectorAll('.view-nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  if (view === 'teams') {
    el.searchView.style.display = 'none';
    el.searchTopbarRight.style.display = 'none';
    el.teamsView.classList.add('open');
    closeTeamEditor(false);
  } else {
    el.searchView.style.display = '';
    el.searchTopbarRight.style.display = '';
    el.teamsView.classList.remove('open');
  }
}

async function getTeamGamePokemon(vg) {
  if (!teamGamePokemonCache.has(vg)) {
    teamGamePokemonCache.set(vg, await loadGameData(vg));
  }
  return teamGamePokemonCache.get(vg);
}

function renderTeamList() {
  el.teamsEmptyHint.style.display = teams.length ? 'none' : '';
  el.teamList.innerHTML = teams.map(team => {
    const gameInfo = GAMES.find(g => g.vg === team.game);
    const gameLabel = gameInfo ? gameInfo.label : team.game;
    const sprites = team.slots.map(slot => {
      if (!slot) return `<div class="team-card-slot-empty"></div>`;
      const spriteId = slot.spriteId || slot.pokemonId;
      return `<img src="${spriteUrl(spriteId)}" alt="" onerror="this.onerror=null;this.src='${spriteFallbackUrl(spriteId)}';this.onerror=function(){this.src='${PLACEHOLDER_SPRITE}'};">`;
    }).join('');
    return `<div class="team-card" data-team-id="${team.id}">
      <div class="team-card-header"><span class="team-card-name">${escapeHtml(team.name)}</span></div>
      <div class="team-card-game">${escapeHtml(gameLabel)}</div>
      <div class="team-card-sprites">${sprites}</div>
      <div class="team-card-actions">
        <button type="button" data-action="edit" data-team-id="${team.id}">Edit</button>
        <button type="button" class="delete-team-btn" data-action="delete" data-team-id="${team.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function populateTeamGameSelect() {
  el.teamGameSelect.innerHTML = '';
  for (const g of GAMES) {
    const opt = document.createElement('option');
    opt.value = g.vg;
    opt.textContent = (g.vg === NATIONAL_DEX_VG || g.vg === CHAMPIONS_VG) ? g.label : `Gen ${g.gen} — ${g.label}`;
    el.teamGameSelect.appendChild(opt);
  }
}

function createNewTeam() {
  currentEditingTeam = {
    id: 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: 'New Team',
    game: 'scarlet-violet',
    slots: [null, null, null, null, null, null],
  };
  openTeamEditor();
}

function editTeam(id) {
  const team = teams.find(t => t.id === id);
  if (!team) return;
  currentEditingTeam = JSON.parse(JSON.stringify(team));
  openTeamEditor();
}

function openTeamEditor() {
  el.teamListPanel.style.display = 'none';
  el.teamEditorPanel.style.display = '';
  el.teamNameInput.value = currentEditingTeam.name;
  el.teamGameSelect.value = currentEditingTeam.game;
  el.teamSaveStatus.textContent = '';
  renderTeamSlotsGrid();
}

function closeTeamEditor(rerenderList = true) {
  currentEditingTeam = null;
  el.teamEditorPanel.style.display = 'none';
  el.teamListPanel.style.display = '';
  if (rerenderList) renderTeamList();
}

function deleteTeam(id) {
  if (!confirm('Delete this team? This cannot be undone.')) return;
  teams = teams.filter(t => t.id !== id);
  saveTeamsToStorage();
  renderTeamList();
}

function saveCurrentTeam() {
  currentEditingTeam.name = el.teamNameInput.value.trim() || 'Unnamed Team';
  const idx = teams.findIndex(t => t.id === currentEditingTeam.id);
  if (idx >= 0) teams[idx] = currentEditingTeam;
  else teams.push(currentEditingTeam);
  saveTeamsToStorage();
  el.teamSaveStatus.textContent = 'Saved ✓';
  setTimeout(() => { if (el.teamSaveStatus) el.teamSaveStatus.textContent = ''; }, 2000);
}

function onTeamGameChange() {
  const newGame = el.teamGameSelect.value;
  if (newGame === currentEditingTeam.game) return;
  const hasSlots = currentEditingTeam.slots.some(s => s !== null);
  if (hasSlots && !confirm('Changing the game will clear all Pokémon currently in this team. Continue?')) {
    el.teamGameSelect.value = currentEditingTeam.game;
    return;
  }
  currentEditingTeam.game = newGame;
  currentEditingTeam.slots = [null, null, null, null, null, null];
  renderTeamSlotsGrid();
}

function renderTeamSlotsGrid() {
  el.teamSlotsGrid.innerHTML = currentEditingTeam.slots.map((slot, i) => {
    if (!slot) {
      return `<div class="team-slot-card" data-slot-index="${i}">
        <div class="team-slot-empty-label">+</div>
        <div class="hint">Add Pokémon</div>
      </div>`;
    }
    const spriteId = slot.spriteId || slot.pokemonId;
    const moveNames = slot.moves.filter(Boolean).map(m => formatName(m)).join(', ') || 'No moves set';
    const itemName = slot.item ? formatName(slot.item) : 'No item';
    const abilityName = slot.ability ? formatName(slot.ability) : 'No ability';
    return `<div class="team-slot-card filled" data-slot-index="${i}">
      <button type="button" class="team-slot-remove" data-remove-slot="${i}">✕ remove</button>
      <img class="team-slot-sprite" loading="lazy" src="${spriteUrl(spriteId)}" onerror="this.onerror=null;this.src='${spriteFallbackUrl(spriteId)}';this.onerror=function(){this.src='${PLACEHOLDER_SPRITE}'};" alt="">
      <div class="team-slot-name">${escapeHtml(slot.displayName || formatName(slot.pokemonName))}</div>
      <div class="team-slot-item">${escapeHtml(itemName)} · ${escapeHtml(abilityName)}</div>
      <div class="team-slot-moves">${escapeHtml(moveNames)}</div>
    </div>`;
  }).join('');
}

async function openSlotEditor(index) {
  currentSlotIndex = index;
  const existing = currentEditingTeam.slots[index];
  slotDraft = existing ? JSON.parse(JSON.stringify(existing)) : {
    pokemonName: null, pokemonId: null, spriteId: null, displayName: null,
    ability: null, moves: [null, null, null, null], item: null,
    evs: emptyEvs(), ivs: currentEditingTeam.game === CHAMPIONS_VG ? null : emptyIvs(),
  };
  el.slotModal.innerHTML = '<div class="hint">Loading Pokémon data…</div>';
  el.slotBackdrop.classList.add('open');
  try {
    slotEditorPokemonList = await getTeamGamePokemon(currentEditingTeam.game);
    renderSlotModal();
  } catch (err) {
    console.error(err);
    el.slotModal.innerHTML = `<div class="hint">Failed to load Pokémon data: ${escapeHtml(err.message)}</div>`;
  }
}

function closeSlotEditor() {
  el.slotBackdrop.classList.remove('open');
  slotDraft = null;
  currentSlotIndex = null;
  megaPreviewActive = false;
  clearStepperHold();
}

function currentSlotMon() {
  if (!slotDraft || !slotDraft.pokemonName) return null;
  return slotEditorPokemonList.find(p => p.name === slotDraft.pokemonName) || null;
}

// The Mega form this slot's held item unlocks for the current base Pokémon, if any —
// used only to power the "preview Mega form" toggle (base/mega identity in the saved
// slot never changes; this is a stats/ability preview only).
function currentSlotMegaVariant() {
  const mon = currentSlotMon();
  if (!mon || !slotDraft.item) return null;
  const itemInfo = itemsForGame(currentEditingTeam.game).find(it => it.slug === slotDraft.item);
  const baseSlug = megaStoneBaseSlug(itemInfo);
  if (!baseSlug || baseSlug !== mon.name) return null;
  return findMegaVariant(mon.name, itemInfo.name, slotEditorPokemonList);
}

function slotFieldPickerHtml(fieldKey, label, currentDisplay, placeholder) {
  return `<div class="slot-form-row">
    <label class="field-label">${label}</label>
    <div class="slot-item-search-wrap">
      <input type="text" class="search-box" data-slot-field="${fieldKey}" placeholder="${currentDisplay ? escapeHtml(currentDisplay) : placeholder}">
      <div class="option-dropdown" data-slot-dropdown="${fieldKey}"></div>
    </div>
  </div>`;
}

function renderStatInvestmentRows(mon) {
  const isChampions = currentEditingTeam.game === CHAMPIONS_VG;
  const caps = evCapsForGame(currentEditingTeam.game);
  const evTotal = STAT_KEYS.reduce((s, k) => s + (slotDraft.evs[k] || 0), 0);

  const rows = STAT_KEYS.map(k => {
    const base = mon.stats[k] || 0;
    const ev = slotDraft.evs[k] || 0;
    const iv = slotDraft.ivs ? (slotDraft.ivs[k] ?? 31) : 31;
    const projected = computeStat(base, k, ev, iv, isChampions);
    const ivControls = slotDraft.ivs ? `
      <div class="stepper-group">
        <button type="button" class="stepper-btn" data-iv-dec="${k}">−</button>
        <input type="number" min="0" max="31" data-iv-stat="${k}" value="${iv}">
        <button type="button" class="stepper-btn" data-iv-inc="${k}">+</button>
      </div>` : '';
    return `<div class="stat-invest-row">
      <span class="stat-invest-label">${STAT_LABELS[k]}</span>
      <span class="stat-invest-base">Base ${base}</span>
      <div class="stepper-group">
        <button type="button" class="stepper-btn" data-ev-dec="${k}">−</button>
        <input type="number" min="0" max="${caps.perStat}" data-ev-stat="${k}" value="${ev}">
        <button type="button" class="stepper-btn" data-ev-inc="${k}">+</button>
      </div>
      ${ivControls}
      <span class="stat-invest-projected">→ <strong>${projected}</strong> <span class="hint">(Lv ${DISPLAY_LEVEL})</span></span>
    </div>`;
  }).join('');

  return `<div class="slot-form-row">
    <label class="field-label">EVs (0-${caps.perStat} each, ${caps.total} total)${slotDraft.ivs ? ' &amp; IVs (0-31 each)' : ''}</label>
    <div class="stat-invest-grid">${rows}</div>
    <div class="ev-total-row ${evTotal > caps.total ? 'over-cap' : ''}">EV total: ${evTotal} / ${caps.total}</div>
    ${!slotDraft.ivs ? '<div class="hint">IVs aren\'t used in Pokémon Champions — treated as a fixed 31.</div>' : ''}
  </div>`;
}

function renderSlotModal() {
  const mon = currentSlotMon();
  let html = `<button class="modal-close" id="slot-close-btn" type="button">✕</button>
    <h2>${mon ? escapeHtml(slotDraft.displayName || formatName(mon.name)) : 'Add Pokémon'}</h2>`;

  html += slotFieldPickerHtml('pokemon', 'Pokémon', mon ? (slotDraft.displayName || formatName(mon.name)) : '', 'Search Pokémon…');

  if (mon) {
    const megaVariant = currentSlotMegaVariant();
    const displayMon = (megaPreviewActive && megaVariant) ? megaVariant : mon;

    if (megaVariant) {
      html += `<div class="slot-form-row">
        <button type="button" id="mega-preview-toggle" class="reset-btn ${megaPreviewActive ? 'sort-active' : ''}">
          ${megaPreviewActive ? '✓ ' : ''}Preview ${escapeHtml(megaVariant.displayNameOverride || formatName(megaVariant.name))} (stats/ability only — this slot still holds the base Pokémon)
        </button>
      </div>`;
    }

    // Ability
    html += slotFieldPickerHtml('ability', 'Ability', slotDraft.ability ? formatName(slotDraft.ability) : '', 'Search abilities…');
    if (megaPreviewActive && megaVariant) {
      const megaAbility = megaVariant.abilities[0];
      html += `<div class="hint">As ${escapeHtml(formatName(megaVariant.name))}, ability is fixed: <strong>${megaAbility ? escapeHtml(formatName(megaAbility.name)) : '—'}</strong> (doesn't change the saved ability above)</div>`;
    }

    // Moves
    html += `<div class="slot-form-row"><label class="field-label">Moves</label><div class="move-slot-grid">`;
    for (let i = 0; i < 4; i++) {
      const mv = slotDraft.moves[i];
      html += slotFieldPickerHtml(`move-${i}`, `Move ${i + 1}`, mv ? formatName(mv) : '', 'Search moves…');
    }
    html += `</div></div>`;

    // Item
    html += slotFieldPickerHtml('item', 'Held Item', slotDraft.item ? formatName(slotDraft.item) : '', 'Search items…');

    // EVs / IVs + projected stats (reflect the Mega's base stats while previewing)
    html += renderStatInvestmentRows(displayMon);
  }

  html += `<div class="slot-form-row" style="display:flex; gap:8px; margin-top:20px;">
    <button type="button" class="reset-btn" id="slot-save-btn" ${mon ? '' : 'disabled'}>Save Slot</button>
    <button type="button" class="reset-btn" id="slot-cancel-btn">Cancel</button>
  </div>`;

  el.slotModal.innerHTML = html;
  document.getElementById('slot-close-btn').addEventListener('click', closeSlotEditor);
  document.getElementById('slot-cancel-btn').addEventListener('click', closeSlotEditor);
  const saveBtn = document.getElementById('slot-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', commitSlotDraft);

  const megaToggleBtn = document.getElementById('mega-preview-toggle');
  if (megaToggleBtn) megaToggleBtn.addEventListener('click', () => { megaPreviewActive = !megaPreviewActive; renderSlotModal(); });

  el.slotModal.querySelectorAll('[data-ev-stat]').forEach(input => {
    input.addEventListener('input', () => {
      const caps = evCapsForGame(currentEditingTeam.game);
      let val = input.value === '' ? 0 : Math.max(0, Math.min(caps.perStat, Number(input.value)));
      slotDraft.evs[input.dataset.evStat] = val;
      renderSlotModal();
    });
  });
  el.slotModal.querySelectorAll('[data-iv-stat]').forEach(input => {
    input.addEventListener('input', () => {
      let val = input.value === '' ? 0 : Math.max(0, Math.min(31, Number(input.value)));
      slotDraft.ivs[input.dataset.ivStat] = val;
      renderSlotModal();
    });
  });

  setupStepperButtons();

  el.slotModal.querySelectorAll('[data-slot-field]').forEach(input => {
    input.addEventListener('input', () => renderSlotFieldDropdown(input.dataset.slotField, input.value));
    input.addEventListener('focus', () => renderSlotFieldDropdown(input.dataset.slotField, input.value));
  });
}

// ---------- Press-and-hold EV/IV steppers ----------
let stepperHoldTimer = null;
let stepperHoldInterval = null;

function clearStepperHold() {
  if (stepperHoldTimer) { clearTimeout(stepperHoldTimer); stepperHoldTimer = null; }
  if (stepperHoldInterval) { clearInterval(stepperHoldInterval); stepperHoldInterval = null; }
}

function stepStat(kind, statKey, delta) {
  const isEv = kind === 'ev';
  const store = isEv ? slotDraft.evs : slotDraft.ivs;
  if (!store) return;
  const max = isEv ? evCapsForGame(currentEditingTeam.game).perStat : 31;
  store[statKey] = Math.max(0, Math.min(max, (store[statKey] || 0) + delta));
  renderSlotModal();
}

function setupStepperButtons() {
  const bind = (selector, kind, sign) => {
    el.slotModal.querySelectorAll(selector).forEach(btn => {
      const statKey = btn.dataset.evDec || btn.dataset.evInc || btn.dataset.ivDec || btn.dataset.ivInc;
      const start = (e) => {
        e.preventDefault();
        stepStat(kind, statKey, sign);
        clearStepperHold();
        stepperHoldTimer = setTimeout(() => {
          stepperHoldInterval = setInterval(() => stepStat(kind, statKey, sign), 80);
        }, 400);
      };
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', clearStepperHold);
      btn.addEventListener('mouseleave', clearStepperHold);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', clearStepperHold);
    });
  };
  bind('[data-ev-dec]', 'ev', -1);
  bind('[data-ev-inc]', 'ev', 1);
  bind('[data-iv-dec]', 'iv', -1);
  bind('[data-iv-inc]', 'iv', 1);
}

function getSlotFieldOptions(fieldKey) {
  if (fieldKey === 'pokemon') {
    return slotEditorPokemonList
      .filter(p => !/-mega(-[a-z])?$/.test(p.name))
      .map(p => ({ value: p.name, label: p.displayNameOverride || formatName(p.name), effect: '' }));
  }
  const mon = currentSlotMon();
  if (!mon) return [];
  if (fieldKey === 'ability') {
    return mon.abilities.map(a => {
      const info = abilityDetails.get(a.name) || CHAMPIONS_ABILITY_OVERRIDES[a.name] || {};
      return { value: a.name, label: formatName(a.name) + (a.hidden ? ' (Hidden)' : ''), effect: info.shortEffect || '' };
    });
  }
  if (fieldKey.startsWith('move-')) {
    const otherSelectedMoves = slotDraft.moves.filter((m, i) => m && `move-${i}` !== fieldKey);
    return Array.from(mon.allMoveNames)
      .filter(m => !otherSelectedMoves.includes(m))
      .map(m => {
        const info = moveDetails.get(m) || {};
        return { value: m, label: formatName(m), effect: info.shortEffect || '' };
      });
  }
  if (fieldKey === 'item') {
    return itemsForGame(currentEditingTeam.game).map(it => ({ value: it.slug, label: it.name, effect: it.effect }));
  }
  return [];
}

function renderSlotFieldDropdown(fieldKey, query) {
  const dropdown = el.slotModal.querySelector(`[data-slot-dropdown="${fieldKey}"]`);
  if (!dropdown) return;
  const q = query.trim().toLowerCase();
  let options = getSlotFieldOptions(fieldKey);
  if (q) options = options.filter(o => o.label.toLowerCase().includes(q));
  options = options.slice(0, 60);
  if (!q || options.length === 0) {
    dropdown.classList.remove('open');
    dropdown.innerHTML = '';
    return;
  }
  dropdown.innerHTML = options.map(o => `<div data-pick-value="${escapeHtml(o.value)}">
    <div class="option-name">${escapeHtml(o.label)}</div>
    ${o.effect ? `<div class="option-effect">${escapeHtml(o.effect)}</div>` : ''}
  </div>`).join('');
  dropdown.classList.add('open');
  dropdown.querySelectorAll('[data-pick-value]').forEach(div => {
    div.addEventListener('click', () => applySlotFieldPick(fieldKey, div.dataset.pickValue));
  });
}

function applySlotFieldPick(fieldKey, value) {
  if (fieldKey === 'pokemon') {
    const mon = slotEditorPokemonList.find(p => p.name === value);
    if (!mon) return;
    slotDraft.pokemonName = mon.name;
    slotDraft.pokemonId = mon.id;
    slotDraft.spriteId = mon.spriteId || mon.id;
    slotDraft.displayName = mon.displayNameOverride || formatName(mon.name);
    // Auto-select the ability when there's only one option.
    slotDraft.ability = mon.abilities.length === 1 ? mon.abilities[0].name : null;
    slotDraft.moves = [null, null, null, null];
    slotDraft.item = null;
    megaPreviewActive = false;
  } else if (fieldKey === 'ability') {
    slotDraft.ability = value;
  } else if (fieldKey.startsWith('move-')) {
    const i = Number(fieldKey.split('-')[1]);
    slotDraft.moves[i] = value;
  } else if (fieldKey === 'item') {
    slotDraft.item = value;
    megaPreviewActive = false;
  }
  renderSlotModal();
}

function commitSlotDraft() {
  currentEditingTeam.slots[currentSlotIndex] = slotDraft;
  closeSlotEditor();
  renderTeamSlotsGrid();
}

function removeSlot(index) {
  currentEditingTeam.slots[index] = null;
  renderTeamSlotsGrid();
}

function initTeamBuilder() {
  loadTeams();
  populateTeamGameSelect();

  document.querySelectorAll('.view-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  el.newTeamBtn.addEventListener('click', createNewTeam);
  el.backToTeamList.addEventListener('click', () => closeTeamEditor(true));
  el.saveTeamBtn.addEventListener('click', saveCurrentTeam);
  el.teamGameSelect.addEventListener('change', onTeamGameChange);

  el.teamList.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const id = actionBtn.dataset.teamId;
      if (actionBtn.dataset.action === 'edit') editTeam(id);
      else if (actionBtn.dataset.action === 'delete') deleteTeam(id);
      return;
    }
    const card = e.target.closest('.team-card');
    if (card) editTeam(card.dataset.teamId);
  });

  el.teamSlotsGrid.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-slot]');
    if (removeBtn) { removeSlot(Number(removeBtn.dataset.removeSlot)); return; }
    const card = e.target.closest('[data-slot-index]');
    if (card) openSlotEditor(Number(card.dataset.slotIndex));
  });

  el.slotBackdrop.addEventListener('click', (e) => {
    if (e.target === el.slotBackdrop) closeSlotEditor();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-slot-field]') && !e.target.closest('[data-slot-dropdown]')) {
      el.slotModal.querySelectorAll('.option-dropdown').forEach(d => d.classList.remove('open'));
    }
  });
}

// ---------- Boot ----------
function init() {
  for (const g of GAMES) {
    const opt = document.createElement('option');
    opt.value = g.vg;
    opt.textContent = (g.vg === NATIONAL_DEX_VG || g.vg === CHAMPIONS_VG) ? g.label : `Gen ${g.gen} — ${g.label}`;
    el.gameSelect.appendChild(opt);
  }
  el.gameSelect.value = 'scarlet-violet';
  el.gameSelect.addEventListener('change', () => selectGame(el.gameSelect.value));

  renderTypeGroups();
  initStatFilterGrid();
  initMethodChecks();
  initSimpleListeners();
  initTeamBuilder();

  selectGame(el.gameSelect.value);
}

init();
