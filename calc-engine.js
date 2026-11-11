/* Damage calculation engine (Gen 9 mechanics). Pure functions, no DOM, no dependency on app.js.
   All names (moves / abilities / items) are lowercase-hyphen slugs, matching the rest of the app. */
const CalcEngine = (() => {
  const TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
    'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

  // attacking type -> { s: super effective vs, r: resisted by, i: no effect on }
  const CHART = {
    normal: { s: [], r: ['rock', 'steel'], i: ['ghost'] },
    fire: { s: ['grass', 'ice', 'bug', 'steel'], r: ['fire', 'water', 'rock', 'dragon'], i: [] },
    water: { s: ['fire', 'ground', 'rock'], r: ['water', 'grass', 'dragon'], i: [] },
    electric: { s: ['water', 'flying'], r: ['electric', 'grass', 'dragon'], i: ['ground'] },
    grass: { s: ['water', 'ground', 'rock'], r: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'], i: [] },
    ice: { s: ['grass', 'ground', 'flying', 'dragon'], r: ['fire', 'water', 'ice', 'steel'], i: [] },
    fighting: { s: ['normal', 'ice', 'rock', 'dark', 'steel'], r: ['poison', 'flying', 'psychic', 'bug', 'fairy'], i: ['ghost'] },
    poison: { s: ['grass', 'fairy'], r: ['poison', 'ground', 'rock', 'ghost'], i: ['steel'] },
    ground: { s: ['fire', 'electric', 'poison', 'rock', 'steel'], r: ['grass', 'bug'], i: ['flying'] },
    flying: { s: ['grass', 'fighting', 'bug'], r: ['electric', 'rock', 'steel'], i: [] },
    psychic: { s: ['fighting', 'poison'], r: ['psychic', 'steel'], i: ['dark'] },
    bug: { s: ['grass', 'psychic', 'dark'], r: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'], i: [] },
    rock: { s: ['fire', 'ice', 'flying', 'bug'], r: ['fighting', 'ground', 'steel'], i: [] },
    ghost: { s: ['psychic', 'ghost'], r: ['dark'], i: ['normal'] },
    dragon: { s: ['dragon'], r: ['steel'], i: ['fairy'] },
    dark: { s: ['psychic', 'ghost'], r: ['fighting', 'dark', 'fairy'], i: [] },
    steel: { s: ['ice', 'rock', 'fairy'], r: ['fire', 'water', 'electric', 'steel'], i: [] },
    fairy: { s: ['fighting', 'dragon', 'dark'], r: ['fire', 'poison', 'steel'], i: [] },
  };

  function singleEff(atk, def, gen) {
    const c = CHART[atk];
    if (!c) return 1;
    if (gen && gen <= 5 && def === 'steel' && (atk === 'ghost' || atk === 'dark')) return 0.5;
    if (c.i.includes(def)) return 0;
    if (c.s.includes(def)) return 2;
    if (c.r.includes(def)) return 0.5;
    return 1;
  }

  function typeEffectiveness(atkType, defTypes, gen) {
    return defTypes.reduce((m, t) => m * singleEff(atkType, t, gen), 1);
  }

  // ---- fixed-point helpers (Pokémon uses 4096-based modifiers with round-half-down) ----
  const pokeRound = n => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n));
  const applyMod = (value, mod) => pokeRound(value * mod / 4096);
  const chain = mods => mods.reduce((m, x) => (x === 4096 ? m : Math.floor((m * x + 2048) / 4096)), 4096);
  const stage = (stat, b) => (b >= 0 ? Math.floor(stat * (2 + b) / 2) : Math.floor(stat * 2 / (2 - b)));

  const STAT_LABEL = { hp: 'HP', attack: 'Atk', defense: 'Def', 'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe' };
  const pretty = s => String(s || '').split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');

  // ---- item tables ----
  const TYPE_ITEMS = {
    charcoal: 'fire', 'flame-plate': 'fire', 'mystic-water': 'water', 'splash-plate': 'water', 'sea-incense': 'water', 'wave-incense': 'water',
    magnet: 'electric', 'zap-plate': 'electric', 'miracle-seed': 'grass', 'meadow-plate': 'grass', 'rose-incense': 'grass',
    'never-melt-ice': 'ice', 'icicle-plate': 'ice', 'black-belt': 'fighting', 'fist-plate': 'fighting',
    'poison-barb': 'poison', 'toxic-plate': 'poison', 'soft-sand': 'ground', 'earth-plate': 'ground',
    'sharp-beak': 'flying', 'sky-plate': 'flying', 'twisted-spoon': 'psychic', 'mind-plate': 'psychic', 'odd-incense': 'psychic',
    'silver-powder': 'bug', 'insect-plate': 'bug', 'hard-stone': 'rock', 'stone-plate': 'rock', 'rock-incense': 'rock',
    'spell-tag': 'ghost', 'spooky-plate': 'ghost', 'dragon-fang': 'dragon', 'draco-plate': 'dragon',
    'black-glasses': 'dark', 'dread-plate': 'dark', 'metal-coat': 'steel', 'iron-plate': 'steel',
    'silk-scarf': 'normal', 'pixie-plate': 'fairy', 'fairy-feather': 'fairy',
  };
  const RESIST_BERRIES = {
    'occa-berry': 'fire', 'passho-berry': 'water', 'wacan-berry': 'electric', 'rindo-berry': 'grass', 'yache-berry': 'ice',
    'chople-berry': 'fighting', 'kebia-berry': 'poison', 'shuca-berry': 'ground', 'coba-berry': 'flying', 'payapa-berry': 'psychic',
    'tanga-berry': 'bug', 'charti-berry': 'rock', 'kasib-berry': 'ghost', 'haban-berry': 'dragon', 'colbur-berry': 'dark',
    'babiri-berry': 'steel', 'roseli-berry': 'fairy', 'chilan-berry': 'normal',
  };
  const ATE = { aerilate: 'flying', pixilate: 'fairy', refrigerate: 'ice', galvanize: 'electric', dragonize: 'dragon' };

  const FIXED_LEVEL = new Set(['seismic-toss', 'night-shade']);
  const FIXED_VALUE = { 'dragon-rage': 40, 'sonic-boom': 20 };
  const HALF_HP = new Set(['super-fang', 'natures-madness', 'ruination']);
  const ALWAYS_CRIT = new Set(['frost-breath', 'storm-throw', 'wicked-blow', 'surging-strikes', 'flower-trick', 'zippy-zap-never']);
  const IGNORE_DEF_BOOSTS = new Set(['sacred-sword', 'darkest-lariat', 'chip-away']);
  const PSYSHOCK = new Set(['psyshock', 'psystrike', 'secret-sword']);
  const SPREAD_TARGETS = new Set(['all-opponents', 'all-other-pokemon']);
  const FIXED_HITS = { 'surging-strikes': 3, 'triple-axel': 3, 'triple-kick': 3, 'population-bomb': 10 };

  function hasType(mon, t) { return mon.types.includes(t); }
  function defTypesOf(mon) { return mon.teraType ? [mon.teraType] : mon.types; }

  function isGrounded(mon, field, ability, item) {
    if (field.gravity) return true;
    if (item === 'iron-ball') return true;
    if (defTypesOf(mon).includes('flying')) return false;
    if (ability === 'levitate' || ability === 'eelevate') return false;
    if (item === 'air-balloon') return false;
    return true;
  }

  function koDistribution(totalDist, hp, maxHits = 4) {
    // totalDist: Map<damageSum, probability> for one full attack sequence. Returns chance to KO in n repeats.
    const out = [];
    let cur = new Map([[0, 1]]);
    for (let n = 1; n <= maxHits; n++) {
      const next = new Map();
      for (const [s, p] of cur) {
        for (const [d, q] of totalDist) {
          const t = Math.min(hp, s + d);
          next.set(t, (next.get(t) || 0) + p * q);
        }
      }
      cur = next;
      out.push(cur.get(hp) || 0);
    }
    return out;
  }

  function sequenceDistribution(hitRolls) {
    let cur = new Map([[0, 1]]);
    for (const rolls of hitRolls) {
      const next = new Map();
      for (const [s, p] of cur) {
        for (const r of rolls) next.set(s + r, (next.get(s + r) || 0) + p / rolls.length);
      }
      cur = next;
    }
    return cur;
  }

  function hazardDamage(d, field) {
    const side = field.defenderSide || {};
    let total = 0; const notes = [];
    const maxHp = d.stats.hp;
    if (side.stealthRock) {
      const eff = typeEffectiveness('rock', defTypesOf(d), field.gen);
      total += Math.floor(maxHp * eff / 8); notes.push('Stealth Rock');
    }
    if (side.spikes > 0 && isGrounded(d, field, d.ability, d.item)) {
      total += Math.floor(maxHp / [8, 6, 4][side.spikes - 1]); notes.push(`${side.spikes} layer${side.spikes > 1 ? 's' : ''} of Spikes`);
    }
    return { total, notes };
  }

  /**
   * a, d: { label, types, teraType, level, stats (final, pre-boost), boosts, evs, natureSigns, ability, item,
   *         status ('', 'brn','par','psn','tox','slp','frz'), curHp, canEvolve, flags:{flashFire, protosynthesis, ...} }
   * m:    { name, label, type, category, bp, hits, crit, flags:Set, hasSecondary, target }
   * field:{ format, weather, terrain, gravity, magicRoom, wonderRoom, gen, attackerSide, defenderSide }
   */
  function calc(a, d, m, field) {
    const res = { immune: null, noDamage: false, hitRolls: [], min: 0, max: 0, minPct: 0, maxPct: 0, ko: null, desc: '', bp: 0, type: m.type, category: m.category, effectiveness: 1 };
    const aSide = field.attackerSide || {}, dSide = field.defenderSide || {};
    const gen = field.gen || 9;
    const aItem = field.magicRoom ? null : a.item;
    const dItem = field.magicRoom ? null : d.item;
    const aAbility = a.ability;
    const IGNORES = ['mold-breaker', 'teravolt', 'turboblaze'].includes(aAbility);
    const dAbility = IGNORES ? null : d.ability;
    const name = m.name;
    const flags = m.flags || new Set();
    const aTags = [], dTags = [], fTags = [];

    let weather = field.weather || '';
    if (aAbility === 'mega-sol' && weather !== 'harsh-sun') { weather = 'sun'; fTags.push('Mega Sol'); }
    if (['cloud-nine', 'air-lock'].includes(a.ability) || ['cloud-nine', 'air-lock'].includes(d.ability)) weather = '';
    const umbrella = aItem === 'utility-umbrella' || dItem === 'utility-umbrella';
    const sunny = (weather === 'sun' || weather === 'harsh-sun') && !umbrella;
    const rainy = (weather === 'rain' || weather === 'heavy-rain') && !umbrella;

    if (m.category === 'status' || (!m.bp && !FIXED_LEVEL.has(name) && !(name in FIXED_VALUE) && !HALF_HP.has(name) && !SPECIAL_BP[name])) {
      res.noDamage = true; return res;
    }

    const aGrounded = isGrounded(a, field, aAbility, aItem);
    const dGrounded = isGrounded(d, field, dAbility, dItem);
    let moveType = m.type;
    let isPhys = m.category === 'physical';

    // ---- move-type adjustments ----
    if (name === 'weather-ball') {
      moveType = sunny ? 'fire' : rainy ? 'water' : weather === 'sand' ? 'rock' : weather === 'snow' ? 'ice' : 'normal';
    }
    if (name === 'terrain-pulse' && aGrounded) {
      moveType = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic' }[field.terrain] || 'normal';
    }
    let typeBoostFromAbility = false;
    if (aAbility === 'normalize') { moveType = 'normal'; typeBoostFromAbility = true; }
    else if (ATE[aAbility] && moveType === 'normal') { moveType = ATE[aAbility]; typeBoostFromAbility = true; }
    res.type = moveType;

    // ---- fixed-damage moves ----
    const typeEffOf = () => {
      let eff = typeEffectiveness(moveType, defTypesOf(d), gen);
      if (name === 'freeze-dry' && defTypesOf(d).includes('water')) eff = typeEffectiveness('ice', defTypesOf(d).filter(t => t !== 'water'), gen) * 2;
      if (name === 'flying-press') eff *= typeEffectiveness('flying', defTypesOf(d), gen);
      if ((aAbility === 'scrappy' || aAbility === 'mind-s-eye' || aAbility === 'minds-eye') && defTypesOf(d).includes('ghost') && (moveType === 'normal' || moveType === 'fighting')) {
        eff = typeEffectiveness(moveType, defTypesOf(d).filter(t => t !== 'ghost'), gen);
      }
      if (name === 'thousand-arrows' && defTypesOf(d).includes('flying')) {
        eff = typeEffectiveness('ground', defTypesOf(d).filter(t => t !== 'flying'), gen);
      }
      return eff;
    };
    let eff = typeEffOf();
    if (weather === 'strong-winds' && defTypesOf(d).includes('flying') && singleEff(moveType, 'flying', gen) > 1) eff /= 2;
    res.effectiveness = eff;

    const immuneBy = (() => {
      if (weather === 'harsh-sun' && moveType === 'water' && !umbrella) return 'Harsh Sunshine';
      if (weather === 'heavy-rain' && moveType === 'fire' && !umbrella) return 'Heavy Rain';
      if (eff === 0) return `${pretty(moveType)} doesn't affect ${defTypesOf(d).map(pretty).join('/')}`;
      if (moveType === 'ground' && name !== 'thousand-arrows' && !dGrounded && !field.gravity) {
        if (defTypesOf(d).includes('flying')) return 'Flying type';
        if (dAbility === 'levitate' || dAbility === 'eelevate') return pretty(dAbility);
        return dItem === 'air-balloon' ? 'Air Balloon' : 'not grounded';
      }
      const ab = dAbility;
      if (ab) {
        const imm = { 'flash-fire': 'fire', 'well-baked-body': 'fire', 'water-absorb': 'water', 'storm-drain': 'water', 'dry-skin': 'water',
          'volt-absorb': 'electric', 'lightning-rod': 'electric', 'motor-drive': 'electric', 'sap-sipper': 'grass', 'earth-eater': 'ground' };
        if (imm[ab] === moveType) return `${pretty(ab)}`;
        if (ab === 'wonder-guard' && eff <= 1 && aAbility !== 'mold-breaker') return 'Wonder Guard';
        if (ab === 'bulletproof' && flags.has('ballistics')) return 'Bulletproof';
        if (ab === 'soundproof' && flags.has('sound')) return 'Soundproof';
        if (ab === 'wind-rider' && flags.has('wind')) return 'Wind Rider';
      }
      if (moveType === 'ground' && dItem === 'air-balloon') return 'Air Balloon';
      return null;
    })();
    if (immuneBy) { res.immune = immuneBy; res.hitRolls = [[0]]; return finalize(res, a, d, field, m, aTags, dTags, fTags, 0); }

    if (FIXED_LEVEL.has(name)) return fixed(a.level);
    if (name in FIXED_VALUE) return fixed(FIXED_VALUE[name]);
    if (HALF_HP.has(name)) return fixed(Math.max(1, Math.floor(d.curHp / 2)));
    function fixed(v) {
      res.hitRolls = [[v]];
      return finalize(res, a, d, field, m, aTags, dTags, fTags, 0);
    }

    // ---- hits ----
    let hits = m.hits || FIXED_HITS[name] || 1;
    const parentalBond = aAbility === 'parental-bond' && hits === 1 && !SPREAD_TARGETS.has(m.target);
    const crit = !!(m.crit || ALWAYS_CRIT.has(name)) && !['battle-armor', 'shell-armor'].includes(dAbility);

    // ---- base power ----
    let bp = m.bp || 0;
    const aHpRatio = a.curHp / a.stats.hp, dHpRatio = d.curHp / d.stats.hp;
    const special = SPECIAL_BP[name];
    if (special) {
      const v = special({ a, d, m, field, aItem, dItem, aHpRatio, dHpRatio, sunny, rainy, aGrounded, dGrounded, bp, weather });
      if (v != null) bp = v;
    }
    if (bp <= 0) { res.noDamage = true; return res; }
    res.bp = bp;

    const bpMods = [];
    const hasFlag = f => flags.has(f);
    if (aAbility === 'technician' && bp <= 60) { bpMods.push(6144); aTags.push('Technician'); }
    if (aAbility === 'tough-claws' && hasFlag('contact')) { bpMods.push(5325); aTags.push('Tough Claws'); }
    if (aAbility === 'iron-fist' && hasFlag('punch')) { bpMods.push(4915); aTags.push('Iron Fist'); }
    if (aAbility === 'strong-jaw' && hasFlag('bite')) { bpMods.push(6144); aTags.push('Strong Jaw'); }
    if (aAbility === 'mega-launcher' && hasFlag('pulse')) { bpMods.push(6144); aTags.push('Mega Launcher'); }
    if (aAbility === 'sharpness' && hasFlag('slicing')) { bpMods.push(6144); aTags.push('Sharpness'); }
    if (aAbility === 'punk-rock' && hasFlag('sound')) { bpMods.push(5325); aTags.push('Punk Rock'); }
    if (aAbility === 'sheer-force' && m.hasSecondary) { bpMods.push(5325); aTags.push('Sheer Force'); }
    if (aAbility === 'reckless' && hasFlag('recoil')) { bpMods.push(4915); aTags.push('Reckless'); }
    if (aAbility === 'analytic' && a.flags && a.flags.movesLast) { bpMods.push(5325); aTags.push('Analytic'); }
    if (aAbility === 'sand-force' && weather === 'sand' && ['rock', 'ground', 'steel'].includes(moveType)) { bpMods.push(5325); aTags.push('Sand Force'); }
    if (typeBoostFromAbility) { bpMods.push(4915); aTags.push(pretty(aAbility)); }
    if (dAbility === 'dry-skin' && moveType === 'fire') { bpMods.push(5120); dTags.push('Dry Skin'); }
    if (aSide.helpingHand) { bpMods.push(6144); fTags.push('Helping Hand'); }
    if (aSide.charge && moveType === 'electric') { bpMods.push(8192); fTags.push('Charge'); }
    if (aSide.steelySpirit && moveType === 'steel') { bpMods.push(6144); fTags.push('Steely Spirit'); }
    if (aGrounded && field.terrain === 'electric' && moveType === 'electric') { bpMods.push(5325); fTags.push('Electric Terrain'); }
    if (aGrounded && field.terrain === 'grassy' && moveType === 'grass') { bpMods.push(5325); fTags.push('Grassy Terrain'); }
    if (aGrounded && field.terrain === 'psychic' && moveType === 'psychic') { bpMods.push(5325); fTags.push('Psychic Terrain'); }
    if (dGrounded && field.terrain === 'misty' && moveType === 'dragon') { bpMods.push(2048); fTags.push('Misty Terrain'); }
    if (dGrounded && field.terrain === 'grassy' && ['earthquake', 'bulldoze', 'magnitude'].includes(name)) { bpMods.push(2048); fTags.push('Grassy Terrain'); }
    if (aItem && TYPE_ITEMS[aItem] === moveType) { bpMods.push(4915); aTags.push(pretty(aItem)); }
    else if (aItem === 'muscle-band' && isPhys) { bpMods.push(4505); aTags.push('Muscle Band'); }
    else if (aItem === 'wise-glasses' && !isPhys) { bpMods.push(4505); aTags.push('Wise Glasses'); }
    else if (aItem === 'punching-glove' && hasFlag('punch')) { bpMods.push(4506); aTags.push('Punching Glove'); }
    else if (aItem === 'adamant-orb' && a.label.toLowerCase().includes('dialga') && ['dragon', 'steel'].includes(moveType)) { bpMods.push(4915); aTags.push('Adamant Orb'); }
    else if (aItem === 'lustrous-orb' && a.label.toLowerCase().includes('palkia') && ['dragon', 'water'].includes(moveType)) { bpMods.push(4915); aTags.push('Lustrous Orb'); }
    else if ((aItem === 'griseous-orb' || aItem === 'griseous-core') && a.label.toLowerCase().includes('giratina') && ['dragon', 'ghost'].includes(moveType)) { bpMods.push(4915); aTags.push(pretty(aItem)); }
    bp = Math.max(1, applyMod(bp, chain(bpMods)));

    // ---- attack / defense stats ----
    let atkKey = isPhys ? 'attack' : 'special-attack';
    let defKey = isPhys ? 'defense' : 'special-defense';
    let src = a;
    if (name === 'foul-play') src = d;
    if (name === 'body-press') atkKey = 'defense';
    if (PSYSHOCK.has(name)) defKey = 'defense';
    if (field.wonderRoom) defKey = defKey === 'defense' ? 'special-defense' : 'defense';

    let atkBoost = (src.boosts && src.boosts[atkKey]) || 0;
    let defBoost = (d.boosts && d.boosts[defKey]) || 0;
    if (crit) { if (atkBoost < 0) atkBoost = 0; if (defBoost > 0) defBoost = 0; }
    if (dAbility === 'unaware' && src === a) atkBoost = 0;
    if (aAbility === 'unaware') defBoost = 0;
    if (IGNORE_DEF_BOOSTS.has(name)) defBoost = 0;

    let A = stage(src.stats[atkKey], atkBoost);
    let D = stage(d.stats[defKey], defBoost);

    const atMods = [], dfMods = [];
    const atkIsPhysStat = atkKey === 'attack' || atkKey === 'defense';
    if ((aAbility === 'huge-power' || aAbility === 'pure-power') && isPhys && name !== 'foul-play') { atMods.push(8192); aTags.push(pretty(aAbility)); }
    if (aAbility === 'hustle' && isPhys) { atMods.push(6144); aTags.push('Hustle'); }
    if (aAbility === 'gorilla-tactics' && isPhys) { atMods.push(6144); aTags.push('Gorilla Tactics'); }
    if (aAbility === 'guts' && a.status && isPhys) { atMods.push(6144); aTags.push('Guts'); }
    if (aAbility === 'solar-power' && sunny && !isPhys) { atMods.push(6144); aTags.push('Solar Power'); }
    if (aAbility === 'orichalcum-pulse' && sunny && isPhys) { atMods.push(5461); aTags.push('Orichalcum Pulse'); }
    if (aAbility === 'hadron-engine' && field.terrain === 'electric' && !isPhys) { atMods.push(5461); aTags.push('Hadron Engine'); }
    if (aAbility === 'flash-fire' && a.flags && a.flags.flashFire && moveType === 'fire') { atMods.push(6144); aTags.push('Flash Fire'); }
    if (aAbility === 'fire-mane' && moveType === 'fire') { atMods.push(6144); aTags.push('Fire Mane'); }
    if (aAbility === 'water-bubble' && moveType === 'water') { atMods.push(8192); aTags.push('Water Bubble'); }
    if (aAbility === 'steelworker' && moveType === 'steel') { atMods.push(6144); aTags.push('Steelworker'); }
    if (aAbility === 'dragons-maw' && moveType === 'dragon') { atMods.push(6144); aTags.push("Dragon's Maw"); }
    if (aAbility === 'transistor' && moveType === 'electric') { atMods.push(5325); aTags.push('Transistor'); }
    if (aAbility === 'rocky-payload' && moveType === 'rock') { atMods.push(6144); aTags.push('Rocky Payload'); }
    if (aAbility === 'slow-start' && isPhys && a.flags && a.flags.slowStart) { atMods.push(2048); aTags.push('Slow Start'); }
    if (aAbility === 'defeatist' && aHpRatio <= 0.5) { atMods.push(2048); aTags.push('Defeatist'); }
    const pinch = { overgrow: 'grass', blaze: 'fire', torrent: 'water', swarm: 'bug' };
    if (pinch[aAbility] === moveType && aHpRatio <= 1 / 3) { atMods.push(6144); aTags.push(pretty(aAbility)); }
    if (aAbility === 'supreme-overlord' && a.flags && a.flags.fainted > 0) { atMods.push(4096 + 410 * a.flags.fainted); aTags.push(`Supreme Overlord (${a.flags.fainted})`); }
    if (['protosynthesis', 'quark-drive'].includes(aAbility) && a.flags && a.flags.paradox) {
      const best = ['attack', 'defense', 'special-attack', 'special-defense', 'speed'].reduce((b, k) => (a.stats[k] > a.stats[b] ? k : b), 'attack');
      if (best === atkKey) { atMods.push(5325); aTags.push(pretty(aAbility)); }
    }
    if (aItem === 'choice-band' && isPhys) { atMods.push(6144); aTags.push('Choice Band'); }
    if (aItem === 'choice-specs' && !isPhys) { atMods.push(6144); aTags.push('Choice Specs'); }
    if (aItem === 'thick-club' && isPhys && /cubone|marowak/.test(a.label.toLowerCase())) { atMods.push(8192); aTags.push('Thick Club'); }
    if (aItem === 'light-ball' && /pikachu/.test(a.label.toLowerCase())) { atMods.push(8192); aTags.push('Light Ball'); }
    if (aItem === 'deep-sea-tooth' && !isPhys && /clamperl/.test(a.label.toLowerCase())) { atMods.push(8192); aTags.push('Deep Sea Tooth'); }
    if (aSide.battery && !isPhys) { atMods.push(5325); fTags.push('Battery'); }
    if (aSide.powerSpot) { atMods.push(5325); fTags.push('Power Spot'); }
    if (dAbility === 'thick-fat' && (moveType === 'fire' || moveType === 'ice')) { atMods.push(2048); dTags.push('Thick Fat'); }
    if (dAbility === 'heatproof' && moveType === 'fire') { atMods.push(2048); dTags.push('Heatproof'); }
    if (dAbility === 'water-bubble' && moveType === 'fire') { atMods.push(2048); dTags.push('Water Bubble'); }
    if (dAbility === 'purifying-salt' && moveType === 'ghost') { atMods.push(2048); dTags.push('Purifying Salt'); }
    A = Math.max(1, applyMod(A, chain(atMods)));

    const dPhysStat = defKey === 'defense';
    if (weather === 'sand' && defTypesOf(d).includes('rock') && !dPhysStat) { dfMods.push(6144); fTags.push('Sand'); }
    if (weather === 'snow' && defTypesOf(d).includes('ice') && dPhysStat) { dfMods.push(6144); fTags.push('Snow'); }
    if (dAbility === 'fur-coat' && dPhysStat) { dfMods.push(8192); dTags.push('Fur Coat'); }
    if (dAbility === 'marvel-scale' && d.status && dPhysStat) { dfMods.push(6144); dTags.push('Marvel Scale'); }
    if (dAbility === 'grass-pelt' && field.terrain === 'grassy' && dPhysStat) { dfMods.push(6144); dTags.push('Grass Pelt'); }
    if (dItem === 'eviolite' && d.canEvolve) { dfMods.push(6144); dTags.push('Eviolite'); }
    if (dItem === 'assault-vest' && !dPhysStat) { dfMods.push(6144); dTags.push('Assault Vest'); }
    if (dItem === 'deep-sea-scale' && !dPhysStat && /clamperl/.test(d.label.toLowerCase())) { dfMods.push(8192); dTags.push('Deep Sea Scale'); }
    if (dItem === 'metal-powder' && dPhysStat && /ditto/.test(d.label.toLowerCase())) { dfMods.push(8192); dTags.push('Metal Powder'); }
    if (['protosynthesis', 'quark-drive'].includes(dAbility) && d.flags && d.flags.paradox) {
      const best = ['attack', 'defense', 'special-attack', 'special-defense', 'speed'].reduce((b, k) => (d.stats[k] > d.stats[b] ? k : b), 'attack');
      if (best === defKey) { dfMods.push(5325); dTags.push(pretty(d.ability)); }
    }
    D = Math.max(1, applyMod(D, chain(dfMods)));

    // ---- damage pipeline ----
    const L = a.level;
    let baseDamage = Math.floor(Math.floor(Math.floor(Math.floor(2 * L / 5 + 2) * bp * A / D) / 50) + 2);
    const spread = field.format === 'doubles' && SPREAD_TARGETS.has(m.target);
    if (spread) { baseDamage = pokeRound(baseDamage * 3072 / 4096); fTags.push('spread'); }
    if (sunny) {
      if (moveType === 'fire') { baseDamage = pokeRound(baseDamage * 6144 / 4096); fTags.push('Sun'); }
      else if (moveType === 'water') {
        if (name === 'hydro-steam') { baseDamage = pokeRound(baseDamage * 6144 / 4096); fTags.push('Sun'); }
        else { baseDamage = pokeRound(baseDamage * 2048 / 4096); fTags.push('Sun'); }
      }
    } else if (rainy) {
      if (moveType === 'water') { baseDamage = pokeRound(baseDamage * 6144 / 4096); fTags.push('Rain'); }
      else if (moveType === 'fire') { baseDamage = pokeRound(baseDamage * 2048 / 4096); fTags.push('Rain'); }
    }
    if (crit) baseDamage = Math.floor(baseDamage * 1.5);

    // STAB
    const tera = a.teraType;
    const origHas = hasType(a, moveType);
    let stab = 4096;
    if (tera && tera === moveType) stab = origHas ? 8192 : 6144;
    else if (origHas) stab = 6144;
    if (aAbility === 'adaptability' && (origHas || tera === moveType)) {
      stab = (tera && tera === moveType && origHas) ? 9216 : 8192; aTags.push('Adaptability');
    }

    // Final modifiers
    const finalMods = [];
    if ((dSide.reflect && isPhys && name !== 'brick-break' && name !== 'psychic-fangs' && name !== 'raging-bull') || (dSide.lightScreen && !isPhys) || dSide.auroraVeil) {
      if (!crit && aAbility !== 'infiltrator') {
        finalMods.push(field.format === 'doubles' ? 2732 : 2048);
        fTags.push(dSide.auroraVeil ? 'Aurora Veil' : (isPhys ? 'Reflect' : 'Light Screen'));
      }
    }
    if (dSide.friendGuard) { finalMods.push(3072); fTags.push('Friend Guard'); }
    if ((dAbility === 'multiscale' || dAbility === 'shadow-shield') && d.curHp === d.stats.hp) { finalMods.push(2048); dTags.push(pretty(dAbility)); }
    if (dAbility === 'fluffy' && hasFlag('contact') && moveType !== 'fire') { finalMods.push(2048); dTags.push('Fluffy'); }
    if (dAbility === 'fluffy' && moveType === 'fire' && !hasFlag('contact')) { finalMods.push(8192); dTags.push('Fluffy'); }
    if (dAbility === 'ice-scales' && !isPhys) { finalMods.push(2048); dTags.push('Ice Scales'); }
    if (dAbility === 'punk-rock' && hasFlag('sound')) { finalMods.push(2048); dTags.push('Punk Rock'); }
    if (['filter', 'solid-rock', 'prism-armor'].includes(dAbility) && eff > 1) { finalMods.push(3072); dTags.push(pretty(dAbility)); }
    if (aAbility === 'neuroforce' && eff > 1) { finalMods.push(5120); aTags.push('Neuroforce'); }
    if (aAbility === 'tinted-lens' && eff < 1) { finalMods.push(8192); aTags.push('Tinted Lens'); }
    if (aAbility === 'sniper' && crit) { finalMods.push(6144); aTags.push('Sniper'); }
    if ((name === 'collision-course' || name === 'electro-drift') && eff > 1) { finalMods.push(5461); }
    if (aItem === 'life-orb') { finalMods.push(5324); aTags.push('Life Orb'); }
    if (aItem === 'expert-belt' && eff > 1) { finalMods.push(4915); aTags.push('Expert Belt'); }
    if (dItem && RESIST_BERRIES[dItem] === moveType && (eff > 1 || moveType === 'normal')) {
      finalMods.push(dAbility === 'ripen' ? 1024 : 2048); dTags.push(pretty(dItem));
    }
    const finalMod = chain(finalMods);

    const burned = a.status === 'brn' && isPhys && aAbility !== 'guts' && name !== 'facade';
    if (burned) aTags.push('burned');
    if (a.status === 'brn' && aAbility === 'guts' && isPhys) { /* tag already added */ }

    const makeRolls = (baseDmg) => {
      const rolls = [];
      for (let i = 0; i < 16; i++) {
        let dmg = Math.floor(baseDmg * (85 + i) / 100);
        dmg = pokeRound(dmg * stab / 4096);
        dmg = Math.floor(dmg * eff);
        if (burned) dmg = Math.floor(dmg / 2);
        dmg = Math.max(1, applyMod(dmg, finalMod));
        if (dmg === 0 && eff > 0) dmg = 1;
        rolls.push(dmg);
      }
      return rolls;
    };

    if (name === 'triple-axel' || name === 'triple-kick') {
      const base = name === 'triple-axel' ? 20 : 10;
      const n = Math.min(3, Math.max(1, m.hits || 3));
      const per = [];
      for (let i = 1; i <= n; i++) {
        let hbp = base * i;
        hbp = Math.max(1, applyMod(hbp, chain(bpMods)));
        let bd = Math.floor(Math.floor(Math.floor(Math.floor(2 * L / 5 + 2) * hbp * A / D) / 50) + 2);
        per.push(makeRolls(bd));
      }
      res.hitRolls = per; res.hits = n;
    } else if (parentalBond) {
      res.hitRolls = [makeRolls(baseDamage), makeRolls(pokeRound(baseDamage * 1024 / 4096))];
      res.hits = 2; aTags.push('Parental Bond');
    } else {
      const one = makeRolls(baseDamage);
      res.hitRolls = Array.from({ length: hits }, () => one);
      res.hits = hits;
    }
    res.crit = crit; res.spread = spread; res.stab = stab; res.burned = burned;
    res.atkKey = atkKey; res.defKey = defKey; res.boosts = { atk: atkBoost, def: defBoost };
    res.srcMon = src;
    return finalize(res, a, d, field, m, aTags, dTags, fTags, 1);
  }

  function finalize(res, a, d, field, m, aTags, dTags, fTags, _) {
    const maxHp = d.stats.hp;
    const hitRolls = res.hitRolls;
    res.min = hitRolls.reduce((s, r) => s + Math.min(...r), 0);
    res.max = hitRolls.reduce((s, r) => s + Math.max(...r), 0);
    res.minPct = Math.floor(res.min * 1000 / maxHp) / 10;
    res.maxPct = Math.floor(res.max * 1000 / maxHp) / 10;
    res.possible = hitRolls.length === 1 ? hitRolls[0] : null;
    if (field.fast) return res;   // callers running thousands of evaluations only need the damage numbers

    const haz = hazardDamage(d, field);
    const hp = Math.max(1, d.curHp - haz.total);
    const dist = sequenceDistribution(hitRolls);
    const chances = koDistribution(dist, hp, 4);
    let ko = { n: 0, chance: 0, text: 'cannot KO in 4 hits' };
    for (let i = 0; i < chances.length; i++) {
      if (chances[i] > 0) {
        const pct = chances[i] >= 1 - 1e-9 ? null : Math.max(0.1, Math.round(chances[i] * 1000) / 10);
        const label = i === 0 ? 'OHKO' : `${i + 1}HKO`;
        ko = { n: i + 1, chance: chances[i], text: pct == null ? `guaranteed ${label}` : `${pct}% chance to ${label}` };
        break;
      }
    }
    if (haz.total > 0 && ko.n) ko.text += ` after ${haz.notes.join(' & ')}`;
    if (res.immune) ko = { n: 0, chance: 0, text: `no effect (${res.immune})` };
    res.ko = ko;

    // description
    const dedupe = arr => [...new Set(arr)];
    const sign = v => (v > 0 ? `+${v}` : `${v}`);
    const atkKey = res.atkKey || (m.category === 'physical' ? 'attack' : 'special-attack');
    const defKey = res.defKey || (m.category === 'physical' ? 'defense' : 'special-defense');
    const src = res.srcMon || a;
    const ns = k => (src.natureSigns && src.natureSigns[k] ? (src.natureSigns[k] > 0 ? '+' : '-') : '');
    const nd = k => (d.natureSigns && d.natureSigns[k] ? (d.natureSigns[k] > 0 ? '+' : '-') : '');
    const aBoost = res.boosts && res.boosts.atk ? `${sign(res.boosts.atk)} ` : '';
    const dBoost = res.boosts && res.boosts.def ? `${sign(res.boosts.def)} ` : '';
    const aPart = `${aBoost}${src.evs ? src.evs[atkKey] : 0}${ns(atkKey)} ${STAT_LABEL[atkKey]} ${dedupe(aTags).join(' ')}${aTags.length ? ' ' : ''}${src === a ? a.label : `${a.label} (using ${d.label}'s Attack)`} ${m.label}${res.hits > 1 && !m.fixedHits ? ` (${res.hits} hits)` : ''}${res.crit ? ' (crit)' : ''}`;
    const hpEv = d.evs ? d.evs.hp : 0;
    const dPart = `${hpEv} HP / ${dBoost}${d.evs ? d.evs[defKey] : 0}${nd(defKey)} ${STAT_LABEL[defKey]} ${dedupe(dTags).join(' ')}${dTags.length ? ' ' : ''}${d.label}`;
    const fieldPart = dedupe(fTags).filter(t => t !== 'spread').join(', ');
    res.desc = `${aPart.replace(/\s+/g, ' ').trim()} vs. ${dPart.replace(/\s+/g, ' ').trim()}${fieldPart ? ' in ' + fieldPart : ''}: ${res.min}-${res.max} (${res.minPct} - ${res.maxPct}%) -- ${ko.text}`;
    return res;
  }

  // Moves whose base power depends on the situation. Return the BP, or null to keep the move's own.
  const SPECIAL_BP = {
    'facade': c => (c.a.status ? 140 : 70),
    'hex': c => (c.d.status ? 130 : 65),
    'venoshock': c => (['psn', 'tox'].includes(c.d.status) ? 130 : 65),
    'brine': c => (c.dHpRatio <= 0.5 ? 130 : 65),
    'knock-off': c => (c.dItem ? 97 : 65),
    'acrobatics': c => (c.aItem ? 55 : 110),
    'weather-ball': c => (c.weather ? 100 : 50),
    'terrain-pulse': c => (c.aGrounded && c.field.terrain ? 100 : 50),
    'expanding-force': c => (c.aGrounded && c.field.terrain === 'psychic' ? 120 : 80),
    'rising-voltage': c => (c.dGrounded && c.field.terrain === 'electric' ? 140 : 70),
    'psyblade': c => (c.field.terrain === 'electric' ? 120 : 80),
    'misty-explosion': c => (c.aGrounded && c.field.terrain === 'misty' ? 150 : 100),
    'grav-apple': c => (c.field.gravity ? 120 : 80),
    'eruption': c => Math.max(1, Math.floor(150 * c.aHpRatio)),
    'water-spout': c => Math.max(1, Math.floor(150 * c.aHpRatio)),
    'dragon-energy': c => Math.max(1, Math.floor(150 * c.aHpRatio)),
    'hard-press': c => Math.max(1, Math.floor(100 * c.dHpRatio)),
    'crush-grip': c => Math.max(1, Math.floor(120 * c.dHpRatio)),
    'wring-out': c => Math.max(1, Math.floor(120 * c.dHpRatio)),
    'reversal': c => flailBp(c.a),
    'flail': c => flailBp(c.a),
    'gyro-ball': c => Math.min(150, Math.floor(25 * (c.d.speedFinal || c.d.stats.speed) / Math.max(1, c.a.speedFinal || c.a.stats.speed)) + 1),
    'electro-ball': c => {
      const r = (c.a.speedFinal || c.a.stats.speed) / Math.max(1, c.d.speedFinal || c.d.stats.speed);
      return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40;
    },
    'stored-power': c => 20 + 20 * positiveBoosts(c.a),
    'power-trip': c => 20 + 20 * positiveBoosts(c.a),
    'low-kick': c => weightBp(weightKg(c.d, c.dItem)),
    'grass-knot': c => weightBp(weightKg(c.d, c.dItem)),
    'heavy-slam': c => ratioBp(weightKg(c.a, c.aItem) / weightKg(c.d, c.dItem)),
    'heat-crash': c => ratioBp(weightKg(c.a, c.aItem) / weightKg(c.d, c.dItem)),
  };
  // Weight-based moves. `weight` is PokeAPI's hectograms; Heavy/Light Metal and Float Stone change it.
  function weightKg(mon, item) {
    let kg = (mon.weight || 500) / 10;
    if (mon.ability === 'heavy-metal') kg *= 2;
    if (mon.ability === 'light-metal') kg /= 2;
    if (item === 'float-stone') kg /= 2;
    return Math.max(0.1, kg);
  }
  const weightBp = kg => (kg < 10 ? 20 : kg < 25 ? 40 : kg < 50 ? 60 : kg < 100 ? 80 : kg < 200 ? 100 : 120);
  const ratioBp = r => (r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40);
  function positiveBoosts(mon) { return Object.values(mon.boosts || {}).reduce((s, v) => s + Math.max(0, v), 0); }
  function flailBp(mon) {
    const p = Math.floor(48 * mon.curHp / mon.stats.hp);
    return p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20;
  }

  return { TYPES, CHART, typeEffectiveness, calc, stage, hazardDamage, pretty, FIXED_HITS, ALWAYS_CRIT, TYPE_ITEMS, RESIST_BERRIES };
})();
