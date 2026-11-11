/* Battle-simulator logic: usage-based priors, foe stat/ability/item narrowing from observed damage, turn order and
   immunities, and matchup scoring. No DOM. Depends on globals from app.js (STAT_KEYS, natureModifier, slugify,
   moveDetails) and CalcEngine. */
const SimEngine = (() => {
  // How hidden information is handled (kept simple so it never clutters the calculation):
  //  * "likely" scenario assumes an item/ability only if it is clearly dominant (>= LIKELY_ITEM), or was revealed / inferred.
  //  * "worst case" scenario assumes the most damaging plausible item/ability (>= WORST_ITEM usage).
  //  * Choice Scarf is only shown as an extra speed tier when its usage is >= SCARF_MIN.
  //  * Observed damage, turn order and immunities then re-weight the odds automatically (see inferFoe).
  const LIKELY_ITEM = 0.40, WORST_ITEM = 0.08, SCARF_MIN = 0.08, MAX_SPREADS = 15, MAX_ITEMS = 10;
  const OFFENSE_ITEMS = new Set(['choice-band', 'choice-specs', 'life-orb', 'expert-belt', 'muscle-band', 'wise-glasses', 'punching-glove']);
  const isOffenseItem = s => OFFENSE_ITEMS.has(s) || !!CalcEngine.TYPE_ITEMS[s];
  const isDefenseItem = s => s === 'assault-vest' || s === 'eviolite' || !!CalcEngine.RESIST_BERRIES[s];

  // Abilities that change damage dealt / taken, and ones that grant a type immunity (used for worst cases, risk badges and inference).
  const OFFENSE_ABILITIES = new Set(['huge-power', 'pure-power', 'adaptability', 'technician', 'guts', 'hustle', 'sheer-force', 'tough-claws', 'iron-fist', 'strong-jaw',
    'mega-launcher', 'sharpness', 'punk-rock', 'gorilla-tactics', 'solar-power', 'supreme-overlord', 'orichalcum-pulse', 'hadron-engine', 'transistor', 'dragons-maw',
    'steelworker', 'rocky-payload', 'fire-mane', 'dragonize', 'water-bubble', 'analytic', 'tinted-lens', 'neuroforce', 'sniper', 'reckless']);
  const DEFENSE_ABILITIES = new Set(['multiscale', 'shadow-shield', 'fur-coat', 'thick-fat', 'ice-scales', 'fluffy', 'filter', 'solid-rock', 'prism-armor', 'marvel-scale',
    'grass-pelt', 'heatproof', 'punk-rock', 'purifying-salt', 'water-bubble', 'dry-skin']);
  const IMMUNITY_ABILITIES = { levitate: 'ground', eelevate: 'ground', 'earth-eater': 'ground', 'flash-fire': 'fire', 'well-baked-body': 'fire', 'water-absorb': 'water',
    'storm-drain': 'water', 'dry-skin': 'water', 'volt-absorb': 'electric', 'lightning-rod': 'electric', 'motor-drive': 'electric', 'sap-sipper': 'grass' };
  // Speed-doubling abilities: [weather|terrain|status that enables it, multiplier]
  const SPEED_ABILITIES = { 'swift-swim': ['rain', 2], chlorophyll: ['sun', 2], 'sand-rush': ['sand', 2], 'slush-rush': ['snow', 2], 'surge-surfer': ['electric', 2], 'quick-feet': ['status', 1.5] };
  const speedAbilityMult = (ab, weather, terrain, status) => {
    const e = SPEED_ABILITIES[ab]; if (!e) return 1;
    const [cond, mult] = e;
    const on = cond === 'rain' ? (weather === 'rain' || weather === 'heavy-rain') : cond === 'sun' ? (weather === 'sun' || weather === 'harsh-sun')
      : cond === 'status' ? !!status : (cond === 'electric' ? terrain === 'electric' : weather === cond);
    return on ? mult : 1;
  };

  const pctNum = s => (parseFloat(String(s || '0').replace('%', '')) || 0) / 100;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const zeroSp = () => ({ hp: 0, attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 });

  // ---------- usage priors ----------
  function priors(mon, format) {
    const c = mon && mon.champions;
    if (!c) return null;
    const u = (format === 'singles' ? (c.singles || c.doubles) : (c.doubles || c.singles));
    if (!u) return null;
    const tr = list => (list || []).map(x => ({ slug: slugify(x.name), p: pctNum(x.pct) }));
    return {
      moves: tr(u.moves), items: tr(u.items), abilities: tr(u.abilities),
      natures: (u.natures || []).map(n => ({ name: String(n.name).toLowerCase(), p: pctNum(n.pct) })),
      spreads: (u.evSpreads || []).map(s => ({
        p: pctNum(s.pct),
        sp: { hp: +s.hp || 0, attack: +s.atk || 0, defense: +s.def || 0, 'special-attack': +s.spa || 0, 'special-defense': +s.spd || 0, speed: +s.spe || 0 },
      })),
    };
  }

  /** Possible abilities for a Pokémon with their odds: its real abilities weighted by usage (or evenly, hidden ones rarer, when there's no usage data). */
  function abilityCandidates(mon, pri, know) {
    if (know && know.abilityKnown) return [{ slug: know.ability, p: 1, hidden: false }];
    const own = mon.abilities.map(a => ({ slug: a.name, hidden: !!a.hidden }));
    if (own.length <= 1) return own.map(a => ({ slug: a.slug, p: 1, hidden: a.hidden }));
    const usage = pri ? pri.abilities : [];
    const out = own.map(a => {
      const u = usage.find(x => x.slug === a.slug);
      return { slug: a.slug, hidden: a.hidden, p: u ? u.p : (usage.length ? 0.01 : (a.hidden ? 0.15 : 1)) };
    });
    const sum = out.reduce((s, x) => s + x.p, 0) || 1;
    out.forEach(x => { x.p /= sum; });
    return out.sort((a, b) => b.p - a.p);
  }

  // ---------- stats ----------
  function statFromMod(base, key, sp, mod, champ, level, iv = 31) {
    if (champ) {
      const core = Math.floor((2 * base + 31) * level / 100);
      return key === 'hp' ? core + level + 10 + sp : Math.floor((core + 5 + sp) * mod);
    }
    const evT = Math.floor(sp / 4);
    if (key === 'hp') return Math.floor((2 * base + iv + evT) * level / 100) + level + 10;
    return Math.floor((Math.floor((2 * base + iv + evT) * level / 100) + 5) * mod);
  }

  const candCache = new Map();
  function statCandidates(base, key, champ, level) {
    const ck = `${base}|${key}|${champ}|${level}`;
    if (candCache.has(ck)) return candCache.get(ck);
    const mods = key === 'hp' ? [1] : [0.9, 1, 1.1];
    const byVal = new Map();
    const top = champ ? 32 : 252, step = champ ? 1 : 4;
    for (const mod of mods) for (let sp = 0; sp <= top; sp += step) {
      const v = statFromMod(base, key, sp, mod, champ, level);
      const cur = byVal.get(v);
      if (!cur || sp < cur.sp) byVal.set(v, { val: v, sp, mod });
    }
    const out = Array.from(byVal.values()).sort((a, b) => a.val - b.val);
    candCache.set(ck, out);
    return out;
  }

  const effSpeed = (stat, boost, tailwind, par, scarf) => {
    let s = CalcEngine.stage(stat, boost || 0);
    if (tailwind) s *= 2;
    if (par) s = Math.floor(s / 2);
    if (scarf) s = Math.floor(s * 1.5);
    return s;
  };

  /** spec: { label, types, base, level, nature, sp, ivs, ability, item, status, hpPct | curHp, boosts, tera, canEvolve, weight, flags, tailwind, weather, terrain } */
  function toEngineMon(spec, champ) {
    const stats = {}, natureSigns = {};
    for (const k of STAT_KEYS) {
      const mod = natureModifier(spec.nature, k);
      stats[k] = statFromMod(spec.base[k] || 0, k, (spec.sp || {})[k] || 0, mod, champ, spec.level, spec.ivs ? (spec.ivs[k] ?? 31) : 31);
      natureSigns[k] = mod > 1 ? 1 : mod < 1 ? -1 : 0;
    }
    const maxHp = stats.hp;
    let curHp = spec.curHp != null ? spec.curHp : Math.round((spec.hpPct == null ? 100 : spec.hpPct) / 100 * maxHp);
    curHp = clamp(Math.round(curHp), 1, maxHp);
    let speed = effSpeed(stats.speed, (spec.boosts || {}).speed, spec.tailwind, spec.status === 'par' && spec.ability !== 'quick-feet', spec.item === 'choice-scarf');
    speed = Math.floor(speed * speedAbilityMult(spec.ability, spec.weather, spec.terrain, spec.status));
    return {
      label: spec.label, types: (spec.types || []).filter(Boolean), teraType: spec.tera || null, level: spec.level, stats,
      boosts: spec.boosts || {}, evs: spec.sp || zeroSp(), natureSigns, ability: spec.ability || null, item: spec.item || null,
      status: spec.status || '', curHp, canEvolve: !!spec.canEvolve, flags: spec.flags || {}, weight: spec.weight || null, speedFinal: speed,
    };
  }

  // ---------- assumed builds ----------
  const top = list => (list && list.length ? list.slice().sort((a, b) => b.p - a.p)[0] : null);

  /** The build we assume for a foe when nothing has been learned yet (or the posterior's best guess when it has). */
  function assumedBuild(mon, pri, know) {
    know = know || {};
    const cands = abilityCandidates(mon, pri, know);
    const topAb = cands[0] ? cands[0].slug : null;
    if (know.map) return Object.assign({ itemP: know.map.itemP || 0 }, know.map, {
      ability: know.abilityKnown ? know.ability : (know.map.ability || topAb),
      item: know.itemKnown ? know.item : know.map.item,
    });
    if (!pri) return { nature: 'hardy', sp: zeroSp(), ability: know.abilityKnown ? know.ability : (cands.length === 1 ? topAb : null), item: know.itemKnown ? know.item : null, itemP: 0 };
    const nat = top(pri.natures), spr = top(pri.spreads), it = top(pri.items);
    return {
      nature: nat ? nat.name : 'hardy', sp: spr ? Object.assign(zeroSp(), spr.sp) : zeroSp(),
      ability: know.abilityKnown ? know.ability : topAb,
      item: know.itemKnown ? know.item : (it && it.p >= LIKELY_ITEM ? it.slug : null), itemP: it ? it.p : 0,
    };
  }

  function plusNatureFor(key) {
    for (const [n, v] of Object.entries(NATURES)) if (v.plus === key && v.minus && v.minus !== key) return n;
    return 'hardy';
  }

  /** The most extreme plausible ability from a set (>= WORST_ITEM odds), or null. */
  function extremeAbility(cands, set) {
    return (cands || []).filter(c => c.p >= WORST_ITEM && set.has(c.slug)).sort((a, b) => b.p - a.p)[0] || null;
  }

  /** Scenario builds used for ranges: 'likely', 'maxOff' (key), 'minBulk', 'maxBulk' (key). */
  function scenarioBuild(base, pri, know, scenario, key, mon, champ) {
    const b = Object.assign({}, assumedBuild(mon, pri, know));
    b.sp = Object.assign(zeroSp(), b.sp);
    const top32 = champ ? 32 : 252;
    const cands = abilityCandidates(mon, pri, know);
    const abilityLocked = !!(know && know.abilityKnown);
    if (scenario === 'maxOff') {
      b.sp[key] = top32; b.nature = plusNatureFor(key);
      if (!(know && know.itemKnown)) {
        const best = (pri ? pri.items : []).filter(i => i.p >= WORST_ITEM && isOffenseItem(i.slug)).sort((a, c) => c.p - a.p)[0];
        if (best) b.item = best.slug;
      }
      if (!abilityLocked) { const ab = extremeAbility(cands, OFFENSE_ABILITIES); if (ab) b.ability = ab.slug; }
    } else if (scenario === 'minBulk') {
      b.sp.hp = 0; b.sp.defense = 0; b.sp['special-defense'] = 0; b.nature = 'hardy';
      if (!(know && know.itemKnown) && b.item && isDefenseItem(b.item)) b.item = null;
      if (!abilityLocked && DEFENSE_ABILITIES.has(b.ability) && !(know && know.map && know.map.ability === b.ability)) b.ability = null;
    } else if (scenario === 'maxBulk') {
      b.sp.hp = top32; b.sp[key] = top32; b.nature = plusNatureFor(key);
      if (!abilityLocked) { const ab = extremeAbility(cands, DEFENSE_ABILITIES); if (ab) b.ability = ab.slug; }
    }
    return b;
  }

  // ---------- observations & inference ----------
  const sumSet = hitRolls => {
    let sums = new Set([0]);
    for (const rolls of hitRolls) {
      const next = new Set();
      for (const s of sums) for (const r of rolls) next.add(s + r);
      sums = next;
    }
    return sums;
  };
  const FAST = { fast: true };
  const withAbility = (mon, ab) => (ab ? Object.assign({}, mon, { ability: ab }) : mon);

  /**
   * Observation kinds (built by the UI from the battle log, each carrying a frozen snapshot of the conditions):
   *  { kind:'offense', attacker:engineMon(foe), defender:engineMon(mine), move, field, dmg, ko, remaining }
   *  { kind:'bulk',    attacker:engineMon(mine), defender:engineMon(foe template), move, field, dropPct, beforePct, ko }
   *  { kind:'order',   mySpeed, foeFirst, trickRoom, foeBoost, foeTailwind, foePar, weather, terrain, foeStatus }
   *  { kind:'immune',  attacker:engineMon(mine), defender:engineMon(foe template), move, field }   // "it had no effect"
   */
  function evalOffense(o, val, item, ab) {
    if (!o.atkKey) {
      const r0 = CalcEngine.calc(o.attacker, o.defender, o.move, Object.assign({}, o.field, FAST));
      o.atkKey = r0.atkKey || (o.move.category === 'physical' ? 'attack' : 'special-attack');
    }
    const atk = withAbility(Object.assign({}, o.attacker, { stats: Object.assign({}, o.attacker.stats, { [o.atkKey]: val }), item }), ab);
    const r = CalcEngine.calc(atk, o.defender, o.move, Object.assign({}, o.field, FAST));
    if (r.immune || r.noDamage) return false;
    const sums = sumSet(r.hitRolls);
    if (o.ko) return Math.max(...sums) >= o.remaining;
    return sums.has(o.dmg);
  }

  function bulkSums(o, defVal, item, ab) {
    if (!o.defKey) {
      const r0 = CalcEngine.calc(o.attacker, o.defender, o.move, Object.assign({}, o.field, FAST));
      o.defKey = r0.defKey || (o.move.category === 'physical' ? 'defense' : 'special-defense');
    }
    const foe = withAbility(Object.assign({}, o.defender, { stats: Object.assign({}, o.defender.stats, { [o.defKey]: defVal }), item }), ab);
    foe.curHp = o.beforePct >= 99.5 ? foe.stats.hp : Math.max(1, foe.stats.hp - 1);
    const r = CalcEngine.calc(o.attacker, foe, o.move, Object.assign({}, o.field, FAST));
    if (r.immune || r.noDamage) return null;
    return Array.from(sumSet(r.hitRolls));
  }
  function bulkFits(o, sums, H) {
    if (!sums) return false;
    if (o.ko) return Math.max(...sums) / H * 100 >= o.beforePct - 0.5;
    return sums.some(s => Math.abs(s / H * 100 - o.dropPct) <= 1.0);
  }
  function evalOrder(o, speedVal, item, ab) {
    let foe = effSpeed(speedVal, o.foeBoost, o.foeTailwind, o.foePar && ab !== 'quick-feet', item === 'choice-scarf');
    foe = Math.floor(foe * speedAbilityMult(ab, o.weather, o.terrain, o.foeStatus));
    if (foe === o.mySpeed) return true;
    return (o.trickRoom ? foe < o.mySpeed : foe > o.mySpeed) === o.foeFirst;
  }
  function evalImmune(o, ab) {
    const r = CalcEngine.calc(o.attacker, withAbility(o.defender, ab), o.move, Object.assign({}, o.field, FAST));
    return !!r.immune;
  }

  /**
   * Narrow a foe's hidden build (stats, item, ability). Returns
   *  { n, builds:[{nature, sp, p}], items:[{slug,p}], abilities:[{slug,p}], map:{nature,sp,item,itemP,ability,abilityP}|null,
   *    ranges:{key:{min,max,vals}}, impossible }
   * ctx: { champ, level, pri, know, abilities:[{slug,p}] }
   */
  function inferFoe(foe, obsList, ctx) {
    const out = { n: obsList.length, builds: [], items: [], abilities: [], map: null, ranges: {}, impossible: false };
    if (!obsList.length) return out;
    const { champ, level, pri, know } = ctx;
    const base = foe.base;
    const offense = obsList.filter(o => o.kind === 'offense'), bulk = obsList.filter(o => o.kind === 'bulk'),
      order = obsList.filter(o => o.kind === 'order'), immune = obsList.filter(o => o.kind === 'immune');
    const memo = new Map();
    const cached = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };

    // Which attack keys / defence keys the observations touch (resolved lazily by running one calc each).
    for (const o of offense) evalOffense(o, o.attacker.stats[o.atkKey || 'attack'], o.attacker.item, null);
    for (const o of bulk) bulkSums(o, o.defender.stats[o.defKey || 'defense'], o.defender.item, null);
    const atkKeys = [...new Set(offense.map(o => o.atkKey))];
    const defKeys = [...new Set(bulk.map(o => o.defKey))];

    const offenseOk = (o, idx, val, item, ab) => cached(`o${idx}|${val}|${item}|${ab}`, () => evalOffense(o, val, item, ab));
    const bulkSumsC = (o, idx, defVal, item, ab) => cached(`b${idx}|${defVal}|${item}|${ab}`, () => bulkSums(o, defVal, item, ab));
    const orderOk = (o, idx, val, item, ab) => cached(`s${idx}|${val}|${item}|${ab}`, () => evalOrder(o, val, item, ab));
    const immuneOk = (o, idx, ab) => cached(`i${idx}|${ab}`, () => evalImmune(o, ab));

    // Ability hypotheses: each candidate (with usage odds), minus any contradicted by an "it had no effect" observation.
    const allAbilities = ctx.abilities && ctx.abilities.length ? ctx.abilities : [{ slug: null, p: 1 }];
    const abilities = allAbilities.filter(a => immune.every((o, i) => immuneOk(o, i, a.slug)));

    // Item options considered for the hypothesis grid.
    const usageItems = pri ? pri.items.slice().sort((a, b) => b.p - a.p).slice(0, MAX_ITEMS) : [];
    const knownItem = know && know.itemKnown ? know.item : undefined;
    const offItems = knownItem !== undefined ? [knownItem] : [null].concat(
      (pri ? usageItems.filter(i => isOffenseItem(i.slug)).map(i => i.slug) : ['life-orb', 'choice-band', 'choice-specs']));
    const defItems = knownItem !== undefined ? [knownItem] : [null].concat(
      (pri ? usageItems.filter(i => isDefenseItem(i.slug)).map(i => i.slug) : ['assault-vest']).concat(foe.canEvolve ? ['eviolite'] : []));
    const spdItems = knownItem !== undefined ? [knownItem] : [null].concat(pri ? usageItems.filter(i => i.slug === 'choice-scarf' && i.p >= SCARF_MIN).map(i => i.slug) : ['choice-scarf']);

    // ----- unconstrained ranges (every legal stat value), per ability hypothesis -----
    const rangesFor = ab => {
      const r = {};
      for (const key of atkKeys) {
        const feasible = new Set();
        for (const c of statCandidates(base[key], key, champ, level)) {
          for (const item of offItems) {
            if (offense.every((o, i) => o.atkKey !== key || offenseOk(o, i, c.val, item, ab))) { feasible.add(c.val); break; }
          }
        }
        r[key] = rangeOf(feasible);
      }
      if (bulk.length) {
        const hpVals = statCandidates(base.hp, 'hp', champ, level).map(c => c.val);
        const feasibleH = new Set(), feasibleDef = {};
        for (const k of defKeys) feasibleDef[k] = new Set();
        for (const item of defItems) {
          const defVals = {};
          for (const key of defKeys) defVals[key] = statCandidates(base[key], key, champ, level).map(c => c.val);
          // sums depend only on (defVal, item, ability); H only enters through the percentage check
          for (const H of hpVals) {
            let allKeysOk = true; const okVals = {};
            for (const key of defKeys) {
              okVals[key] = defVals[key].filter(dv => bulk.every((o, i) => o.defKey !== key || bulkFits(o, bulkSumsC(o, i, dv, item, ab), H)));
              if (!okVals[key].length) { allKeysOk = false; break; }
            }
            if (allKeysOk) { feasibleH.add(H); for (const key of defKeys) okVals[key].forEach(v => feasibleDef[key].add(v)); }
          }
        }
        r.hp = rangeOf(feasibleH);
        for (const key of defKeys) r[key] = rangeOf(feasibleDef[key]);
      }
      if (order.length) {
        const feasible = new Set();
        for (const c of statCandidates(base.speed, 'speed', champ, level)) {
          for (const item of spdItems) if (order.every((o, i) => orderOk(o, i, c.val, item, ab))) { feasible.add(c.val); break; }
        }
        r.speed = rangeOf(feasible);
      }
      return r;
    };
    const perAb = abilities.map(a => ({ a, r: rangesFor(a.slug) }));
    const viable = perAb.filter(x => Object.values(x.r).every(rg => rg.vals.length));
    const pool = viable.length ? viable : perAb;
    const keys = new Set(); pool.forEach(x => Object.keys(x.r).forEach(k => keys.add(k)));
    for (const k of keys) {
      const union = new Set(); pool.forEach(x => (x.r[k] ? x.r[k].vals : []).forEach(v => union.add(v)));
      out.ranges[k] = rangeOf(union);
    }
    out.impossible = !abilities.length || (!viable.length && Object.keys(out.ranges).length > 0 && Object.values(out.ranges).some(r => !r.vals.length));
    // Without a usage-based posterior, the ability odds are just the prior limited to the hypotheses that survive.
    const priorAb = (viable.length ? viable.map(x => x.a) : abilities);
    const priorSum = priorAb.reduce((s, a) => s + a.p, 0) || 1;
    out.abilities = priorAb.map(a => ({ slug: a.slug, p: a.p / priorSum })).sort((a, b) => b.p - a.p);

    // ----- posterior over the builds players actually run (usage data) -----
    if (pri && pri.spreads.length && !out.impossible) {
      const spreads = pri.spreads.slice(0, MAX_SPREADS);
      const natures = (pri.natures.filter(n => n.p >= 0.01).slice(0, 8)); if (!natures.length) natures.push({ name: 'hardy', p: 1 });
      const itemPrior = knownItem !== undefined ? [{ slug: knownItem, p: 1 }] : usageItems.slice();
      if (knownItem === undefined) { const rest = Math.max(0.0001, 1 - usageItems.reduce((s, i) => s + i.p, 0)); itemPrior.push({ slug: null, p: rest }); }
      const byBuild = new Map(), byItem = new Map(), byAbility = new Map(); let total = 0;
      spreads.forEach((sp, si) => natures.forEach(nat => {
        const stats = {};
        for (const k of STAT_KEYS) stats[k] = statFromMod(base[k] || 0, k, sp.sp[k] || 0, natureModifier(nat.name, k), champ, level);
        for (const it of itemPrior) for (const a of abilities) {
          const item = it.slug, ab = a.slug;
          let ok = true;
          for (let i = 0; ok && i < offense.length; i++) ok = offenseOk(offense[i], i, stats[offense[i].atkKey], item, ab);
          for (let i = 0; ok && i < bulk.length; i++) { const o = bulk[i]; ok = bulkFits(o, bulkSumsC(o, i, stats[o.defKey], item, ab), stats.hp); }
          for (let i = 0; ok && i < order.length; i++) ok = orderOk(order[i], i, stats.speed, item, ab);
          if (!ok) continue;
          const w = sp.p * nat.p * it.p * a.p; total += w;
          const bk = si + '|' + nat.name;
          byBuild.set(bk, (byBuild.get(bk) || { nature: nat.name, sp: sp.sp, w: 0 })); byBuild.get(bk).w += w;
          byItem.set(item, (byItem.get(item) || 0) + w);
          byAbility.set(ab, (byAbility.get(ab) || 0) + w);
        }
      }));
      if (total > 0) {
        out.builds = Array.from(byBuild.values()).map(b => ({ nature: b.nature, sp: b.sp, p: b.w / total })).sort((a, b) => b.p - a.p).slice(0, 6);
        out.items = Array.from(byItem.entries()).map(([slug, w]) => ({ slug, p: w / total })).sort((a, b) => b.p - a.p);
        out.abilities = Array.from(byAbility.entries()).map(([slug, w]) => ({ slug, p: w / total })).sort((a, b) => b.p - a.p);
        const best = out.builds[0], bestItem = out.items[0], bestAb = out.abilities[0];
        out.map = {
          nature: best.nature, sp: best.sp, item: bestItem && bestItem.p >= LIKELY_ITEM ? bestItem.slug : null, itemP: bestItem ? bestItem.p : 0,
          ability: bestAb && bestAb.slug && bestAb.p >= 0.5 ? bestAb.slug : null, abilityP: bestAb ? bestAb.p : 0,
        };
      }
    }
    // a lone surviving ability is as good as known even with no usage data
    if (!out.map && out.abilities.length === 1 && out.abilities[0].slug && allAbilities.length > 1) out.map = null;
    return out;
  }

  function rangeOf(set) {
    const vals = Array.from(set).sort((a, b) => a - b);
    return { vals, min: vals[0], max: vals[vals.length - 1] };
  }

  /** Abilities (with odds >= minP) that would make `moveType` do nothing, e.g. Levitate vs Ground. */
  function immunityRisks(candidates, moveType, minP = WORST_ITEM) {
    return (candidates || []).filter(c => c.p >= minP && IMMUNITY_ABILITIES[c.slug] === moveType);
  }

  // ---------- damage helpers used by matchup scoring and the live panel ----------
  const hitsToKO = pct => (pct <= 0 ? 99 : pct >= 100 ? 1 : Math.min(9, Math.ceil(100 / pct)));

  function moveResult(attacker, defender, move, field) {
    const r = CalcEngine.calc(attacker, defender, move, field);
    if (r.noDamage || r.immune) return { pctMin: 0, pctMax: 0, avg: 0, hits: 99, immune: !!r.immune, noDamage: !!r.noDamage, raw: r };
    const avg = (r.minPct + r.maxPct) / 2;
    return { pctMin: r.minPct, pctMax: r.maxPct, avg, hits: hitsToKO(avg), ko: r.ko, raw: r };
  }

  /** Damaging moves worth considering for a foe: revealed moves first, then top usage moves, then its best STAB moves. */
  function foeMoveList(mon, pri, revealed, limit = 6) {
    const seen = new Set(), out = [];
    const add = (slug, p, src) => {
      if (seen.has(slug) || !moveDetails.has(slug)) return;
      const info = moveDetails.get(slug);
      if (info.damageClass === 'status') return;
      seen.add(slug); out.push({ slug, p, src });
    };
    (revealed || []).forEach(s => add(s, 1, 'revealed'));
    if (pri) pri.moves.slice().sort((a, b) => b.p - a.p).forEach(m => { if (m.p >= 0.03) add(m.slug, m.p, 'usage'); });
    if (out.length < 3) {
      // No usage data: guess the moves a player would actually click — strong, accurate, same-type attacks, not recharge/self-KO moves.
      const extras = typeof snapshotMoveExtras === 'function' ? snapshotMoveExtras() : null;
      const AVOID = new Set(['explosion', 'self-destruct', 'misty-explosion', 'final-gambit', 'focus-punch', 'steel-beam', 'mind-blown', 'belch', 'dream-eater', 'last-resort', 'fling', 'uproar', 'future-sight', 'doom-desire']);
      const worth = s => {
        const info = moveDetails.get(s), ex = extras && extras.get(s);
        if (!info || info.damageClass === 'status' || !info.power || AVOID.has(s)) return 0;
        if (ex && ex.flags.includes('recharge')) return 0;
        return info.power * ((info.accuracy || 100) / 100) * (mon.types.includes(info.type) ? 1.5 : 1);
      };
      Array.from(mon.allMoveNames).map(s => ({ s, w: worth(s) })).filter(x => x.w > 0).sort((a, b) => b.w - a.w).slice(0, 4).forEach(c => add(c.s, 0, 'guess'));
    }
    return out.slice(0, limit);
  }

  function labelFor(score) {
    return score > 0.5 ? 'Strongly favored' : score > 0.2 ? 'Favored' : score >= -0.2 ? 'Even' : score >= -0.5 ? 'Disfavored' : 'Strongly disfavored';
  }

  /** score a single mine-vs-foe pairing. mineMon/foeMon are engine mons; moves are engine moves. */
  function matchup(mineMon, mineMoves, foeMon, foeMoves, field) {
    const evalSide = (att, def, moves) => {
      const rs = moves.map(m => Object.assign({ move: m }, moveResult(att, def, m.engine, field)));
      rs.sort((a, b) => (a.hits - b.hits) || (b.avg - a.avg));
      return { all: rs, best: rs[0] || null };
    };
    const mine = evalSide(mineMon, foeMon, mineMoves), foe = evalSide(foeMon, mineMon, foeMoves);
    const tM = mine.best ? mine.best.hits : 99, tF = foe.best ? foe.best.hits : 99;
    const mf = mineMon.speedFinal, ff = foeMon.speedFinal;
    const speed = mf > ff ? 1 : mf < ff ? -1 : 0;
    // who wins the exchange: faster Pokémon needs to KO in <= the slower one's hits
    let raw = clamp((tF - tM) / 3, -1, 1);
    if (tM === tF) raw = 0;
    const score = clamp(raw + speed * 0.25 + (tM === 1 && speed >= 0 ? 0.15 : 0) - (tF === 1 && speed <= 0 ? 0.15 : 0), -1, 1);
    return { mine, foe, speed, score, label: labelFor(score), tM, tF, mineSpeed: mf, foeSpeed: ff };
  }

  return { priors, abilityCandidates, immunityRisks, statFromMod, statCandidates, toEngineMon, assumedBuild, scenarioBuild, inferFoe, moveResult, foeMoveList, matchup, labelFor,
    effSpeed, speedAbilityMult, isOffenseItem, isDefenseItem, hitsToKO, zeroSp, plusNatureFor, IMMUNITY_ABILITIES, OFFENSE_ABILITIES, DEFENSE_ABILITIES,
    LIKELY_ITEM, WORST_ITEM, SCARF_MIN };
})();
