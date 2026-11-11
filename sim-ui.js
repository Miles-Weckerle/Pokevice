/* Battle simulator view. Uses globals from app.js, CalcEngine and SimEngine.
   Everything about a battle is an event in S.log; the live state is rebuilt by replaying it, so undo, manual
   overrides and the stat-narrowing all stay consistent with each other. */
(function () {
  'use strict';

  const KEY = 'pokemon-sim-state-v1';
  const STATUS_OPTS = [['', 'Healthy'], ['brn', 'Burned'], ['par', 'Paralyzed'], ['psn', 'Poisoned'], ['tox', 'Badly Poisoned'], ['slp', 'Asleep'], ['frz', 'Frozen']];
  const WEATHER_OPTS = [['', 'Clear'], ['sun', 'Sun'], ['rain', 'Rain'], ['sand', 'Sandstorm'], ['snow', 'Snow'], ['harsh-sun', 'Harsh Sunshine'], ['heavy-rain', 'Heavy Rain'], ['strong-winds', 'Strong Winds']];
  const TERRAIN_OPTS = [['', 'None'], ['electric', 'Electric'], ['grassy', 'Grassy'], ['misty', 'Misty'], ['psychic', 'Psychic']];
  const FIELD_TOGGLES = [['trickRoom', 'Trick Room'], ['gravity', 'Gravity'], ['magicRoom', 'Magic Room'], ['wonderRoom', 'Wonder Room']];
  const SIDE_TOGGLES = [['reflect', 'Reflect'], ['lightScreen', 'Light Screen'], ['auroraVeil', 'Aurora Veil'], ['friendGuard', 'Friend Guard'], ['stealthRock', 'Stealth Rock'], ['tailwind', 'Tailwind'],
    ['helpingHand', 'Helping Hand'], ['charge', 'Charge'], ['battery', 'Battery'], ['powerSpot', 'Power Spot'], ['steelySpirit', 'Steely Spirit']];
  const WEATHER_SETTERS = { drought: 'sun', 'orichalcum-pulse': 'sun', drizzle: 'rain', 'sand-stream': 'sand', 'snow-warning': 'snow', 'desolate-land': 'harsh-sun', 'primordial-sea': 'heavy-rain', 'delta-stream': 'strong-winds' };
  const TERRAIN_SETTERS = { 'electric-surge': 'electric', 'hadron-engine': 'electric', 'grassy-surge': 'grassy', 'misty-surge': 'misty', 'psychic-surge': 'psychic' };
  const BOOST_KEYS = ['attack', 'defense', 'special-attack', 'special-defense', 'speed'];
  const SPREAD_TARGETS = new Set(['all-opponents', 'all-other-pokemon']);
  const esc = escapeHtml;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clone = o => JSON.parse(JSON.stringify(o));
  const emptyBoosts = () => ({ attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 });
  const emptyConds = () => ({ reflect: false, lightScreen: false, auroraVeil: false, friendGuard: false, stealthRock: false, spikes: 0, tailwind: false, helpingHand: false, charge: false, battery: false, powerSpot: false, steelySpirit: false });
  const typeColor = t => TYPE_COLORS[t] || '#777';

  // ----- moves that change the field, and simple deterministic move effects -----
  // Logging one of these updates the field automatically (with its usual duration); anything unusual can be corrected with an override.
  const WEATHER_MOVES = { 'sunny-day': 'sun', 'rain-dance': 'rain', sandstorm: 'sand', snowscape: 'snow', hail: 'snow', 'chilly-reception': 'snow' };
  const TERRAIN_MOVES = { 'electric-terrain': 'electric', 'grassy-terrain': 'grassy', 'misty-terrain': 'misty', 'psychic-terrain': 'psychic' };
  const ROOM_MOVES = { 'trick-room': 'trickRoom', gravity: 'gravity', 'magic-room': 'magicRoom', 'wonder-room': 'wonderRoom' };
  // slug -> [condition, whose side ('self' = the user's side, 'opp' = the other side), turns it lasts (0 = until changed)]
  const SIDE_MOVES = { tailwind: ['tailwind', 'self', 4], reflect: ['reflect', 'self', 5], 'light-screen': ['lightScreen', 'self', 5], 'aurora-veil': ['auroraVeil', 'self', 5],
    'helping-hand': ['helpingHand', 'self', 1], charge: ['charge', 'self', 0], 'stealth-rock': ['stealthRock', 'opp', 0] };
  const CLEARS_OWN_HAZARDS = new Set(['rapid-spin', 'mortal-spin', 'tidy-up']);
  const BREAKS_SCREENS = new Set(['brick-break', 'psychic-fangs', 'raging-bull']);
  const isFieldMove = s => !!(WEATHER_MOVES[s] || TERRAIN_MOVES[s] || ROOM_MOVES[s] || SIDE_MOVES[s] || s === 'spikes' || s === 'defog' || CLEARS_OWN_HAZARDS.has(s));
  // self: stage changes on the user; target: stage changes on each Pokémon hit; status: condition inflicted on each target
  const MOVE_EFFECTS = {
    'swords-dance': { self: { attack: 2 } }, 'nasty-plot': { self: { 'special-attack': 2 } }, 'calm-mind': { self: { 'special-attack': 1, 'special-defense': 1 } },
    'dragon-dance': { self: { attack: 1, speed: 1 } }, 'bulk-up': { self: { attack: 1, defense: 1 } }, agility: { self: { speed: 2 } }, 'rock-polish': { self: { speed: 2 } },
    'quiver-dance': { self: { 'special-attack': 1, 'special-defense': 1, speed: 1 } }, 'shell-smash': { self: { attack: 2, 'special-attack': 2, speed: 2, defense: -1, 'special-defense': -1 } },
    'iron-defense': { self: { defense: 2 } }, 'acid-armor': { self: { defense: 2 } }, barrier: { self: { defense: 2 } }, amnesia: { self: { 'special-defense': 2 } }, coil: { self: { attack: 1, defense: 1 } },
    'work-up': { self: { attack: 1, 'special-attack': 1 } }, growth: { self: { attack: 1, 'special-attack': 1 } }, 'tail-glow': { self: { 'special-attack': 3 } }, 'hone-claws': { self: { attack: 1 } },
    'cosmic-power': { self: { defense: 1, 'special-defense': 1 } }, 'victory-dance': { self: { attack: 1, defense: 1, speed: 1 } }, 'belly-drum': { self: { attack: 6 } },
    'close-combat': { self: { defense: -1, 'special-defense': -1 } }, superpower: { self: { attack: -1, defense: -1 } }, 'draco-meteor': { self: { 'special-attack': -2 } },
    overheat: { self: { 'special-attack': -2 } }, 'leaf-storm': { self: { 'special-attack': -2 } }, 'fleur-cannon': { self: { 'special-attack': -2 } }, 'make-it-rain': { self: { 'special-attack': -1 } },
    'hammer-arm': { self: { speed: -1 } }, 'v-create': { self: { defense: -1, 'special-defense': -1, speed: -1 } }, 'armor-cannon': { self: { defense: -1, 'special-defense': -1 } },
    'dragon-ascent': { self: { defense: -1, 'special-defense': -1 } }, 'headlong-rush': { self: { defense: -1, 'special-defense': -1 } },
    'icy-wind': { target: { speed: -1 } }, electroweb: { target: { speed: -1 } }, 'bulldoze': { target: { speed: -1 } }, snarl: { target: { 'special-attack': -1 } },
    'struggle-bug': { target: { 'special-attack': -1 } }, 'parting-shot': { target: { attack: -1, 'special-attack': -1 } }, charm: { target: { attack: -2 } }, screech: { target: { defense: -2 } },
    'fake-tears': { target: { 'special-defense': -2 } }, growl: { target: { attack: -1 } }, leer: { target: { defense: -1 } }, tickle: { target: { attack: -1, defense: -1 } },
    'metal-sound': { target: { 'special-defense': -2 } }, 'string-shot': { target: { speed: -2 } }, 'scary-face': { target: { speed: -2 } }, 'baby-doll-eyes': { target: { attack: -1 } },
    'noble-roar': { target: { attack: -1, 'special-attack': -1 } }, 'breaking-swipe': { target: { attack: -1 } }, lunge: { target: { attack: -1 } }, 'trop-kick': { target: { attack: -1 } },
    'spirit-break': { target: { 'special-attack': -1 } }, 'mystical-fire': { target: { 'special-attack': -1 } }, 'chilling-water': { target: { attack: -1 } }, 'bitter-malice': { target: { attack: -1 } },
    'will-o-wisp': { status: 'brn' }, 'thunder-wave': { status: 'par' }, glare: { status: 'par' }, 'stun-spore': { status: 'par' }, toxic: { status: 'tox' }, 'poison-powder': { status: 'psn' },
    spore: { status: 'slp' }, 'sleep-powder': { status: 'slp' }, hypnosis: { status: 'slp' }, sing: { status: 'slp' }, 'lovely-kiss': { status: 'slp' }, 'dark-void': { status: 'slp' }, nuzzle: { status: 'par' },
  };
  // How a move picks its targets, from PokeAPI's move target (falls back to a built-in table when that data isn't loaded).
  function targetMode(slug) {
    if (isFieldMove(slug)) return 'field';
    const fx = MOVE_EFFECTS[slug];
    const t = (sim.extras.get(slug) || {}).target;
    if (!t) return fx && fx.self && !fx.target && !fx.status ? 'self' : 'single';
    if (t === 'selected-pokemon' || t === 'selected-pokemon-me-first' || t === 'random-opponent' || t === 'specific-move' || t === 'user-or-ally') return 'single';
    if (t === 'all-opponents' || t === 'all-other-pokemon') return 'spread';
    if (t === 'ally') return 'ally';
    if (t === 'user') return 'self';
    return 'field';   // users-field, opponents-field, entire-field, user-and-allies, all-allies, all-pokemon, fainting-pokemon
  }

  const defaultState = () => ({ game: CHAMPIONS_VG, format: 'doubles', phase: 'setup', teamId: null, myTeam: [], foe: [0, 1, 2, 3, 4, 5].map(() => ({ name: null })), leadsMine: [], backMine: [], leadsFoe: [], log: [] });
  let S = defaultState();
  const sim = { ready: false, roster: [], rosterMap: new Map(), extras: new Map(), loading: false, error: null };
  const UI = { composer: null, cell: null, edit: null, openPicker: null, matrix: null, matrixKey: '', inferCache: null, msg: '' };
  let root = null;

  const isChamp = () => S.game === CHAMPIONS_VG;
  const level = () => (isChamp() ? 50 : (S.format === 'singles' ? 100 : 50));
  const gameGen = () => { const g = GAMES.find(x => x.vg === S.game); return g && typeof g.gen === 'number' ? g.gen : 9; };
  const nActive = () => (S.format === 'singles' ? 1 : 2);
  const rosterMon = name => (name ? sim.rosterMap.get(name) || null : null);

  // ---------- persistence ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function restore() {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return;
      const d = JSON.parse(raw);
      S = Object.assign(defaultState(), d);
      if (!Array.isArray(S.foe) || S.foe.length !== 6) S.foe = defaultState().foe;
      if (!GAMES.some(g => g.vg === S.game)) S.game = CHAMPIONS_VG;
    } catch (e) { console.warn('Could not restore battle', e); }
  }

  // ---------- data loading ----------
  async function applyGame(vg, keepBattle) {
    S.game = vg; sim.loading = true; sim.error = null; setStatus('Loading…'); render();
    try {
      const [list] = await Promise.all([getTeamGamePokemon(vg), loadEvolutionGraph(), loadMoveDictionary(), loadAbilityDictionary()]);
      applyEvolutionFlags(list);
      sim.roster = list; sim.rosterMap = new Map(list.map(p => [p.name, p]));
      sim.extras = snapshotMoveExtras() || new Map();
      if (!keepBattle) { S.myTeam = []; S.teamId = null; S.leadsMine = []; S.backMine = []; S.leadsFoe = []; S.log = []; S.foe = defaultState().foe; S.phase = 'setup'; }
      setStatus('');
    } catch (e) { console.error(e); sim.error = e.message; setStatus('Could not load data'); }
    sim.loading = false; UI.matrix = null; UI.inferCache = null;
    save(); render();
  }
  function setStatus(msg) { const e = root && root.querySelector('#sim-status'); if (e) e.textContent = msg; }

  // ---------- engine helpers ----------
  function engMove(slug, opts) {
    const info = moveDetails.get(slug) || {}, ex = sim.extras.get(slug) || {};
    let hits = 1;
    if (ex.minHits) hits = ex.minHits === ex.maxHits ? ex.minHits : 3;
    if (CalcEngine.FIXED_HITS[slug]) hits = CalcEngine.FIXED_HITS[slug];
    return {
      name: slug, label: formatName(slug), type: info.type || 'normal', category: info.damageClass || 'physical', bp: info.power || 0, hits: (opts && opts.hits) || hits,
      crit: !!(opts && opts.crit) || CalcEngine.ALWAYS_CRIT.has(slug), flags: new Set(ex.flags || []), hasSecondary: ex.chance != null,
      target: opts && opts.target !== undefined ? opts.target : (ex.target || null),
    };
  }
  const priorsCache = new Map();
  function priorsFor(name) {
    const k = name + '|' + S.format;
    if (!priorsCache.has(k)) priorsCache.set(k, SimEngine.priors(rosterMon(name), S.format));
    return priorsCache.get(k);
  }
  // ----- Mega Evolution -----
  // p.mega is tri-state: a Mega's name (chosen), false (explicitly not Mega) or null (automatic).
  // Automatic = assume it Mega Evolves when it holds its Mega Stone (yours), or when its Mega Stone is by far
  // the most-used item (opponents) — those players almost always Mega Evolve.
  const MEGA_ASSUME = 0.6;
  function stoneVariant(baseName, itemSlug) {
    if (!itemSlug) return null;
    const it = itemsForGame(S.game).find(x => x.slug === itemSlug);
    const base = it ? megaStoneBaseSlug(it) : null;
    return base && base === baseName ? findMegaVariant(base, it.name, sim.roster) : null;
  }
  function effMega(side, i, p) {
    if (p && p.mega) return p.mega;
    if (p && p.mega === false) return null;
    if (side === 'mine') { const v = stoneVariant(S.myTeam[i].pokemonName, S.myTeam[i].item); return v ? v.name : null; }
    const baseName = S.foe[i].name; if (!baseName) return null;
    const know = p ? p.know : null;
    if (know && know.itemKnown) { const v = stoneVariant(baseName, know.item); return v ? v.name : null; }
    const pri = priorsFor(baseName), top = pri ? pri.items.slice().sort((a, b) => b.p - a.p)[0] : null;
    if (top && top.p >= MEGA_ASSUME) { const v = stoneVariant(baseName, top.slug); return v ? v.name : null; }
    return null;
  }
  function foePri(i, fs) { const m = effMega('foe', i, fs); return (m && priorsFor(m)) || priorsFor(S.foe[i].name); }

  function engineField(st, attackerSide, fast) {
    const other = attackerSide === 'mine' ? 'foe' : 'mine';
    return {
      format: S.format === 'singles' ? 'singles' : 'doubles', weather: st.field.weather, terrain: st.field.terrain, gravity: st.field.gravity, magicRoom: st.field.magicRoom,
      wonderRoom: st.field.wonderRoom, gen: gameGen(), attackerSide: st.side[attackerSide].conds, defenderSide: st.side[other].conds, fast: !!fast,
    };
  }

  // ----- my side -----
  function mineMonOf(i, ms) { return rosterMon(effMega('mine', i, ms) || S.myTeam[i].pokemonName); }
  function mineSpec(i, ms, conds, fld) {
    const slot = S.myTeam[i], mon = mineMonOf(i, ms), f = fld || UI.curField || {};
    return {
      weather: f.weather, terrain: f.terrain,
      label: slot.nickname || monDisplayName(mon), types: mon.types, base: mon.stats, level: level(), nature: slot.nature || 'hardy', sp: slot.evs, ivs: isChamp() ? null : slot.ivs,
      ability: effMega('mine', i, ms) ? (mon.abilities[0] || {}).name : slot.ability, item: slot.item, status: ms ? ms.status : '', curHp: ms ? ms.hp : null,
      boosts: ms ? ms.boosts : {}, canEvolve: !mon.isFinalEvolution, weight: mon.weight, tailwind: conds ? conds.tailwind : false,
    };
  }
  const mineEngine = (i, ms, conds, fld) => SimEngine.toEngineMon(mineSpec(i, ms, conds, fld), isChamp());

  // ----- foe side -----
  function foeMonOf(i, fs) { const base = S.foe[i].name; return rosterMon((fs && effMega('foe', i, fs)) || base); }
  function foeAssumedAbility(i, fs) {
    if (fs.know.abilityKnown) return fs.know.ability;
    const pri = foePri(i, fs), mon = foeMonOf(i, fs);
    if (effMega('foe', i, fs) && mon.abilities[0]) return mon.abilities[0].name;
    const top = pri ? pri.abilities.slice().sort((a, b) => b.p - a.p)[0] : null;
    if (top && top.p >= 0.6) return top.slug;
    return mon.abilities.length === 1 ? mon.abilities[0].name : null;
  }
  /** scenario: 'likely' | 'maxOff' | 'minBulk' | 'maxBulk' | 'prior' (no inference). key = the stat the scenario is about. */
  function foeSpec(i, fs, conds, infer, scenario, key, fld) {
    const mon = foeMonOf(i, fs), pri = foePri(i, fs), f = fld || UI.curField || {};
    const inf = scenario === 'prior' ? null : infer;
    const know = { itemKnown: fs.know.itemKnown, item: fs.know.item, abilityKnown: fs.know.abilityKnown, ability: fs.know.ability, map: inf && inf.map ? inf.map : null };
    const b = SimEngine.scenarioBuild(mon.stats, pri, know, scenario === 'prior' ? 'likely' : scenario, key, mon, isChamp());
    if (effMega('foe', i, fs) && mon.abilities[0] && !fs.know.abilityKnown) b.ability = mon.abilities[0].name;
    const spec = {
      label: monDisplayName(mon), types: mon.types, base: mon.stats, level: level(), nature: b.nature, sp: b.sp, ability: b.ability, item: b.item, status: fs.status,
      hpPct: fs.hpPct, boosts: fs.boosts, canEvolve: !mon.isFinalEvolution, weight: mon.weight, tailwind: conds ? conds.tailwind : false,
      weather: f.weather, terrain: f.terrain,
    };
    if (inf && inf.ranges && scenario !== 'prior') {
      const ov = {}; const r = inf.ranges, mid = rg => rg.vals[Math.floor(rg.vals.length / 2)];
      const pick = rg => (scenario === 'minBulk' ? rg.min : scenario === 'maxBulk' || scenario === 'maxOff' ? rg.max : (inf.map ? undefined : mid(rg)));
      for (const k of Object.keys(r)) {
        if (!r[k].vals.length) continue;
        const inBulk = k === 'hp' || k === 'defense' || k === 'special-defense';
        if (scenario === 'minBulk' || scenario === 'maxBulk') { if (inBulk && (k === 'hp' || k === key)) ov[k] = pick(r[k]); }
        else if (scenario === 'maxOff') { if (k === key) ov[k] = pick(r[k]); }
        else { const v = pick(r[k]); if (v !== undefined) ov[k] = v; }
      }
      spec.statOverride = ov;
    }
    return spec;
  }
  function foeEngine(spec) {
    const m = SimEngine.toEngineMon(spec, isChamp());
    if (spec.statOverride) { Object.assign(m.stats, spec.statOverride); m.curHp = clamp(Math.round((spec.hpPct == null ? 100 : spec.hpPct) / 100 * m.stats.hp), 1, m.stats.hp); m.speedFinal = Math.floor(SimEngine.effSpeed(m.stats.speed, (spec.boosts || {}).speed, spec.tailwind, spec.status === 'par' && spec.ability !== 'quick-feet', spec.item === 'choice-scarf') * SimEngine.speedAbilityMult(spec.ability, spec.weather, spec.terrain, spec.status)); }
    return m;
  }

  // ---------- battle state: replay of the log ----------
  function newMine(i) { const slot = S.myTeam[i]; const m = mineEngine(i, null, null); return { hp: m.stats.hp, status: '', boosts: emptyBoosts(), mega: null, active: S.leadsMine.includes(i), fainted: false }; }
  function newFoe() { return { hpPct: 100, status: '', boosts: emptyBoosts(), mega: null, active: false, fainted: false, revealed: [], know: { item: null, itemKnown: false, ability: null, abilityKnown: false } }; }
  const abilityOfActive = (st, side, i) => (side === 'mine' ? mineSpec(i, st.mine[i], null).ability : foeAssumedAbility(i, st.foe[i]));
  function autoField(st, side, i) {
    const ab = abilityOfActive(st, side, i);
    if (WEATHER_SETTERS[ab]) { st.field.weather = WEATHER_SETTERS[ab]; delete st.timers['f:weather']; }
    if (TERRAIN_SETTERS[ab]) { st.field.terrain = TERRAIN_SETTERS[ab]; delete st.timers['f:terrain']; }
  }
  // Intimidate: -1 Attack to every active opponent that doesn't have a blocking ability.
  const INTIMIDATE_BLOCKERS = new Set(['clear-body', 'white-smoke', 'hyper-cutter', 'inner-focus', 'oblivious', 'own-tempo', 'scrappy', 'full-metal-body', 'mirror-armor', 'guard-dog']);
  function autoIntimidate(st, side, i) {
    if (abilityOfActive(st, side, i) !== 'intimidate') return;
    const opp = side === 'mine' ? 'foe' : 'mine', list = opp === 'mine' ? st.mine : st.foe;
    list.forEach((p, k) => {
      if (!p.active || p.fainted || (opp === 'foe' && !S.foe[k].name)) return;
      if (INTIMIDATE_BLOCKERS.has(abilityOfActive(st, opp, k))) return;
      p.boosts.attack = clamp((p.boosts.attack || 0) - 1, -6, 6);
    });
  }

  // ----- field changes with durations -----
  function setTimer(st, id, left, label, clear) { if (left) st.timers[id] = { left, label, clear }; else delete st.timers[id]; }
  function setFieldValue(st, key, value, turns, label) {
    st.field[key] = value;
    setTimer(st, 'f:' + key, value ? turns : 0, label, { kind: 'field', key, off: key === 'weather' || key === 'terrain' ? '' : false });
  }
  function setCondValue(st, side, key, value, turns, label) {
    st.side[side].conds[key] = value;
    setTimer(st, `c:${side}:${key}`, value ? turns : 0, label, { kind: 'cond', side, key, off: key === 'spikes' ? 0 : false });
  }
  function tickTimers(st) {
    for (const id of Object.keys(st.timers)) {
      const t = st.timers[id]; t.left--;
      if (t.left > 0) continue;
      if (t.clear.kind === 'field') st.field[t.clear.key] = t.clear.off; else st.side[t.clear.side].conds[t.clear.key] = t.clear.off;
      delete st.timers[id];
    }
  }
  /** What a logged move does to the field / the Pokémon involved. */
  function applyMoveEffects(st, ev) {
    const slug = ev.move, me = ev.actor.s, opp = me === 'mine' ? 'foe' : 'mine';
    const who = me === 'mine' ? 'your side' : 'their side', whoOpp = me === 'mine' ? 'their side' : 'your side';
    if (WEATHER_MOVES[slug]) setFieldValue(st, 'weather', WEATHER_MOVES[slug], 5, `${formatName(WEATHER_MOVES[slug])} weather`);
    else if (TERRAIN_MOVES[slug]) setFieldValue(st, 'terrain', TERRAIN_MOVES[slug], 5, `${formatName(TERRAIN_MOVES[slug])} Terrain`);
    else if (ROOM_MOVES[slug]) { const k = ROOM_MOVES[slug]; setFieldValue(st, k, k === 'trickRoom' && st.field.trickRoom ? false : true, 5, formatName(slug)); }
    else if (SIDE_MOVES[slug]) {
      const [cond, whose, turns] = SIDE_MOVES[slug]; const side = whose === 'self' ? me : opp;
      setCondValue(st, side, cond, true, turns, `${formatName(slug)} (${whose === 'self' ? who : whoOpp})`);
    } else if (slug === 'spikes') setCondValue(st, opp, 'spikes', Math.min(3, (st.side[opp].conds.spikes || 0) + 1), 0, '');
    else if (slug === 'defog') {
      for (const k of ['reflect', 'lightScreen', 'auroraVeil']) setCondValue(st, opp, k, false, 0, '');
      for (const side of ['mine', 'foe']) { setCondValue(st, side, 'stealthRock', false, 0, ''); setCondValue(st, side, 'spikes', 0, 0, ''); }
    } else if (CLEARS_OWN_HAZARDS.has(slug)) { setCondValue(st, me, 'stealthRock', false, 0, ''); setCondValue(st, me, 'spikes', 0, 0, ''); }

    const fx = MOVE_EFFECTS[slug];
    const part = (s, i) => (s === 'mine' ? st.mine[i] : st.foe[i]);
    const bump = (p, changes) => { if (p) for (const [k, v] of Object.entries(changes)) p.boosts[k] = clamp((p.boosts[k] || 0) + v, -6, 6); };
    if (fx && fx.self) {
      const actor = part(me, ev.actor.i);
      if (slug === 'belly-drum') actor.boosts.attack = 6; else bump(actor, fx.self);
    }
    for (const tr of ev.targets) {
      if (tr.immune || (tr.s === me && tr.i === ev.actor.i)) continue;
      const p = part(tr.s, tr.i); if (!p || p.fainted) continue;
      if (fx && fx.target && tr.s !== me) bump(p, fx.target);
      if (fx && fx.status && tr.s !== me && !p.status) p.status = fx.status;
      if (BREAKS_SCREENS.has(slug) && tr.s !== me && tr.lost > 0) for (const k of ['reflect', 'lightScreen', 'auroraVeil']) setCondValue(st, tr.s, k, false, 0, '');
    }
  }
  function initialState() {
    const st = { turn: 1, field: { weather: '', terrain: '', trickRoom: false, gravity: false, magicRoom: false, wonderRoom: false }, side: { mine: { conds: emptyConds() }, foe: { conds: emptyConds() } }, mine: [], foe: [], timers: {} };
    S.myTeam.forEach((_, i) => st.mine.push(newMine(i)));
    S.foe.forEach((f, i) => { const fs = newFoe(); fs.active = S.leadsFoe.includes(i); st.foe.push(fs); });
    S.leadsMine.forEach(i => autoField(st, 'mine', i));
    S.leadsFoe.forEach(i => { if (S.foe[i].name) autoField(st, 'foe', i); });
    S.leadsMine.forEach(i => autoIntimidate(st, 'mine', i));
    S.leadsFoe.forEach(i => { if (S.foe[i].name) autoIntimidate(st, 'foe', i); });
    return st;
  }
  function maxHpOf(i, st) { return mineEngine(i, st.mine[i], null).stats.hp; }
  function applyEvent(st, ev) {
    const part = (s, i) => (s === 'mine' ? st.mine[i] : st.foe[i]);
    switch (ev.t) {
      case 'turn': st.turn++; tickTimers(st); break;
      case 'move': {
        if (ev.actor.s === 'foe' && ev.move && !st.foe[ev.actor.i].revealed.includes(ev.move)) st.foe[ev.actor.i].revealed.push(ev.move);
        for (const tr of ev.targets) {
          const p = part(tr.s, tr.i); if (!p || tr.immune) continue;
          if (tr.s === 'mine') {
            p.hp = tr.fainted ? 0 : clamp(p.hp - (tr.lost || 0), 0, maxHpOf(tr.i, st));
          } else p.hpPct = tr.fainted ? 0 : clamp(p.hpPct - (tr.lost || 0), 0, 100);
          if (tr.fainted || (tr.s === 'mine' ? p.hp <= 0 : p.hpPct <= 0)) { p.fainted = true; p.active = false; }
        }
        if (!ev.missed) applyMoveEffects(st, ev);
        break;
      }
      case 'set': {
        const p = ev.side ? part(ev.side, ev.i) : null;
        if (ev.what === 'hp') { if (ev.side === 'mine') { p.hp = clamp(ev.value, 0, maxHpOf(ev.i, st)); } else p.hpPct = clamp(ev.value, 0, 100); p.fainted = (ev.side === 'mine' ? p.hp : p.hpPct) <= 0; if (p.fainted) p.active = false; }
        else if (ev.what === 'status') p.status = ev.value;
        else if (ev.what === 'boost') p.boosts[ev.key] = clamp(ev.value, -6, 6);
        else if (ev.what === 'mega') { p.mega = ev.value === undefined ? null : ev.value; }
        else if (ev.what === 'field') { st.field[ev.key] = ev.value; delete st.timers['f:' + ev.key]; }
        else if (ev.what === 'cond') { st.side[ev.side].conds[ev.key] = ev.value; delete st.timers[`c:${ev.side}:${ev.key}`]; }
        else if (ev.what === 'revive') { p.fainted = false; }
        break;
      }
      case 'know': { const k = st.foe[ev.i].know; if (ev.what === 'item') { k.item = ev.value; k.itemKnown = ev.value !== undefined && ev.locked !== false; } else { k.ability = ev.value; k.abilityKnown = ev.locked !== false; } break; }
      case 'switch': {
        const side = ev.side, out = part(side, ev.out), inn = part(side, ev.in);
        if (out) { out.active = false; out.boosts = emptyBoosts(); }
        if (inn) { inn.active = true; inn.fainted = false; }
        autoField(st, side, ev.in);
        autoIntimidate(st, side, ev.in);
        break;
      }
      default: break;
    }
  }
  function replay() {
    const st = initialState();
    for (const ev of S.log) applyEvent(st, ev);
    UI.curField = st.field;
    return st;
  }
  function pushEvent(ev) { S.log.push(ev); UI.inferCache = null; save(); }

  // ---------- observations & inference ----------
  function buildObs(st) {
    const byFoe = new Map();
    const add = (i, o) => { if (!byFoe.has(i)) byFoe.set(i, []); byFoe.get(i).push(o); };
    const moves = S.log.filter(e => e.t === 'move');
    moves.forEach(ev => {
      if (!ev.snap || ev.missed) return;
      const info = moveDetails.get(ev.move) || {};
      const nDmgTargets = ev.targets.filter(t => t.lost != null).length;
      const mv = engMove(ev.move, { crit: ev.crit, hits: ev.hits || undefined, target: nDmgTargets >= 2 ? undefined : 'selected-pokemon' });
      if (mv.category === 'status') return;
      ev.targets.forEach((tr, k) => {
        if (!ev.snap.targets[k]) return;
        const t0 = ev.snap.targets[k];
        // "It had no effect" on a Pokémon that this type should normally hit: only an ability (Levitate, Flash Fire, ...) explains it.
        if (tr.immune && ev.actor.s === 'mine' && tr.s === 'foe') {
          const fs = st.foe[tr.i];
          const attacker = mineEngine(ev.actor.i, ev.snap.actor, ev.snap.conds.mine, ev.snap.field);
          const defender = foeEngine(foeSpec(tr.i, Object.assign({}, fs, { mega: t0.mega, status: t0.status, boosts: t0.boosts, hpPct: t0.hpPct }), ev.snap.conds.foe, null, 'prior', 'defense', ev.snap.field));
          const field = engineFieldFromSnap(ev.snap, 'mine');
          const byTypeAlone = CalcEngine.calc(attacker, Object.assign({}, defender, { ability: null }), mv, field);
          if (!byTypeAlone.immune) add(tr.i, { kind: 'immune', form: effMega('foe', tr.i, Object.assign({}, fs, { mega: t0.mega })) || S.foe[tr.i].name, attacker, defender, move: mv, field });
          return;
        }
        if (tr.lost == null || tr.lost <= 0) return;
        if (ev.actor.s === 'foe' && tr.s === 'mine') {
          const fs = st.foe[ev.actor.i];
          if (!foeMonOf(ev.actor.i, { mega: ev.snap.actor.mega })) return;
          const attacker = foeEngine(foeSpec(ev.actor.i, Object.assign({}, fs, { mega: ev.snap.actor.mega, status: ev.snap.actor.status, boosts: ev.snap.actor.boosts, hpPct: ev.snap.actor.hpPct }), ev.snap.conds.foe, null, 'prior', 'attack', ev.snap.field));
          const defender = mineEngine(tr.i, t0, ev.snap.conds.mine, ev.snap.field);
          add(ev.actor.i, { kind: 'offense', form: effMega('foe', ev.actor.i, Object.assign({}, fs, { mega: ev.snap.actor.mega })) || S.foe[ev.actor.i].name, attacker, defender, move: mv, field: Object.assign(engineFieldFromSnap(ev.snap, 'foe'), {}), dmg: tr.lost, ko: !!tr.fainted, remaining: t0.hp });
        } else if (ev.actor.s === 'mine' && tr.s === 'foe') {
          const fs = st.foe[tr.i];
          const attacker = mineEngine(ev.actor.i, ev.snap.actor, ev.snap.conds.mine, ev.snap.field);
          const defender = foeEngine(foeSpec(tr.i, Object.assign({}, fs, { mega: t0.mega, status: t0.status, boosts: t0.boosts, hpPct: t0.hpPct }), ev.snap.conds.foe, null, 'prior', 'defense', ev.snap.field));
          add(tr.i, { kind: 'bulk', form: effMega('foe', tr.i, Object.assign({}, fs, { mega: t0.mega })) || S.foe[tr.i].name, attacker, defender, move: mv, field: engineFieldFromSnap(ev.snap, 'mine'), dropPct: tr.lost, beforePct: t0.hpPct, ko: !!tr.fainted });
        }
      });
    });
    // turn-order observations
    for (let k = 0; k + 1 < moves.length; k++) {
      const a = moves[k], b = moves[k + 1];
      if (a.turn !== b.turn || a.actor.s === b.actor.s || !a.snap || !b.snap) continue;
      const pa = (moveDetails.get(a.move) || {}).priority || 0, pb = (moveDetails.get(b.move) || {}).priority || 0;
      if (pa !== pb) continue;
      const foeEv = a.actor.s === 'foe' ? a : b, mineEv = a.actor.s === 'mine' ? a : b;
      const mySpeed = mineEngine(mineEv.actor.i, mineEv.snap.actor, mineEv.snap.conds.mine, mineEv.snap.field).speedFinal;
      add(foeEv.actor.i, { kind: 'order', form: effMega('foe', foeEv.actor.i, Object.assign({}, st.foe[foeEv.actor.i], { mega: foeEv.snap.actor.mega })) || S.foe[foeEv.actor.i].name, mySpeed, foeFirst: a.actor.s === 'foe', trickRoom: !!a.snap.field.trickRoom,
        foeBoost: foeEv.snap.actor.boosts.speed || 0, foeTailwind: !!foeEv.snap.conds.foe.tailwind, foePar: foeEv.snap.actor.status === 'par',
        foeStatus: foeEv.snap.actor.status, weather: a.snap.field.weather, terrain: a.snap.field.terrain });
    }
    return byFoe;
  }
  function engineFieldFromSnap(snap, attackerSide) {
    const other = attackerSide === 'mine' ? 'foe' : 'mine';
    return { format: S.format === 'singles' ? 'singles' : 'doubles', weather: snap.field.weather, terrain: snap.field.terrain, gravity: snap.field.gravity, magicRoom: snap.field.magicRoom, wonderRoom: snap.field.wonderRoom,
      gen: gameGen(), attackerSide: snap.conds[attackerSide], defenderSide: snap.conds[other], fast: true };
  }
  function inferAll(st) {
    if (UI.inferCache && UI.inferCache.len === S.log.length) return UI.inferCache.res;
    const res = {}; const t0 = performance.now();
    let obsMap;
    try { obsMap = buildObs(st); } catch (e) { console.error('observation build failed', e); obsMap = new Map(); }
    for (const [i, list] of obsMap) {
      const fs = st.foe[i], mon = foeMonOf(i, fs); if (!mon) continue;
      const current = effMega('foe', i, fs) || S.foe[i].name;
      const usable = list.filter(o => o.form === current);
      if (!usable.length) continue;
      try {
        const know = { itemKnown: fs.know.itemKnown, item: fs.know.item, abilityKnown: fs.know.abilityKnown, ability: fs.know.ability };
        const pri = foePri(i, fs);
        res[i] = SimEngine.inferFoe({ base: mon.stats, canEvolve: !mon.isFinalEvolution }, usable, { champ: isChamp(), level: level(), pri, know,
          abilities: SimEngine.abilityCandidates(mon, pri, know) });
      } catch (e) { console.error('inference failed', e); }
    }
    UI.inferCache = { len: S.log.length, res, ms: Math.round(performance.now() - t0) };
    return res;
  }

  // ---------- matchup matrix (team preview) ----------
  function computeMatrix() {
    const key = [S.game, S.format, S.teamId, S.foe.map(f => f.name).join(','), S.myTeam.length].join('|');
    if (UI.matrix && UI.matrixKey === key) return UI.matrix;
    const st0 = { field: { weather: '', terrain: '', gravity: false, magicRoom: false, wonderRoom: false }, side: { mine: { conds: emptyConds() }, foe: { conds: emptyConds() } } };
    const field = Object.assign(engineField(st0, 'mine', true));
    const cells = S.myTeam.map((slot, i) => {
      const mineM = mineEngine(i, null, null);
      const mineMoves = (slot.moves || []).filter(Boolean).map(s => ({ slug: s, engine: engMove(s) })).filter(m => m.engine.category !== 'status');
      return S.foe.map((f, j) => {
        if (!f.name) return null;
        const fs = newFoe(), mon = foeMonOf(j, fs); if (!mon) return null;
        const foeM = foeEngine(foeSpec(j, fs, null, null, 'prior', 'attack'));
        const fm = SimEngine.foeMoveList(mon, foePri(j, fs), [], 6).map(m => ({ slug: m.slug, engine: engMove(m.slug) }));
        const r = SimEngine.matchup(mineM, mineMoves, foeM, fm, field);
        return r;
      });
    });
    UI.matrix = cells; UI.matrixKey = key;
    return cells;
  }

  // ---------- rendering ----------
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const tbadge = t => `<span class="tbadge" style="background:${typeColor(t)}">${esc(formatName(t))}</span>`;
  const sprite = (mon, cls) => (mon ? `<img class="${cls || 'sm-sprite'}" src="${spriteUrl(mon.spriteId || mon.id)}" alt="" onerror="this.onerror=null;this.src='${spriteFallbackUrl(mon.spriteId || mon.id)}';this.onerror=function(){this.src='${PLACEHOLDER_SPRITE}'};">` : '');
  const fmtPct = n => (Math.round(n * 10) / 10);

  function render() {
    if (!root) return;
    root.querySelector('#sim-steps').innerHTML = [['setup', '1 · Setup'], ['matchups', '2 · Matchups'], ['battle', '3 · Battle']].map(([k, l]) => `<button type="button" class="${S.phase === k ? 'active' : ''}" data-act="phase" data-phase="${k}">${l}</button>`).join('');
    root.querySelector('#sim-format').innerHTML = [['doubles', isChamp() ? 'VGC (Doubles)' : 'Doubles'], ['singles', 'Singles']].map(([k, l]) => `<button type="button" class="${S.format === k ? 'active' : ''}" data-act="format" data-format="${k}">${l}</button>`).join('');
    const body = root.querySelector('#sim-body');
    if (sim.loading) { body.innerHTML = '<div class="sm-empty">Loading Pokémon data…</div>'; return; }
    if (sim.error) { body.innerHTML = `<div class="sm-empty">Couldn't load Pokémon data: ${esc(sim.error)}<br><button type="button" class="reset-btn" data-act="retry">Retry</button></div>`; return; }
    try {
      if (S.phase === 'setup') body.innerHTML = setupHtml();
      else if (S.phase === 'matchups') body.innerHTML = matchupsHtml();
      else body.innerHTML = battleHtml();
    } catch (e) { console.error(e); body.innerHTML = `<div class="sm-empty">Something went wrong drawing this screen (${esc(e.message)}).<br><button type="button" class="reset-btn" data-act="phase" data-phase="setup">Back to setup</button></div>`; }
  }

  // ----- setup -----
  function setupHtml() {
    const teamOpts = (typeof teams !== 'undefined' ? teams : []).map(t => {
      const g = GAMES.find(x => x.vg === t.game);
      return opt(t.id, `${t.name} — ${t.game === CHAMPIONS_VG ? 'Champions' : (g ? g.label : t.game)}`, t.id === S.teamId);
    }).join('');
    const mineCards = S.myTeam.length ? S.myTeam.map(sl => {
      const mon = rosterMon(sl.pokemonName);
      return `<div class="sm-mini">${sprite(mon)}<div><b>${esc(sl.nickname || sl.displayName)}</b><div class="sm-dim">${esc(sl.item ? formatName(sl.item) : 'no item')} · ${(sl.moves || []).filter(Boolean).map(formatName).join(', ') || 'no moves'}</div></div></div>`;
    }).join('') : `<div class="sm-dim">${(typeof teams !== 'undefined' ? teams : []).length ? 'Choose one of your saved teams.' : 'No saved teams yet — build one in the Team Builder first.'}</div>`;
    const foeRows = S.foe.map((f, i) => {
      const mon = rosterMon(f.name);
      return `<div class="sm-foe-row">${sprite(mon, 'sm-sprite-s')}<div class="calc-picker"><input type="text" data-picker="foe" data-i="${i}" placeholder="Opponent Pokémon ${i + 1}…" value="${esc(mon ? monDisplayName(mon) : '')}" autocomplete="off"><div class="option-dropdown"></div></div>${mon ? `<span class="sm-types">${mon.types.map(tbadge).join('')}</span>` : ''}</div>`;
    }).join('');
    const ready = S.myTeam.length && S.foe.filter(f => f.name).length;
    return `<div class="sm-setup">
      <section class="sm-card side-a"><h3>Your team</h3>
        <select data-f="team"><option value="">Choose a saved team…</option>${teamOpts}</select>
        <div class="sm-mini-list">${mineCards}</div></section>
      <section class="sm-card side-b"><h3>Opponent's team</h3>
        <div class="sm-foe-list">${foeRows}</div>
        <details class="sm-paste"><summary>Paste the opponent's team instead</summary>
          <textarea id="sim-paste" placeholder="One Pokémon per line, or a full Pokepaste export…"></textarea>
          <button type="button" class="reset-btn" data-act="fill-paste">Fill from paste</button></details>
        <div class="sm-dim" id="sim-msg">${esc(UI.msg)}</div></section>
      <div class="sm-setup-foot"><button type="button" class="sm-go" data-act="phase" data-phase="matchups"${ready ? '' : ' disabled'}>Analyze matchups →</button>
        <span class="sm-dim">${isChamp() ? 'Opponent sets come from real Champions usage data.' : 'No usage data outside Champions — opponents are assumed to be uninvested, with worst-case ranges shown.'}</span></div>
    </div>`;
  }

  // ----- matchups -----
  function scoreColor(score) {
    const t = (clamp(score, -1, 1) + 1) / 2;
    const r = Math.round(200 - 150 * t), g = Math.round(70 + 120 * t), b = 80;
    return `rgba(${r},${g},${b},.55)`;
  }
  function matchupsHtml() {
    if (!S.myTeam.length || !S.foe.some(f => f.name)) return `<div class="sm-empty">Add your team and the opponent's Pokémon first.<br><button type="button" class="reset-btn" data-act="phase" data-phase="setup">Go to setup</button></div>`;
    const M = computeMatrix();
    const head = S.foe.map(f => { const mon = rosterMon(f.name); return `<th>${mon ? sprite(mon, 'sm-sprite-s') + `<div>${esc(monDisplayName(mon))}</div>` : ''}</th>`; }).join('');
    const rowAvg = M.map(row => { const v = row.filter(Boolean).map(c => c.score); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
    const colAvg = S.foe.map((_, j) => { const v = M.map(r => r[j]).filter(Boolean).map(c => c.score); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
    const rows = S.myTeam.map((slot, i) => {
      const mon = rosterMon(slot.pokemonName);
      const role = S.leadsMine.includes(i) ? 'front' : S.backMine.includes(i) ? 'back' : '';
      const cells = M[i].map((c, j) => {
        if (!c) return '<td class="sm-cell none">—</td>';
        const m = c.mine.best, f = c.foe.best;
        const sel = UI.cell && UI.cell.i === i && UI.cell.j === j ? ' sel' : '';
        return `<td class="sm-cell${sel}" data-act="cell" data-i="${i}" data-j="${j}" style="background:${scoreColor(c.score)}" title="${esc(c.label)}">
          <div class="sm-cell-main">${c.score > 0.05 ? '+' : ''}${Math.round(c.score * 100)}</div>
          <div class="sm-cell-sub">${m ? Math.round(m.avg) : 0}% / ${f ? Math.round(f.avg) : 0}%</div>
          <div class="sm-cell-spd">${c.speed > 0 ? 'faster' : c.speed < 0 ? 'slower' : 'tie'}</div></td>`;
      }).join('');
      return `<tr><th class="sm-rowhead ${role}" data-act="role" data-i="${i}" title="Click to set Front / Back / Bench">${sprite(mon, 'sm-sprite-s')}<div><b>${esc(slot.nickname || monDisplayName(mon))}</b><div class="sm-dim">${role ? role.toUpperCase() : 'bench'}</div></div></th>${cells}
        <td class="sm-total"><div class="sm-bar"><i style="width:${Math.round((rowAvg[i] + 1) / 2 * 100)}%;background:${scoreColor(rowAvg[i])}"></i></div><span>${rowAvg[i] > 0 ? '+' : ''}${Math.round(rowAvg[i] * 100)}</span></td></tr>`;
    }).join('');
    const foot = `<tr class="sm-colfoot"><th>Threat to you</th>${colAvg.map(v => `<td><div class="sm-bar"><i style="width:${Math.round((-v + 1) / 2 * 100)}%;background:${scoreColor(-v)}"></i></div></td>`).join('')}<td></td></tr>`;
    const ranked = S.myTeam.map((s, i) => ({ i, v: rowAvg[i] })).sort((a, b) => b.v - a.v);
    const threats = S.foe.map((f, j) => ({ j, v: colAvg[j] })).filter(x => S.foe[x.j].name).sort((a, b) => a.v - b.v);
    const detail = UI.cell ? cellDetailHtml(M[UI.cell.i][UI.cell.j], UI.cell.i, UI.cell.j) : '<div class="sm-dim">Click a cell for the full breakdown.</div>';
    return `<div class="sm-matchups">
      <div class="sm-matrix-wrap"><table class="sm-matrix"><thead><tr><th></th>${head}<th>Overall</th></tr></thead><tbody>${rows}${foot}</tbody></table>
        <div class="sm-legend">Each cell: score (−100…+100), then <b>your best move % / their best move %</b> on the other, and who outspeeds. Green favors you.</div></div>
      <div class="sm-side">
        <section class="sm-card"><h3>Best picks into this team</h3>${ranked.slice(0, 4).map((x, n) => `<div class="sm-rank"><span>${n + 1}</span>${sprite(rosterMon(S.myTeam[x.i].pokemonName), 'sm-sprite-s')}<b>${esc(S.myTeam[x.i].nickname || S.myTeam[x.i].displayName)}</b><em>${x.v > 0 ? '+' : ''}${Math.round(x.v * 100)}</em></div>`).join('')}</section>
        <section class="sm-card"><h3>Biggest threats</h3>${threats.slice(0, 3).map(x => `<div class="sm-rank">${sprite(rosterMon(S.foe[x.j].name), 'sm-sprite-s')}<b>${esc(monDisplayName(rosterMon(S.foe[x.j].name)))}</b><em>${Math.round(-x.v * 100)}</em></div>`).join('')}</section>
        <section class="sm-card"><h3>Pick your four</h3>
          <div class="sm-dim">Click a row name to cycle Front → Back → Bench (${nActive()} front, up to ${S.format === 'singles' ? 2 : 2} back).</div>
          <h4>Opponent's leads</h4>
          <div class="sm-chips">${S.foe.map((f, j) => (f.name ? `<button type="button" class="sm-chip${S.leadsFoe.includes(j) ? ' on' : ''}" data-act="foe-lead" data-j="${j}">${esc(monDisplayName(rosterMon(f.name)))}</button>` : '')).join('')}</div>
          <button type="button" class="sm-go" data-act="start"${S.leadsMine.length ? '' : ' disabled'}>Start battle →</button></section>
      </div>
      <section class="sm-card sm-detail">${detail}</section></div>`;
  }
  function cellDetailHtml(c, i, j) {
    if (!c) return '';
    const slot = S.myTeam[i], fmon = rosterMon(S.foe[j].name);
    const line = (r, who) => `<div class="sm-dline"><span class="mvchip" style="background:${typeColor(r.move.engine.type)}">${esc(formatName(r.move.slug))}</span><b>${fmtPct(r.pctMin)}–${fmtPct(r.pctMax)}%</b><span class="sm-dim">${r.immune ? 'no effect' : r.hits <= 1 ? 'OHKO' : r.hits + 'HKO'}</span></div>`;
    return `<h3>${esc(slot.nickname || slot.displayName)} vs ${esc(monDisplayName(fmon))} <span class="sm-verdict">${esc(c.label)}</span></h3>
      <div class="sm-two"><div><h4>Your moves</h4>${c.mine.all.map(r => line(r)).join('') || '<div class="sm-dim">No damaging moves.</div>'}</div>
      <div><h4>Their likely moves</h4>${c.foe.all.map(r => line(r)).join('') || '<div class="sm-dim">No data.</div>'}</div></div>
      <div class="sm-dim">Speed: yours ${c.mineSpeed} vs theirs ~${c.foeSpeed} (${c.speed > 0 ? 'you outspeed' : c.speed < 0 ? 'they outspeed' : 'speed tie'}). Their stats use the most common spread and item from usage data.</div>`;
  }

  // ----- battle -----
  function koBadge(res, remPct) {
    if (!res || res.immune) return { t: 'no effect', cls: 'none' };
    if (res.noDamage) return { t: '—', cls: 'none' };
    if (res.pctMin >= remPct) return { t: 'KO', cls: 'ko1' };
    if (res.pctMax >= remPct) return { t: 'KO chance', cls: 'ko1p' };
    const h = Math.ceil(remPct / Math.max(0.1, res.avg));
    return { t: h + 'HKO', cls: h <= 2 ? 'ko2' : 'none' };
  }
  const hpPctOfMine = (i, st) => { const m = mineEngine(i, st.mine[i], null); return st.mine[i].hp / m.stats.hp * 100; };

  function battleHtml() {
    const st = replay(), infer = inferAll(st);
    const actM = S.myTeam.map((_, i) => i).filter(i => st.mine[i].active);
    const actF = S.foe.map((_, i) => i).filter(i => st.foe[i].active && S.foe[i].name);
    const mineCards = actM.map(i => mineCardHtml(i, st, infer, actF)).join('') || '<div class="sm-dim sm-pad">No active Pokémon. Use the bench below to send one in.</div>';
    const foeCards = actF.map(j => foeCardHtml(j, st, infer, actM)).join('') || '<div class="sm-dim sm-pad">Pick which opponent Pokémon are out from their bench below.</div>';
    const benchM = S.myTeam.map((_, i) => i).filter(i => !st.mine[i].active && (S.leadsMine.includes(i) || S.backMine.includes(i))).map(i => benchChip('mine', i, st)).join('');
    const benchF = S.foe.map((f, j) => j).filter(j => S.foe[j].name && !st.foe[j].active).map(j => benchChip('foe', j, st)).join('');
    return `<div class="sm-battle">
      <div class="sm-col side-a"><h3 class="sm-coltitle">Your side</h3>${mineCards}<div class="sm-bench">${benchM}</div></div>
      <div class="sm-center">${centerHtml(st, actM, actF)}${speedLadderHtml(st, infer, actM, actF)}</div>
      <div class="sm-col side-b"><h3 class="sm-coltitle">Opponent</h3>${foeCards}<div class="sm-bench">${benchF}</div></div></div>`;
  }
  function benchChip(side, i, st) {
    const mon = side === 'mine' ? rosterMon(S.myTeam[i].pokemonName) : rosterMon(S.foe[i].name);
    const p = side === 'mine' ? st.mine[i] : st.foe[i];
    const hp = side === 'mine' ? Math.round(hpPctOfMine(i, st)) : Math.round(p.hpPct);
    const activeCount = (side === 'mine' ? st.mine : st.foe).filter((x, k) => x.active && (side === 'mine' || S.foe[k].name)).length;
    return `<button type="button" class="sm-bench-chip${p.fainted ? ' fainted' : ''}" data-act="sendout" data-side="${side}" data-i="${i}" title="${p.fainted ? 'Fainted' : activeCount >= nActive() ? 'Switch in (choose who leaves)' : 'Send out'}">${sprite(mon, 'sm-sprite-s')}<span>${esc(side === 'mine' ? (S.myTeam[i].nickname || monDisplayName(mon)) : monDisplayName(mon))}</span><i>${p.fainted ? 'KO' : hp + '%'}</i></button>`;
  }

  function stagesHtml(side, i, boosts) {
    return BOOST_KEYS.map(k => { const v = boosts[k] || 0; return v ? `<span class="sm-stage ${v > 0 ? 'up' : 'down'}">${STAT_LABELS[k]} ${v > 0 ? '+' : ''}${v}</span>` : ''; }).join('');
  }
  const statusChip = s => (s ? `<span class="sm-stage down">${esc(STATUS_OPTS.find(o => o[0] === s)[1])}</span>` : '');

  function mineCardHtml(i, st, infer, actF) {
    const slot = S.myTeam[i], ms = st.mine[i], mon = mineMonOf(i, ms), m = mineEngine(i, ms, st.side.mine.conds);
    const pct = ms.hp / m.stats.hp * 100;
    const editing = UI.edit && UI.edit.side === 'mine' && UI.edit.i === i;
    const moveRows = (slot.moves || []).filter(Boolean).map(slug => {
      const em = engMove(slug); if (em.category === 'status') return `<div class="sm-move"><span class="mvchip" style="background:${typeColor(em.type)}">${esc(formatName(slug))}</span><span class="sm-dim">status</span></div>`;
      const cols = actF.map(j => {
        const fs = st.foe[j], key = em.category === 'physical' ? 'defense' : 'special-defense';
        const likely = SimEngine.moveResult(m, foeEngine(foeSpec(j, fs, st.side.foe.conds, infer[j], 'likely', key)), em, engineField(st, 'mine'));
        const lo = SimEngine.moveResult(m, foeEngine(foeSpec(j, fs, st.side.foe.conds, infer[j], 'minBulk', key)), em, engineField(st, 'mine', true));
        const hi = SimEngine.moveResult(m, foeEngine(foeSpec(j, fs, st.side.foe.conds, infer[j], 'maxBulk', key)), em, engineField(st, 'mine', true));
        const b = koBadge(likely, fs.hpPct);
        const tgt = monDisplayName(foeMonOf(j, fs));
        // if one of their possible abilities would make this move do nothing (Levitate vs Ground, Flash Fire vs Fire, ...), say so
        const risks = fs.know.abilityKnown ? [] : SimEngine.immunityRisks(foeAbilityOdds(j, fs, infer[j]), em.type);
        const riskTxt = risks.length ? `<small class="sm-risk" title="Possible ability that would make this move do nothing">immune if ${risks.map(r => `${esc(formatName(r.slug))} ${Math.round(r.p * 100)}%`).join(' / ')}</small>` : '';
        return `<span class="sm-res" title="vs ${esc(tgt)}: likely ${fmtPct(likely.pctMin)}–${fmtPct(likely.pctMax)}%, no investment up to ${fmtPct(lo.pctMax)}%, max bulk down to ${fmtPct(hi.pctMin)}%"><em class="sm-tg tf">${esc(tgt)}</em><b>${fmtPct(likely.pctMin)}–${fmtPct(likely.pctMax)}%</b><i class="${b.cls}">${b.t}</i><small>${fmtPct(hi.pctMin)}–${fmtPct(lo.pctMax)}%</small>${riskTxt}</span>`;
      }).join('');
      return `<div class="sm-move"><span class="mvchip" style="background:${typeColor(em.type)}">${esc(formatName(slug))}</span>${cols || '<span class="sm-dim">no target</span>'}</div>`;
    }).join('');
    const stone = (() => { const it = slot.item ? itemsForGame(S.game).find(x => x.slug === slot.item) : null; const base = it ? megaStoneBaseSlug(it) : null; return base && base === slot.pokemonName ? findMegaVariant(base, it.name, sim.roster) : null; })();
    return `<div class="sm-mon side-a${ms.fainted ? ' fainted' : ''}">
      <div class="sm-mon-head" data-act="actor" data-side="mine" data-i="${i}" title="Click to log this Pokémon's move">${sprite(mon, 'sm-sprite-l')}
        <div><b>${esc(slot.nickname || monDisplayName(mon))}</b><div class="sm-types">${mon.types.map(tbadge).join('')}</div>
        <div class="sm-dim">${esc(formatName(m.ability || '—'))} · ${esc(slot.item ? formatName(slot.item) : 'no item')}</div></div></div>
      <div class="sm-hp"><div class="hp-track"><div class="hp-fill ${pct <= 20 ? 'low' : pct <= 50 ? 'mid' : 'ok'}" style="width:${pct}%"></div></div><span>${ms.hp} / ${m.stats.hp} HP (${Math.round(pct)}%)</span></div>
      <div class="sm-stagerow">${stagesHtml('mine', i, ms.boosts)}${statusChip(ms.status)}${effMega('mine', i, ms) ? `<span class="sm-stage up">${ms.mega ? 'Mega' : 'Mega (assumed)'}</span>` : ''}<span class="sm-dim">Spe ${m.speedFinal}</span></div>
      <div class="sm-moves"><div class="sm-dim">Your moves — damage to each opposing Pokémon <small>(likely · range across possible bulk)</small></div>${moveRows || '<div class="sm-dim">No moves on this set.</div>'}</div>
      <button type="button" class="sm-linkbtn" data-act="edit" data-side="mine" data-i="${i}">${editing ? 'Close overrides' : 'Override…'}</button>${editing ? overrideHtml('mine', i, st, stone) : ''}</div>`;
  }

  /** Odds for each ability a foe could have: narrowed by what's been logged if anything was, otherwise from usage data. */
  function foeAbilityOdds(j, fs, inf) {
    const mon = foeMonOf(j, fs), pri = foePri(j, fs);
    const know = { abilityKnown: fs.know.abilityKnown, ability: fs.know.ability };
    if (!fs.know.abilityKnown && inf && inf.abilities && inf.abilities.length && inf.abilities.every(a => a.slug)) return inf.abilities;
    return SimEngine.abilityCandidates(mon, pri, know);
  }

  function foeCardHtml(j, st, infer, actM) {
    const fs = st.foe[j], mon = foeMonOf(j, fs), pri = foePri(j, fs), inf = infer[j];
    const abOdds = foeAbilityOdds(j, fs, inf);
    const abLocked = fs.know.abilityKnown, abNarrowed = !!(inf && inf.abilities && inf.abilities.length && inf.n);
    const abTop = abOdds[0];
    const ab = abLocked ? fs.know.ability : (abOdds.length === 1 || (abTop && abTop.p >= 0.6) ? abTop.slug : null);
    const abChips = abOdds.length > 1 || abLocked ? abOdds.map(a => {
      const info = abilityDetails.get(a.slug) || CHAMPIONS_ABILITY_OVERRIDES[a.slug] || {};
      return `<button type="button" class="sm-chip${abLocked && fs.know.ability === a.slug ? ' on' : ''}" data-act="lock-ability" data-i="${j}" data-ab="${esc(a.slug)}" title="${esc(info.shortEffect || '')} (click to lock as their ability)">${esc(formatName(a.slug))} <i>${Math.round(a.p * 100)}%</i></button>`;
    }).join('') : '';
    const items = (inf && inf.items && inf.items.length ? inf.items.slice(0, 5).map(x => ({ slug: x.slug, p: x.p, inferred: true })) : (pri ? pri.items.slice().sort((a, b) => b.p - a.p).slice(0, 5) : []));
    const itemChips = items.filter(x => x.slug && (x.p >= 0.01 || (fs.know.itemKnown && fs.know.item === x.slug))).map(x => `<button type="button" class="sm-chip${fs.know.itemKnown && fs.know.item === x.slug ? ' on' : ''}" data-act="lock-item" data-i="${j}" data-item="${esc(x.slug)}" title="Click to lock as their item">${esc(formatName(x.slug))} <i>${Math.round(x.p * 100)}%</i></button>`).join('') +
      `<button type="button" class="sm-chip${fs.know.itemKnown && !fs.know.item ? ' on' : ''}" data-act="lock-item" data-i="${j}" data-item="">none / unknown</button>`;
    const revealed = fs.revealed.map(s => `<span class="mvchip" style="background:${typeColor((moveDetails.get(s) || {}).type)}">${esc(formatName(s))}</span>`).join('');
    const mvList = SimEngine.foeMoveList(mon, pri, fs.revealed, 6);
    const threats = mvList.map(mv => {
      const em = engMove(mv.slug);
      const key = em.category === 'physical' ? 'attack' : 'special-attack';
      const cols = actM.map(i => {
        const ms = st.mine[i], defM = mineEngine(i, ms, st.side.mine.conds);
        const likelyM = foeEngine(foeSpec(j, fs, st.side.foe.conds, inf, 'likely', key));
        const worstM = foeEngine(foeSpec(j, fs, st.side.foe.conds, inf, 'maxOff', key));
        const rl = SimEngine.moveResult(likelyM, defM, em, engineField(st, 'foe'));
        const rw = SimEngine.moveResult(worstM, defM, em, engineField(st, 'foe', true));
        const rem = ms.hp / defM.stats.hp * 100;
        const b = koBadge(rl, rem), bw = koBadge(rw, rem);
        const show = b.cls !== 'none' ? b : (bw.cls === 'ko1' || bw.cls === 'ko1p' ? { t: 'KO with max', cls: 'ko1p' } : b);
        const tgt = S.myTeam[i].nickname || monDisplayName(mineMonOf(i, ms));
        return `<span class="sm-res"><em class="sm-tg tm">${esc(tgt)}</em><b>${fmtPct(rl.pctMin)}–${fmtPct(rl.pctMax)}%</b><i class="${show.cls}">${show.t}</i><small>max ${fmtPct(rw.pctMax)}%</small></span>`;
      }).join('');
      return `<div class="sm-move"><span class="mvchip" style="background:${typeColor(em.type)}">${esc(formatName(mv.slug))}${mv.p ? `<em>${Math.round(mv.p * 100)}%</em>` : ''}</span>${cols}</div>`;
    }).join('');
    const editing = UI.edit && UI.edit.side === 'foe' && UI.edit.i === j;
    const megas = sim.roster.filter(p => p.name === `${S.foe[j].name}-mega` || p.name.startsWith(`${S.foe[j].name}-mega-`));
    return `<div class="sm-mon side-b${fs.fainted ? ' fainted' : ''}">
      <div class="sm-mon-head" data-act="actor" data-side="foe" data-i="${j}" title="Click to log this Pokémon's move">${sprite(mon, 'sm-sprite-l')}
        <div><b>${esc(monDisplayName(mon))}</b><div class="sm-types">${mon.types.map(tbadge).join('')}</div>
        <div class="sm-dim">${ab ? esc(formatName(ab)) + (abLocked ? ' (locked)' : abOdds.length > 1 ? (abNarrowed ? ' (narrowed)' : ' (likely)') : '') : 'ability unknown'}</div></div></div>
      <div class="sm-hp"><div class="hp-track"><div class="hp-fill ${fs.hpPct <= 20 ? 'low' : fs.hpPct <= 50 ? 'mid' : 'ok'}" style="width:${fs.hpPct}%"></div></div><span>${fmtPct(fs.hpPct)}% HP</span></div>
      <div class="sm-stagerow">${stagesHtml('foe', j, fs.boosts)}${statusChip(fs.status)}${effMega('foe', j, fs) ? `<span class="sm-stage up">${fs.mega ? 'Mega' : 'Mega (assumed)'}</span>` : ''}</div>
      ${abChips ? `<div class="sm-block"><div class="sm-dim">Ability ${abNarrowed && !abLocked ? '<small>(odds updated from what you logged)</small>' : abLocked ? '<small>(locked — click again to unlock)</small>' : '<small>(usage odds — click to lock one in)</small>'}</div><div class="sm-chips">${abChips}</div></div>` : ''}
      <div class="sm-block"><div class="sm-dim">Holds</div><div class="sm-chips">${itemChips}</div></div>
      ${revealed ? `<div class="sm-block"><div class="sm-dim">Revealed moves</div><div class="sm-chips">${revealed}</div></div>` : ''}
      <div class="sm-moves"><div class="sm-dim">What they threaten — each of your active Pokémon <small>(likely · max-investment)</small></div>${threats || '<div class="sm-dim">No damaging moves known.</div>'}</div>
      ${narrowHtml(j, inf, mon)}
      <button type="button" class="sm-linkbtn" data-act="edit" data-side="foe" data-i="${j}">${editing ? 'Close overrides' : 'Override…'}</button>${editing ? overrideHtml('foe', j, st, megas) : ''}</div>`;
  }

  function narrowHtml(j, inf, mon) {
    if (!inf || !inf.n) return `<div class="sm-narrow sm-dim">Log their attacks and your hits to narrow down their stats.</div>`;
    const rangeLine = (k, label) => {
      const r = inf.ranges[k]; if (!r) return '';
      if (!r.vals.length) return `<div>${label}: <b class="bad">no value fits</b></div>`;
      const full = SimEngine.statCandidates(mon.stats[k], k, isChamp(), level());
      const tight = r.vals.length < full.length;
      return `<div>${label}: <b>${r.min === r.max ? r.min : `${r.min}–${r.max}`}</b>${tight ? '' : ' <span class="sm-dim">(anything)</span>'}</div>`;
    };
    const lines = ['attack', 'special-attack', 'hp', 'defense', 'special-defense', 'speed'].map(k => rangeLine(k, STAT_LABELS[k])).join('');
    const builds = inf.builds.slice(0, 3).map(b => `<div class="sm-build">${esc(formatName(b.nature))} · ${STAT_KEYS.filter(k => b.sp[k] > 0).map(k => `${b.sp[k]} ${STAT_LABELS[k]}`).join(' / ') || 'no investment'} <i>${Math.round(b.p * 100)}%</i></div>`).join('');
    const items = inf.items.slice(0, 3).filter(x => x.slug).map(x => `${esc(formatName(x.slug))} ${Math.round(x.p * 100)}%`).join(' · ');
    const abilities = inf.abilities && inf.abilities.length > 1 ? inf.abilities.filter(x => x.slug).map(x => `${esc(formatName(x.slug))} ${Math.round(x.p * 100)}%`).join(' · ') : '';
    const ruledOut = mon.abilities.length > 1 && inf.abilities && inf.abilities.length === 1 && inf.abilities[0].slug ? formatName(inf.abilities[0].slug) : '';
    const empties = Object.entries(inf.ranges).filter(([, r]) => !r.vals.length).map(([k]) => k);
    const why = [];
    if (empties.includes('speed')) why.push('their Speed can\'t match the move order you logged (Choice Scarf, Tailwind, Trick Room or a priority move?)');
    if (empties.some(k => k === 'attack' || k === 'special-attack')) why.push('no attacking stat produces the damage you entered (check the number, crit, stat changes, or an unrevealed item or ability)');
    if (empties.some(k => k === 'hp' || k === 'defense' || k === 'special-defense')) why.push('no HP/defence combination gives that percentage (check the % and any stat changes)');
    return `<div class="sm-narrow"><div class="sm-dim">Narrowed from ${inf.n} observation${inf.n > 1 ? 's' : ''}</div>
      ${inf.impossible ? `<div><b class="bad">Nothing fits:</b> ${esc(why.join('; ') || 'the logged results contradict each other')}.</div>` : ''}${lines}
      ${builds ? `<div class="sm-dim">Most likely builds</div>${builds}` : ''}${items ? `<div class="sm-dim">Item odds: ${items}</div>` : ''}
      ${abilities ? `<div class="sm-dim">Ability odds: ${abilities}</div>` : ''}${ruledOut ? `<div class="sm-dim">Everything else ruled out — it must be <b>${esc(ruledOut)}</b>.</div>` : ''}</div>`;
  }

  function overrideHtml(side, i, st, extra) {
    const p = side === 'mine' ? st.mine[i] : st.foe[i];
    const hpInput = side === 'mine'
      ? `<label>HP <input type="number" min="0" data-ov="hp" data-side="mine" data-i="${i}" value="${p.hp}"></label>`
      : `<label>HP % <input type="number" min="0" max="100" step="0.5" data-ov="hp" data-side="foe" data-i="${i}" value="${fmtPct(p.hpPct)}"></label>`;
    const boosts = BOOST_KEYS.map(k => `<label>${STAT_LABELS[k]}<select data-ov="boost" data-side="${side}" data-i="${i}" data-key="${k}">${[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map(b => opt(b, b === 0 ? '--' : (b > 0 ? '+' + b : b), (p.boosts[k] || 0) === b)).join('')}</select></label>`).join('');
    let megaSel = '';
    const variants = side === 'foe' ? extra : (extra ? [extra] : []);
    if (variants && variants.length) megaSel = `<label>Mega<select data-ov="mega" data-side="${side}" data-i="${i}">${opt('auto', 'Automatic', p.mega === null)}${opt('none', 'Not Mega', p.mega === false)}${variants.map(v => opt(v.name, monDisplayName(v), p.mega === v.name)).join('')}</select></label>`;
    let foeKnow = '';
    if (side === 'foe') {
      const mon = foeMonOf(i, p);
      foeKnow = `<label>Ability<select data-ov="ability" data-i="${i}"><option value="">Unknown (assume)</option>${mon.abilities.map(a => opt(a.name, formatName(a.name), p.know.abilityKnown && p.know.ability === a.name)).join('')}</select></label>`;
    }
    return `<div class="sm-override">${hpInput}
      <label>Status<select data-ov="status" data-side="${side}" data-i="${i}">${STATUS_OPTS.map(([v, l]) => opt(v, l, v === p.status)).join('')}</select></label>
      ${megaSel}${foeKnow}<div class="sm-ov-boosts">${boosts}</div>
      ${p.fainted ? `<button type="button" class="reset-btn" data-act="revive" data-side="${side}" data-i="${i}">Mark as not fainted</button>` : ''}</div>`;
  }

  // ----- center column: log, composer, field -----
  function fieldHtml(st) {
    const f = st.field;
    const dd = (side, label) => { const c = st.side[side].conds; const n = SIDE_TOGGLES.filter(([k]) => c[k]).length + (c.spikes > 0 ? 1 : 0);
      return `<details class="calc-dd"><summary>${label}${n ? ' · ' + n : ''}</summary><div class="calc-dd-body">${SIDE_TOGGLES.map(([k, l]) => `<label class="chk"><input type="checkbox" data-ov="cond" data-side="${side}" data-key="${k}"${c[k] ? ' checked' : ''}> ${l}</label>`).join('')}
        <div class="sub"><span>Spikes layers</span><select data-ov="spikes" data-side="${side}">${[0, 1, 2, 3].map(n => opt(n, n, n === c.spikes)).join('')}</select></div></div></details>`; };
    const nF = FIELD_TOGGLES.filter(([k]) => f[k]).length;
    return `<div class="sm-field">
      <div class="sm-field-grid">
        <div class="sm-fld"><span>Weather</span><select data-ov="field" data-key="weather">${WEATHER_OPTS.map(([v, l]) => opt(v, l, v === f.weather)).join('')}</select></div>
        <div class="sm-fld"><span>Terrain</span><select data-ov="field" data-key="terrain">${TERRAIN_OPTS.map(([v, l]) => opt(v, l, v === f.terrain)).join('')}</select></div>
        <div class="sm-fld"><span>Field</span><details class="calc-dd"><summary>Field effects${nF ? ' · ' + nF : ''}</summary><div class="calc-dd-body">${FIELD_TOGGLES.map(([k, l]) => `<label class="chk"><input type="checkbox" data-ov="field-t" data-key="${k}"${f[k] ? ' checked' : ''}> ${l}</label>`).join('')}</div></details></div>
        <div class="sm-fld"><span>Your side</span>${dd('mine', 'Conditions')}</div><div class="sm-fld"><span>Their side</span>${dd('foe', 'Conditions')}</div>
      </div>
      ${Object.keys(st.timers).length ? `<div class="sm-timers">${Object.values(st.timers).filter(t => t.label).map(t => `<span class="sm-chip"><b>${esc(t.label)}</b> <i>${t.left} more turn${t.left > 1 ? 's' : ''}</i></span>`).join('')}</div>` : ''}
      </div>`;
  }

  /** Short note appended to a logged move saying what it changed besides damage. */
  function fieldMoveNote(ev) {
    const slug = ev.move;
    if (isFieldMove(slug)) return fieldMoveSummary(slug, ev.actor.s).replace(/\.$/, '');
    const p = effectPreview(slug, ev.actor.s);
    return p ? p.replace(/^Applied automatically — /, '').replace(/\.$/, '') : '';
  }

  function logLine(ev, st) {
    const who = (s, i) => (s === 'mine' ? (S.myTeam[i] ? (S.myTeam[i].nickname || monDisplayName(mineMonOf(i, st.mine[i]))) : '?') : (S.foe[i] && S.foe[i].name ? monDisplayName(foeMonOf(i, st.foe[i])) : '?'));
    if (ev.t === 'move') {
      const tr = ev.targets.map(t => `${who(t.s, t.i)} ${t.immune ? 'was unaffected' : t.fainted ? 'fainted' : t.lost == null ? '' : t.lost > 0 ? `−${t.lost}${t.s === 'foe' ? '%' : ' HP'}` : t.lost < 0 ? `+${-t.lost}${t.s === 'foe' ? '%' : ' HP'}` : '(no damage)'}`.trim()).join(', ');
      const note = ev.missed ? '' : fieldMoveNote(ev);
      return `<b>${esc(who(ev.actor.s, ev.actor.i))}</b> used ${esc(formatName(ev.move))}${ev.crit ? ' (crit)' : ''}${ev.missed ? ' — missed' : ''}${tr ? ' → ' + esc(tr) : ''}${note ? ` <span class="sm-dim">· ${esc(note)}</span>` : ''}`;
    }
    if (ev.t === 'switch') return `${esc(who(ev.side, ev.out))} → ${esc(who(ev.side, ev.in))} switched in`;
    if (ev.t === 'turn') return `<i>Turn ${ev.n} begins</i>`;
    if (ev.t === 'set') {
      const sub = ev.i != null ? ' (' + who(ev.side, ev.i) + ')' : ev.side ? ' (' + (ev.side === 'mine' ? 'your side' : 'their side') + ')' : '';
      return `<span class="sm-dim">Override: ${esc(ev.what)}${esc(sub)}${ev.key ? ' ' + esc(ev.key) : ''} = ${esc(String(ev.value))}</span>`;
    }
    if (ev.t === 'know') return `<span class="sm-dim">Locked ${esc(ev.what)} for ${esc(who('foe', ev.i))}: ${esc(ev.value ? formatName(ev.value) : 'none')}</span>`;
    return '';
  }

  function composerHtml(st) {
    const c = UI.composer; if (!c) return `<div class="sm-dim">Click a Pokémon's name to log what it did this turn, in the order moves happened.</div>`;
    const { side, i } = c;
    const actorMon = side === 'mine' ? mineMonOf(i, st.mine[i]) : foeMonOf(i, st.foe[i]);
    const actorLabel = side === 'mine' ? (S.myTeam[i].nickname || monDisplayName(actorMon)) : monDisplayName(actorMon);
    let moveOpts;
    if (side === 'mine') moveOpts = (S.myTeam[i].moves || []).filter(Boolean);
    else { const pri = foePri(i, st.foe[i]); moveOpts = [...new Set([...st.foe[i].revealed, ...(pri ? pri.moves.slice().sort((a, b) => b.p - a.p).map(m => m.slug) : [])])].filter(s => moveDetails.has(s)); }
    const dl = side === 'foe' ? `<datalist id="sim-moves">${Array.from(actorMon.allMoveNames).filter(s => moveDetails.has(s)).map(s => `<option value="${esc(formatName(s))}">`).join('')}</datalist>` : '';
    const sel = c.move || '';
    const em = sel ? engMove(sel) : null;
    const mode = sel ? targetMode(sel) : null;
    const isStatus = !!em && em.category === 'status';
    const heals = !!sel && ((sim.extras.get(sel) || {}).flags || []).includes('heal');
    const actives = [];
    S.myTeam.forEach((_, k) => { if (st.mine[k].active) actives.push({ s: 'mine', i: k }); });
    S.foe.forEach((f, k) => { if (f.name && st.foe[k].active) actives.push({ s: 'foe', i: k }); });
    let pool = [];
    if (mode === 'self') pool = heals ? [{ s: side, i }] : [];
    else if (mode === 'ally') pool = actives.filter(a => a.s === side && a.i !== i);
    else if (mode === 'single' || mode === 'spread') pool = actives.filter(a => !(a.s === side && a.i === i));
    // HP numbers are only asked for when the move can change HP: damaging moves, healing moves, and moves aimed at an ally
    const showHp = !isStatus || mode === 'self' || mode === 'ally';
    const rows = pool.map(a => {
      const t = c.targets.find(x => x.s === a.s && x.i === a.i), isOn = !!t;
      const lab = a.s === 'mine' ? (S.myTeam[a.i].nickname || S.myTeam[a.i].displayName) : monDisplayName(foeMonOf(a.i, st.foe[a.i]));
      const mine = a.s === 'mine', forced = pool.length === 1 && (mode === 'self' || mode === 'ally');
      const canImmune = !isStatus && a.s !== side;
      return `<div class="sm-trow${isOn ? ' on' : ''}">${forced ? `<span class="${mine ? 'tm' : 'tf'}">${esc(lab)}</span>`
        : `<label class="chk"><input type="${mode === 'single' ? 'radio' : 'checkbox'}" name="sim-target" data-cmp="target" data-s="${a.s}" data-i="${a.i}"${isOn ? ' checked' : ''}> <span class="${mine ? 'tm' : 'tf'}">${esc(lab)}</span></label>`}
        ${isOn && (showHp || canImmune) ? `<span class="sm-lost">${showHp && !(t && t.immune) ? `<input type="number" step="${mine ? 1 : 0.5}" data-cmp="lost" data-s="${a.s}" data-i="${a.i}" placeholder="${mine ? 'HP lost' : '% lost'}" value="${t.lost ?? ''}"><small>${mine ? 'HP points (negative = healed)' : '% of their HP (negative = healed)'}</small>
          <label class="chk"><input type="checkbox" data-cmp="faint" data-s="${a.s}" data-i="${a.i}"${t.fainted ? ' checked' : ''}> fainted</label>` : ''}
          ${canImmune ? `<label class="chk" title="It didn't affect the target — reveals an immunity ability like Levitate or Flash Fire"><input type="checkbox" data-cmp="immune" data-s="${a.s}" data-i="${a.i}"${t.immune ? ' checked' : ''}> no effect</label>` : ''}</span>` : ''}</div>`;
    }).join('');
    const prompt = !sel ? '' : mode === 'field' ? `<div class="sm-dim">${esc(fieldMoveSummary(sel, side))} No target needed.</div>`
      : mode === 'self' ? `<div class="sm-dim">${heals ? 'It heals itself — enter the HP it recovered (as a negative number of HP lost).' : 'It only affects the user — nothing to enter.'}</div>`
      : mode === 'ally' ? `<div class="sm-dim">Aimed at an ally.</div>`
      : `<div class="sm-dim">${mode === 'spread' ? 'Hits several Pokémon — untick any it missed.' : 'On whom?'}${showHp ? ` Then enter ${side === 'foe' ? 'the HP your Pokémon lost' : 'the % the opponent lost'}.` : ' Known stat and status changes are applied automatically.'}</div>`;
    const effNote = sel ? esc(effectPreview(sel, side)) : '';
    const hitOpts = em && (sim.extras.get(sel) || {}).maxHits > (sim.extras.get(sel) || {}).minHits ? (() => { const x = sim.extras.get(sel); const o = []; for (let n = x.minHits; n <= x.maxHits; n++) o.push(n); return o; })() : null;
    return `<div class="sm-composer"><div class="sm-comp-title">Turn ${st.turn} · <b class="${side === 'mine' ? 'tm' : 'tf'}">${esc(actorLabel)}</b> used</div>
      ${dl}<div class="sm-comp-move">
        ${side === 'mine' ? `<select data-cmp="move">${opt('', 'Choose a move…', !sel)}${moveOpts.map(s => opt(s, formatName(s), s === sel)).join('')}</select>`
          : `<input type="text" list="sim-moves" data-cmp="move-text" placeholder="Move name…" value="${sel ? esc(formatName(sel)) : ''}">${moveOpts.length ? `<div class="sm-chips">${moveOpts.slice(0, 8).map(s => `<button type="button" class="sm-chip${s === sel ? ' on' : ''}" data-act="pick-move" data-move="${esc(s)}">${esc(formatName(s))}</button>`).join('')}</div>` : ''}`}
      </div>
      ${sel ? `${prompt}${rows ? `<div class="sm-targets">${rows}</div>` : ''}
        ${effNote ? `<div class="sm-effect">${effNote}</div>` : ''}
        <div class="sm-comp-opts">${isStatus ? '' : `<label class="chk"><input type="checkbox" data-cmp="crit"${c.crit ? ' checked' : ''}> Critical hit</label>`}<label class="chk"><input type="checkbox" data-cmp="missed"${c.missed ? ' checked' : ''}> ${isStatus ? 'Failed / missed' : 'Missed'}</label>
          ${hitOpts ? `<label>Hits <select data-cmp="hits">${hitOpts.map(n => opt(n, n, n === (c.hits || 0))).join('')}</select></label>` : ''}</div>
        <div class="sm-comp-actions"><button type="button" class="sm-go" data-act="add-action">Add to turn</button><button type="button" class="reset-btn" data-act="cancel-composer">Cancel</button></div>` : ''}</div>`;
  }

  /** One-line description of what a field-changing move will do. */
  function fieldMoveSummary(slug, side) {
    const who = side === 'mine' ? 'your' : 'their', opp = side === 'mine' ? 'their' : 'your';
    if (WEATHER_MOVES[slug]) return `Sets ${formatName(WEATHER_MOVES[slug])} for 5 turns.`;
    if (TERRAIN_MOVES[slug]) return `Sets ${formatName(TERRAIN_MOVES[slug])} Terrain for 5 turns.`;
    if (ROOM_MOVES[slug]) return `${formatName(slug)} for 5 turns (using it again while active ends it).`;
    if (SIDE_MOVES[slug]) { const [, whose, turns] = SIDE_MOVES[slug]; return `Sets ${formatName(slug)} on ${whose === 'self' ? who : opp} side${turns ? ` for ${turns} turn${turns > 1 ? 's' : ''}` : ''}.`; }
    if (slug === 'spikes') return `Adds a layer of Spikes on ${opp} side.`;
    if (slug === 'defog') return 'Clears screens and hazards.';
    return 'Clears hazards on the user\'s side.';
  }
  /** Stat / status effects a move will apply automatically, for the composer and log. */
  function effectPreview(slug, side) {
    const fx = MOVE_EFFECTS[slug]; if (!fx) return '';
    const fmt = ch => Object.entries(ch).map(([k, v]) => `${STAT_LABELS[k]} ${v > 0 ? '+' : ''}${v}`).join(', ');
    const parts = [];
    if (fx.self) parts.push(`user: ${fmt(fx.self)}`);
    if (fx.target) parts.push(`target: ${fmt(fx.target)}`);
    if (fx.status) parts.push(`target is ${STATUS_OPTS.find(o => o[0] === fx.status)[1].toLowerCase()}`);
    return `Applied automatically — ${parts.join('; ')}.`;
  }

  function centerHtml(st, actM, actF) {
    const logs = S.log.map((ev, k) => `<div class="sm-log-line t-${ev.t}">${logLine(ev, st)}</div>`).join('') || '<div class="sm-dim">Nothing logged yet.</div>';
    return `<section class="sm-card"><div class="sm-turnbar"><b>Turn ${st.turn}</b>
        <button type="button" class="reset-btn" data-act="next-turn">End turn →</button><button type="button" class="reset-btn" data-act="undo"${S.log.length ? '' : ' disabled'}>Undo last</button></div>
      ${composerHtml(st)}</section>
      <section class="sm-card"><h3>Field &amp; overrides</h3>${fieldHtml(st)}</section>
      <section class="sm-card"><h3>Battle log</h3><div class="sm-log">${logs}</div></section>`;
  }

  function speedLadderHtml(st, infer, actM, actF) {
    const rows = [];
    actM.forEach(i => { const m = mineEngine(i, st.mine[i], st.side.mine.conds); rows.push({ side: 'mine', label: S.myTeam[i].nickname || monDisplayName(mineMonOf(i, st.mine[i])), lo: m.speedFinal, hi: m.speedFinal, likely: m.speedFinal }); });
    actF.forEach(j => {
      const fs = st.foe[j], mon = foeMonOf(j, fs), inf = infer[j], pri = foePri(j, fs);
      const likelyM = foeEngine(foeSpec(j, fs, st.side.foe.conds, inf, 'likely', 'speed'));
      let lo, hi;
      if (inf && inf.ranges.speed && inf.ranges.speed.vals.length) { lo = inf.ranges.speed.min; hi = inf.ranges.speed.max; }
      else { const c = SimEngine.statCandidates(mon.stats.speed, 'speed', isChamp(), level()); lo = c[0].val; hi = c[c.length - 1].val; }
      const mod = x => SimEngine.effSpeed(x, fs.boosts.speed, st.side.foe.conds.tailwind, fs.status === 'par', false);
      const scarfP = pri ? (pri.items.find(i => i.slug === 'choice-scarf') || { p: 0 }).p : 0;
      rows.push({ side: 'foe', label: monDisplayName(mon), lo: mod(lo), hi: mod(hi), likely: likelyM.speedFinal, scarf: !fs.know.itemKnown && scarfP >= SimEngine.SCARF_MIN ? { hi: Math.floor(mod(hi) * 1.5), lo: Math.floor(mod(lo) * 1.5), p: scarfP } : (fs.know.itemKnown && fs.know.item === 'choice-scarf' ? { lo: Math.floor(mod(lo) * 1.5), hi: Math.floor(mod(hi) * 1.5), p: 1 } : null) });
    });
    if (!rows.length) return '';
    const max = Math.max(...rows.map(r => (r.scarf ? r.scarf.hi : r.hi)), 1) * 1.05;
    const pos = v => (v / max * 100).toFixed(1);
    const order = rows.slice().sort((a, b) => b.likely - a.likely);
    const tr = st.field.trickRoom;
    return `<section class="sm-card"><h3>Speed tiers ${tr ? '<span class="sm-stage down">Trick Room</span>' : ''}</h3>
      ${order.map(r => `<div class="sm-spd"><span class="sm-spd-name ${r.side === 'mine' ? 'tm' : 'tf'}">${esc(r.label)}</span>
        <div class="sm-spd-track">${r.side === 'foe' ? `<div class="sm-spd-range" style="left:${pos(r.lo)}%;width:${Math.max(0.8, pos(r.hi) - pos(r.lo))}%"></div>${r.scarf ? `<div class="sm-spd-scarf" style="left:${pos(r.scarf.lo)}%;width:${Math.max(0.8, pos(r.scarf.hi) - pos(r.scarf.lo))}%" title="If Choice Scarf (${Math.round(r.scarf.p * 100)}% usage)"></div>` : ''}` : ''}<div class="sm-spd-tick" style="left:${pos(r.likely)}%"></div></div>
        <span class="sm-spd-val">${r.side === 'mine' ? r.likely : `${r.lo}–${r.hi}`}</span></div>`).join('')}
      <div class="sm-dim">Bars are possible Speed ranges (with stages, Tailwind and paralysis applied); the tick is the most likely value. Hatched = if Choice Scarf (shown only when it's commonly run).</div></section>`;
  }

  // ---------- actions ----------
  function captureSnap(st, actor, targets) {
    const part = (s, i) => clone(s === 'mine' ? st.mine[i] : st.foe[i]);
    return { field: clone(st.field), conds: { mine: clone(st.side.mine.conds), foe: clone(st.side.foe.conds) }, actor: part(actor.s, actor.i), targets: targets.map(t => part(t.s, t.i)) };
  }
  function addAction() {
    const c = UI.composer; if (!c || !c.move) return;
    const st = replay();
    const targets = c.targets.map(t => ({ s: t.s, i: t.i, lost: t.immune || t.lost === '' || t.lost == null ? null : Number(t.lost), fainted: !!t.fainted && !t.immune, immune: !!t.immune }));
    const ev = { t: 'move', turn: st.turn, actor: { s: c.side, i: c.i }, move: c.move, crit: !!c.crit, missed: !!c.missed, hits: c.hits || 0, targets, snap: captureSnap(st, { s: c.side, i: c.i }, targets) };
    pushEvent(ev); UI.composer = null; render();
  }
  function openComposer(side, i) {
    UI.composer = { side, i, move: null, targets: [], crit: false, missed: false, hits: 0 };
    render();
  }
  const activeIdx = (st, s) => (s === 'mine' ? S.myTeam.map((_, k) => k).filter(k => st.mine[k].active) : S.foe.map((f, k) => k).filter(k => S.foe[k].name && st.foe[k].active));
  /** Picks the targets a move implies: none for field/self moves, the single opponent if there's only one, everyone hit for spread moves. */
  function setMove(slug) {
    const c = UI.composer; if (!c) return;
    c.move = slug || null; c.targets = [];
    if (slug) {
      const st = replay(), mode = targetMode(slug), opp = c.side === 'mine' ? 'foe' : 'mine', ex = sim.extras.get(slug) || {};
      const opps = activeIdx(st, opp), allies = activeIdx(st, c.side).filter(k => k !== c.i), mk = (s, k) => ({ s, i: k, lost: '' });
      if (mode === 'self') c.targets = (ex.flags || []).includes('heal') ? [mk(c.side, c.i)] : [];
      else if (mode === 'ally') c.targets = allies.length === 1 ? [mk(c.side, allies[0])] : [];
      else if (mode === 'spread') { c.targets = opps.map(k => mk(opp, k)); if (ex.target === 'all-other-pokemon') allies.forEach(k => c.targets.push(mk(c.side, k))); }
      else if (mode === 'single') c.targets = opps.length === 1 ? [mk(opp, opps[0])] : [];
    }
    render();
  }

  // ---------- events ----------
  function openPicker(input) {
    const i = +input.dataset.i, dd = input.parentElement.querySelector('.option-dropdown');
    root.querySelectorAll('.option-dropdown.open').forEach(d => { if (d !== dd) d.classList.remove('open'); });
    const all = sim.roster.filter(p => !/-mega(-[a-z])?$/.test(p.name)).map(p => ({ value: p.name, label: monDisplayName(p) }));
    const q = input.value.trim().toLowerCase();
    const list = (!q || input.value === input.defaultValue ? all : all.filter(o => o.label.toLowerCase().includes(q))).slice(0, 80);
    UI.openPicker = { i, list };
    dd.innerHTML = list.length ? list.map((o, k) => `<div data-pick="${k}"><div class="option-name">${esc(o.label)}</div></div>`).join('') : '<div style="color:var(--text-dim)">No matches</div>';
    dd.classList.add('open');
  }

  function onClick(e) {
    const pick = e.target.closest('[data-pick]');
    if (pick && UI.openPicker) { const o = UI.openPicker.list[+pick.dataset.pick]; if (o) { S.foe[UI.openPicker.i] = { name: o.value }; UI.matrix = null; UI.openPicker = null; save(); render(); } return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const d = a.dataset, i = d.i != null ? +d.i : null, j = d.j != null ? +d.j : null;
    switch (d.act) {
      case 'phase': S.phase = d.phase; UI.composer = null; save(); render(); break;
      case 'format': S.format = d.format; UI.matrix = null; S.leadsMine = S.leadsMine.slice(0, nActive()); S.leadsFoe = S.leadsFoe.slice(0, nActive()); save(); render(); break;
      case 'retry': applyGame(S.game, true); break;
      case 'new': if (confirm('Start a new battle? This clears the current teams and log.')) { const g = S.game, f = S.format; S = defaultState(); S.game = g; S.format = f; UI.composer = null; UI.matrix = null; UI.inferCache = null; save(); render(); } break;
      case 'fill-paste': fillFromPaste(); break;
      case 'cell': UI.cell = { i, j }; render(); break;
      case 'role': {
        const front = S.leadsMine.includes(i), back = S.backMine.includes(i);
        S.leadsMine = S.leadsMine.filter(x => x !== i); S.backMine = S.backMine.filter(x => x !== i);
        if (!front && !back) { if (S.leadsMine.length < nActive()) S.leadsMine.push(i); else if (S.backMine.length < 2) S.backMine.push(i); }
        else if (front) { if (S.backMine.length < 2) S.backMine.push(i); }
        save(); render(); break;
      }
      case 'foe-lead': if (S.leadsFoe.includes(j)) S.leadsFoe = S.leadsFoe.filter(x => x !== j); else if (S.leadsFoe.length < nActive()) S.leadsFoe.push(j); save(); render(); break;
      case 'start': S.phase = 'battle'; S.log = []; UI.composer = null; UI.inferCache = null; save(); render(); break;
      case 'actor': openComposer(d.side, i); break;
      case 'cancel-composer': UI.composer = null; render(); break;
      case 'pick-move': setMove(d.move); break;
      case 'add-action': addAction(); break;
      case 'next-turn': { const st = replay(); pushEvent({ t: 'turn', n: st.turn + 1 }); UI.composer = null; render(); break; }
      case 'undo': S.log.pop(); UI.inferCache = null; save(); render(); break;
      case 'edit': UI.edit = UI.edit && UI.edit.side === d.side && UI.edit.i === i ? null : { side: d.side, i }; render(); break;
      case 'lock-item': {
        const fs = replay().foe[i], same = fs.know.itemKnown && (fs.know.item || '') === (d.item || '');
        pushEvent({ t: 'know', i, what: 'item', value: same ? null : (d.item || null), locked: !same }); render(); break;
      }
      case 'lock-ability': {
        const fs = replay().foe[i], same = fs.know.abilityKnown && fs.know.ability === d.ab;
        pushEvent({ t: 'know', i, what: 'ability', value: same ? null : d.ab, locked: !same }); render(); break;
      }
      case 'revive': pushEvent({ t: 'set', what: 'revive', side: d.side, i }); render(); break;
      case 'sendout': sendOut(d.side, i); break;
    }
  }

  function sendOut(side, i) {
    const st = replay(); const list = side === 'mine' ? st.mine : st.foe;
    if (list[i].fainted) return;
    const actives = list.map((p, k) => k).filter(k => list[k].active && (side === 'mine' || S.foe[k].name));
    if (actives.length < nActive()) { pushEvent({ t: 'switch', side, out: -1, in: i }); }
    else {
      const names = actives.map(k => (side === 'mine' ? (S.myTeam[k].nickname || S.myTeam[k].displayName) : monDisplayName(rosterMon(S.foe[k].name))));
      let which = 0;
      if (actives.length > 1) { const ans = prompt(`Switch in for which Pokémon?\n${names.map((n, k) => `${k + 1}: ${n}`).join('\n')}`, '1'); if (ans === null) return; which = clamp((parseInt(ans, 10) || 1) - 1, 0, actives.length - 1); }
      pushEvent({ t: 'switch', side, out: actives[which], in: i });
    }
    render();
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.f === 'team') { chooseTeam(t.value); return; }
    if (t.dataset.cmp) { composerChange(t); return; }
    const ov = t.dataset.ov; if (!ov) return;
    const side = t.dataset.side, i = t.dataset.i != null ? +t.dataset.i : null, key = t.dataset.key;
    switch (ov) {
      case 'hp': pushEvent({ t: 'set', what: 'hp', side, i, value: Number(t.value) }); break;
      case 'status': pushEvent({ t: 'set', what: 'status', side, i, value: t.value }); break;
      case 'boost': pushEvent({ t: 'set', what: 'boost', side, i, key, value: Number(t.value) }); break;
      case 'mega': pushEvent({ t: 'set', what: 'mega', side, i, value: t.value === 'auto' ? null : t.value === 'none' ? false : t.value }); break;
      case 'ability': pushEvent({ t: 'know', i, what: 'ability', value: t.value || null, locked: !!t.value }); break;      case 'field': pushEvent({ t: 'set', what: 'field', key, value: t.value }); break;
      case 'field-t': pushEvent({ t: 'set', what: 'field', key, value: t.checked }); break;
      case 'cond': pushEvent({ t: 'set', what: 'cond', side, key, value: t.checked }); break;
      case 'spikes': pushEvent({ t: 'set', what: 'cond', side, key: 'spikes', value: Number(t.value) }); break;
      default: return;
    }
    // keep any open checklist dropdowns open across the re-render (their structure is identical, so index order is stable)
    const wasOpen = [...root.querySelectorAll('details.calc-dd')].map(d => d.open);
    render();
    root.querySelectorAll('details.calc-dd').forEach((d, k) => { if (wasOpen[k]) d.open = true; });
  }

  function composerChange(t) {
    const c = UI.composer; if (!c) return;
    const k = t.dataset.cmp;
    if (k === 'move') setMove(t.value);
    else if (k === 'move-text') {
      const slug = slugify(t.value); if (moveDetails.has(slug)) setMove(slug);
    } else if (k === 'target') {
      const nt = { s: t.dataset.s, i: +t.dataset.i, lost: '' };
      if (t.checked) { if (targetMode(c.move) === 'single') c.targets = [nt]; else c.targets.push(nt); }
      else c.targets = c.targets.filter(x => !(x.s === t.dataset.s && x.i === +t.dataset.i));
      render();
    } else if (k === 'immune') {
      const tg = c.targets.find(x => x.s === t.dataset.s && x.i === +t.dataset.i);
      if (tg) { tg.immune = t.checked; if (t.checked) { tg.lost = ''; tg.fainted = false; } }
      render();
    } else if (k === 'lost') { const tg = c.targets.find(x => x.s === t.dataset.s && x.i === +t.dataset.i); if (tg) tg.lost = t.value; }
    else if (k === 'faint') { const tg = c.targets.find(x => x.s === t.dataset.s && x.i === +t.dataset.i); if (tg) tg.fainted = t.checked; }
    else if (k === 'crit') c.crit = t.checked;
    else if (k === 'missed') c.missed = t.checked;
    else if (k === 'hits') c.hits = +t.value;
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-picker="foe"]')) { openPicker(t); return; }
    if (t.dataset.cmp === 'lost') composerChange(t);
    if (t.dataset.cmp === 'move-text') { const slug = slugify(t.value); if (moveDetails.has(slug) && UI.composer && UI.composer.move !== slug) { setMove(slug); } }
  }

  function chooseTeam(id) {
    const t = (typeof teams !== 'undefined' ? teams : []).find(x => x.id === id);
    if (!t) { S.teamId = null; S.myTeam = []; save(); render(); return; }
    const adopt = () => { S.teamId = t.id; S.myTeam = t.slots.filter(Boolean).map(sl => clone(sl)); S.leadsMine = []; S.backMine = []; S.log = []; UI.matrix = null; UI.inferCache = null; save(); render(); };
    if (t.game !== S.game) { S.game = t.game; applyGame(t.game, false).then(adopt); setModeToggle(); } else adopt();
  }
  function fillFromPaste() {
    const text = root.querySelector('#sim-paste').value;
    const names = [];
    const blocks = splitPokepasteBlocks(text);
    const lines = blocks.length > 1 || /@|Ability:|^- /m.test(text) ? blocks.map(b => parsePokepasteBlock(b)).filter(Boolean).map(p => p.speciesRaw) : text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let missed = 0;
    lines.slice(0, 6).forEach(raw => { const r = resolveSpeciesFromPokepaste(raw, sim.roster.filter(p => !/-mega(-[a-z])?$/.test(p.name))); if (r) names.push(r.mon.name); else missed++; });
    S.foe = [0, 1, 2, 3, 4, 5].map(k => ({ name: names[k] || null }));
    UI.msg = `Filled ${names.length} Pokémon${missed ? `; ${missed} not recognised` : ''}.`; UI.matrix = null; save(); render();
  }

  function setModeToggle() { if (!root) return; setModeToggleState(root.querySelector('#sim-mode-toggle'), root.querySelector('#sim-game-select'), S.game); }

  function buildShell() {
    root.innerHTML = `
      <div class="sim-toolbar"><h2>Battle Simulator</h2>
        <div class="game-select-wrap"><label>Game</label>
          <nav class="mode-toggle" id="sim-mode-toggle"><button type="button" class="view-nav-btn" data-mode="champions">Champions</button><button type="button" class="view-nav-btn" data-mode="mainline">Mainline</button></nav>
          <select id="sim-game-select"></select></div>
        <div class="calc-seg" id="sim-format"></div>
        <div class="calc-seg" id="sim-steps"></div>
        <button type="button" class="reset-btn" data-act="new">New battle</button>
        <span class="calc-status" id="sim-status"></span></div>
      <div id="sim-body"></div>`;
    populateMainlineSelect(root.querySelector('#sim-game-select'));
    wireModeToggle(root.querySelector('#sim-mode-toggle'), root.querySelector('#sim-game-select'), vg => applyGame(vg, false));
    root.querySelector('#sim-game-select').addEventListener('change', e => applyGame(e.target.value, false));
  }

  async function onShown() {
    if (sim.ready) { render(); return; }
    sim.ready = true;
    root = document.getElementById('sim-view');
    buildShell(); restore(); setModeToggle();
    root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput);
    root.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('[data-picker="foe"]')) { e.target.select(); openPicker(e.target); } });
    document.addEventListener('click', e => { if (root && !e.target.closest('.calc-picker')) root.querySelectorAll('.option-dropdown.open').forEach(d => d.classList.remove('open')); });
    await applyGame(S.game, true);
  }

  window.onSimViewShown = onShown;
  window.__sim = { get S() { return S; }, set S(v) { S = v; }, sim, UI, replay, inferAll, buildObs, computeMatrix, render, applyGame, foeSpec, foeEngine, mineEngine, engMove, pushEvent, defaultState, captureSnap };
})();
