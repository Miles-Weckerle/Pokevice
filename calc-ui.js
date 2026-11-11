/* Matchup calculator view. Uses globals from app.js (game data, computeStat, item catalogs, Pokepaste parser)
   and CalcEngine from calc-engine.js. Wrapped so names can't collide with app.js. */
(function () {
  'use strict';

  const STORE_KEY = 'pokemon-calc-state-v2';
  const EXTRAS_KEY = 'calc-move-extras-v1';
  const STATUS_OPTS = [['', 'Healthy'], ['brn', 'Burned'], ['par', 'Paralyzed'], ['psn', 'Poisoned'], ['tox', 'Badly Poisoned'], ['slp', 'Asleep'], ['frz', 'Frozen']];
  const WEATHER_OPTS = [['', 'Clear'], ['sun', 'Sun'], ['rain', 'Rain'], ['sand', 'Sandstorm'], ['snow', 'Snow'], ['harsh-sun', 'Harsh Sunshine'], ['heavy-rain', 'Heavy Rain'], ['strong-winds', 'Strong Winds']];
  const TERRAIN_OPTS = [['', 'None'], ['electric', 'Electric'], ['grassy', 'Grassy'], ['misty', 'Misty'], ['psychic', 'Psychic']];
  const FIELD_TOGGLES = [['gravity', 'Gravity'], ['magicRoom', 'Magic Room'], ['wonderRoom', 'Wonder Room']];
  const SIDE_TOGGLES = [
    ['reflect', 'Reflect'], ['lightScreen', 'Light Screen'], ['auroraVeil', 'Aurora Veil'], ['friendGuard', 'Friend Guard'],
    ['stealthRock', 'Stealth Rock'], ['tailwind', 'Tailwind'],
    ['helpingHand', 'Helping Hand'], ['charge', 'Charge'], ['battery', 'Battery'], ['powerSpot', 'Power Spot'], ['steelySpirit', 'Steely Spirit'],
  ];
  const MON_FLAGS = [
    ['flashFire', 'Flash Fire activated'], ['paradox', 'Protosynthesis / Quark Drive active'],
    ['movesLast', 'Moves last (Analytic)'], ['slowStart', 'Slow Start active'],
  ];
  // Abilities that change the field when the Pokémon is sent out. (Hit-triggered ones like Sand Spit are left out.)
  const WEATHER_SETTERS = {
    drought: 'sun', 'orichalcum-pulse': 'sun', drizzle: 'rain', 'sand-stream': 'sand', 'snow-warning': 'snow',
    'desolate-land': 'harsh-sun', 'primordial-sea': 'heavy-rain', 'delta-stream': 'strong-winds',
  };
  const TERRAIN_SETTERS = { 'electric-surge': 'electric', 'hadron-engine': 'electric', 'grassy-surge': 'grassy', 'misty-surge': 'misty', 'psychic-surge': 'psychic' };
  const STAT_COLORS = { hp: '#4ade80', attack: '#f87171', defense: '#fbbf24', 'special-attack': '#60a5fa', 'special-defense': '#2dd4bf', speed: '#f472b6' };
  const TYPES = CalcEngine.TYPES;
  const SIDE_CLS = ['side-a', 'side-b'];

  const emptyMove = () => ({ name: null, bp: 0, type: 'normal', category: 'physical', crit: false, hits: 1 });
  const emptyBoosts = () => ({ attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 });
  const emptyConds = () => ({ reflect: false, lightScreen: false, auroraVeil: false, friendGuard: false, stealthRock: false, spikes: 0, tailwind: false, helpingHand: false, charge: false, battery: false, powerSpot: false, steelySpirit: false });
  const makeSide = () => ({
    name: null, label: '', types: [], base: { hp: 0, attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 },
    level: 50, nature: 'hardy', evs: emptyEvs(), ivs: emptyIvs(), ability: null, item: null, status: '', curHp: null,
    boosts: emptyBoosts(), tera: null, flags: { flashFire: false, paradox: false, movesLast: false, slowStart: false, fainted: 0 },
    moves: [emptyMove(), emptyMove(), emptyMove(), emptyMove()], conds: emptyConds(), canEvolve: false, spriteId: null, allMoves: false,
  });

  const cs = {
    ready: false, game: CHAMPIONS_VG, roster: [], rosterMap: new Map(), loading: false,
    format: 'singles', weather: '', terrain: '', gravity: false, magicRoom: false, wonderRoom: false,
    sides: [makeSide(), makeSide()], detail: { side: 0, idx: 0 }, extras: null, extrasError: false, openPicker: null,
    results: [[], []], tabs: ['build', 'build'], editMoves: {}, auto: { weather: null, terrain: null },
  };
  let root = null;

  const isChampions = () => cs.game === CHAMPIONS_VG;
  const gameGen = () => { const g = GAMES.find(x => x.vg === cs.game); return g && typeof g.gen === 'number' ? g.gen : 9; };
  const teraAllowed = () => !isChampions() && (gameGen() === 9 || cs.game === NATIONAL_DEX_VG);
  const sideLevel = s => (isChampions() ? 50 : (s.level || 50));
  const monOf = s => (s.name ? cs.rosterMap.get(s.name) || null : null);
  const esc = escapeHtml;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const typeColor = t => TYPE_COLORS[t] || '#777';

  // ---------- persistence ----------
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        game: cs.game, format: cs.format, weather: cs.weather, terrain: cs.terrain, gravity: cs.gravity,
        magicRoom: cs.magicRoom, wonderRoom: cs.wonderRoom, sides: cs.sides, auto: cs.auto,
      }));
    } catch (e) { /* storage unavailable */ }
  }
  function restoreState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.game && GAMES.some(g => g.vg === d.game)) cs.game = d.game;
      for (const k of ['format', 'weather', 'terrain']) if (typeof d[k] === 'string') cs[k] = d[k];
      for (const k of ['gravity', 'magicRoom', 'wonderRoom']) cs[k] = !!d[k];
      if (d.auto) cs.auto = { weather: d.auto.weather || null, terrain: d.auto.terrain || null };
      if (Array.isArray(d.sides) && d.sides.length === 2) {
        cs.sides = d.sides.map(s => Object.assign(makeSide(), s, {
          conds: Object.assign(emptyConds(), s.conds), boosts: Object.assign(emptyBoosts(), s.boosts),
          flags: Object.assign(makeSide().flags, s.flags), evs: Object.assign(emptyEvs(), s.evs), ivs: Object.assign(emptyIvs(), s.ivs),
          moves: [0, 1, 2, 3].map(i => Object.assign(emptyMove(), (s.moves || [])[i])),
        }));
      }
    } catch (e) { console.warn('Could not restore calculator state', e); }
  }

  // ---------- data loading ----------
  async function loadMoveExtras() {
    if (cs.extras) return;
    try {
      const cached = await idbGet(STORE_META, EXTRAS_KEY);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) { cs.extras = new Map(cached.entries); return; }
      const data = await gql(`query { move {
        name move_effect_chance
        movetarget { name }
        movemetum { min_hits max_hits drain }
        moveattributemaps { moveattribute { name } }
      } }`);
      const map = new Map();
      for (const m of data.move) {
        const flags = (m.moveattributemaps || []).map(a => a.moveattribute.name);
        if (m.movemetum && m.movemetum.drain < 0) flags.push('recoil');
        map.set(m.name, {
          chance: m.move_effect_chance, target: m.movetarget ? m.movetarget.name : null,
          minHits: m.movemetum ? m.movemetum.min_hits : null, maxHits: m.movemetum ? m.movemetum.max_hits : null,
          flags: flags.map(f => (/bullet|ball/.test(f) ? 'ballistics' : f)),
        });
      }
      cs.extras = map;
      await idbSet(STORE_META, EXTRAS_KEY, { entries: Array.from(map.entries()), fetchedAt: Date.now() });
    } catch (e) {
      console.warn('Move flag data unavailable', e);
      cs.extras = new Map(); cs.extrasError = true;
    }
  }

  async function loadRoster(vg) {
    const [list] = await Promise.all([getTeamGamePokemon(vg), loadEvolutionGraph(), loadMoveDictionary(), loadAbilityDictionary()]);
    applyEvolutionFlags(list);
    return list;
  }

  async function applyGame(vg) {
    cs.game = vg; cs.loading = true; setStatus('Loading…');
    setModeToggleState(root.querySelector('#calc-mode-toggle'), root.querySelector('#calc-game-select'), vg);
    try {
      cs.roster = await loadRoster(vg);
      cs.rosterMap = new Map(cs.roster.map(p => [p.name, p]));
      await loadMoveExtras();
      for (const s of cs.sides) {
        const mon = monOf(s);
        if (s.name && !mon) Object.assign(s, makeSide(), { conds: s.conds });
        else if (mon) s.canEvolve = !mon.isFinalEvolution;
        if (isChampions()) s.level = 50;
        if (!teraAllowed()) s.tera = null;
      }
      setStatus(`${cs.roster.length} Pokémon` + (cs.extrasError ? ' · move flag data unavailable (contact/punch/spread abilities may not apply)' : ''));
    } catch (e) {
      console.error(e);
      setStatus(`Failed to load data: ${e.message}`);
    }
    cs.loading = false;
    renderAll();
  }

  function setStatus(msg) { const e = root && root.querySelector('#calc-status'); if (e) e.textContent = msg; }

  // ---------- auto weather / terrain from abilities ----------
  function applyAbilityField(i) {
    const abilityOf = k => cs.sides[k].ability;
    for (const [kind, table] of [['weather', WEATHER_SETTERS], ['terrain', TERRAIN_SETTERS]]) {
      const mine = table[abilityOf(i)];
      const auto = cs.auto[kind];
      if (mine) {
        cs[kind] = mine; cs.auto[kind] = { side: i, ability: abilityOf(i) };
      } else if (auto && auto.side === i) {
        const other = table[abilityOf(1 - i)];
        cs[kind] = other || '';
        cs.auto[kind] = other ? { side: 1 - i, ability: abilityOf(1 - i) } : null;
      }
    }
  }

  // ---------- picking Pokémon / moves ----------
  function setSideSpecies(i, mon) {
    const s = cs.sides[i];
    s.name = mon.name; s.label = monDisplayName(mon); s.types = mon.types.slice(); s.base = Object.assign({}, mon.stats);
    s.canEvolve = !mon.isFinalEvolution; s.spriteId = mon.spriteId || mon.id;
    const ab = mon.abilities.find(a => !a.hidden) || mon.abilities[0];
    s.ability = ab ? ab.name : null;
    s.moves = [emptyMove(), emptyMove(), emptyMove(), emptyMove()];
    s.curHp = null; s.boosts = emptyBoosts(); s.tera = null;
    applyAbilityField(i);
  }

  function setMove(i, idx, slug) {
    const s = cs.sides[i];
    if (!slug) { s.moves[idx] = emptyMove(); return; }
    const info = (moveDetails && moveDetails.get(slug)) || {};
    const ex = (cs.extras && cs.extras.get(slug)) || {};
    let hits = 1;
    if (ex.minHits) hits = ex.minHits === ex.maxHits ? ex.minHits : (s.ability === 'skill-link' ? ex.maxHits : 3);
    if (CalcEngine.FIXED_HITS[slug]) hits = CalcEngine.FIXED_HITS[slug];
    s.moves[idx] = { name: slug, bp: info.power || 0, type: info.type || 'normal', category: info.damageClass || 'physical', crit: CalcEngine.ALWAYS_CRIT.has(slug), hits };
  }

  function hitOptions(mv) {
    const ex = (cs.extras && cs.extras.get(mv.name)) || {};
    if (mv.name === 'triple-axel' || mv.name === 'triple-kick') return [1, 2, 3];
    if (ex.minHits && ex.maxHits && ex.maxHits > ex.minHits) { const o = []; for (let n = ex.minHits; n <= ex.maxHits; n++) o.push(n); return o; }
    return null;
  }

  // ---------- combatant / engine plumbing ----------
  function buildMon(i) {
    const s = cs.sides[i];
    if (!s.name) return null;
    const lvl = sideLevel(s), champ = isChampions();
    const stats = {}, natureSigns = {};
    for (const k of STAT_KEYS) {
      stats[k] = computeStat(s.base[k] || 0, k, s.evs[k] || 0, s.ivs[k] ?? 31, champ, s.nature, lvl);
      natureSigns[k] = natureModifier(s.nature, k) > 1 ? 1 : natureModifier(s.nature, k) < 1 ? -1 : 0;
    }
    const maxHp = stats.hp;
    const curHp = s.curHp == null ? maxHp : Math.max(1, Math.min(maxHp, Math.round(s.curHp)));
    let spe = CalcEngine.stage(stats.speed, s.boosts.speed || 0);
    if (s.conds.tailwind) spe *= 2;
    if (s.status === 'par') spe = Math.floor(spe / 2);
    if (s.item === 'choice-scarf' && !cs.magicRoom) spe = Math.floor(spe * 1.5);
    return {
      label: s.label, types: s.types.filter(Boolean), teraType: s.tera || null, level: lvl, stats, boosts: s.boosts, evs: s.evs, natureSigns,
      ability: s.ability, item: s.item, status: s.status, curHp, canEvolve: s.canEvolve, flags: s.flags, speedFinal: spe,
    };
  }

  function engineMove(mv) {
    const ex = (cs.extras && cs.extras.get(mv.name)) || {};
    return {
      name: mv.name, label: formatName(mv.name), type: mv.type, category: mv.category, bp: mv.bp, hits: mv.hits, crit: mv.crit,
      flags: new Set(ex.flags || []), hasSecondary: ex.chance != null, target: ex.target || null,
    };
  }

  function engineField(attackerIdx) {
    return {
      format: cs.format, weather: cs.weather, terrain: cs.terrain, gravity: cs.gravity, magicRoom: cs.magicRoom, wonderRoom: cs.wonderRoom,
      gen: gameGen(), attackerSide: cs.sides[attackerIdx].conds, defenderSide: cs.sides[1 - attackerIdx].conds,
    };
  }

  function computeAll() {
    const mons = [buildMon(0), buildMon(1)];
    cs.results = [0, 1].map(i => cs.sides[i].moves.map(mv => {
      if (!mons[0] || !mons[1] || !mv.name) return null;
      try { return CalcEngine.calc(mons[i], mons[1 - i], engineMove(mv), engineField(i)); }
      catch (e) { console.error('calc failed for', mv.name, e); return { error: e.message, hitRolls: [], noDamage: true }; }
    }));
  }

  // ---------- rendering ----------
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const typeBadge = t => `<span class="tbadge" style="background:${typeColor(t)}">${esc(formatName(t))}</span>`;
  const typeSelect = (i, which, cur) => `<select data-f="type" data-i="${i}" data-w="${which}"><option value="">(none)</option>${TYPES.map(t => opt(t, formatName(t), t === cur)).join('')}</select>`;

  const sideCount = i => { const c = cs.sides[i].conds; return SIDE_TOGGLES.filter(([k]) => c[k]).length + (c.spikes > 0 ? 1 : 0); };
  const flagCount = i => { const s = cs.sides[i]; return MON_FLAGS.filter(([k]) => s.flags[k]).length + (s.flags.fainted > 0 ? 1 : 0); };
  const fieldCount = () => FIELD_TOGGLES.filter(([k]) => cs[k]).length;
  const countLabel = (base, n) => `${base}${n ? ` · ${n}` : ''}`;

  function moveCardHtml(i, m) {
    const s = cs.sides[i], mv = s.moves[m];
    const sel = cs.detail.side === i && cs.detail.idx === m ? ' selected' : '';
    const editing = !!cs.editMoves[`${i}:${m}`];
    const hopts = mv.name ? hitOptions(mv) : null;
    const col = typeColor(mv.type);
    return `<div class="mv-card${sel}${mv.name ? '' : ' blank'}" data-mv="${i}:${m}" data-act="select-move" data-i="${i}" data-m="${m}" style="--tc:${col}">
      <div class="mv-top">
        <span class="mv-chip" style="background:${col}" title="${esc(formatName(mv.type))}">${mv.name ? esc(formatName(mv.type)) : '—'}</span>
        <div class="calc-picker mv-pick"><input type="text" data-picker="move" data-i="${i}" data-m="${m}" placeholder="Add move ${m + 1}" value="${esc(mv.name ? formatName(mv.name) : '')}" autocomplete="off"><div class="option-dropdown"></div></div>
        ${mv.name ? `<button type="button" class="mv-tool${mv.crit ? ' on' : ''}" data-act="crit" data-i="${i}" data-m="${m}" title="Critical hit">Crit</button>
        <button type="button" class="mv-tool${editing ? ' on' : ''}" data-act="edit-move" data-i="${i}" data-m="${m}" title="Edit power, type, category">Edit</button>` : ''}
      </div>
      ${mv.name ? `<div class="mv-meta"><span>${esc(formatName(mv.category))}</span><span>${mv.bp} BP</span>${mv.hits > 1 ? `<span>${mv.hits} hits</span>` : ''}</div>` : ''}
      ${editing && mv.name ? `<div class="mv-edit">
        <label>BP <input type="number" class="calc-num" min="0" data-f="mbp" data-i="${i}" data-m="${m}" value="${mv.bp}"></label>
        <label>Type <select data-f="mtype" data-i="${i}" data-m="${m}">${TYPES.map(t => opt(t, formatName(t), t === mv.type)).join('')}</select></label>
        <label>Class <select data-f="mcat" data-i="${i}" data-m="${m}">${['physical', 'special', 'status'].map(c => opt(c, formatName(c), c === mv.category)).join('')}</select></label>
        ${hopts ? `<label>Hits <select data-f="mhits" data-i="${i}" data-m="${m}">${hopts.map(n => opt(n, n, n === mv.hits)).join('')}</select></label>` : ''}
      </div>` : ''}
      <div class="mv-res" id="mvres-${i}-${m}"></div>
    </div>`;
  }

  function statRowHtml(i, k) {
    const s = cs.sides[i], caps = evCapsForGame(cs.game), champ = isChampions();
    const nm = natureModifier(s.nature, k);
    const mark = nm > 1 ? '<span class="nature-plus">+</span>' : nm < 1 ? '<span class="nature-minus">−</span>' : '';
    const boost = s.boosts[k] || 0;
    return `<div class="st-row" data-stat="${k}">
      <span class="st-label">${STAT_LABELS[k]}${mark}</span>
      <div class="st-bar"><div class="st-fill" data-bar="${k}" style="background:${STAT_COLORS[k]}"></div><span class="st-final" data-final="${k}"></span></div>
      <input type="number" class="st-in" min="1" data-f="base" data-i="${i}" data-k="${k}" value="${s.base[k]}" title="Base stat">
      <div class="st-inv"><input type="range" min="0" max="${caps.perStat}" step="${champ ? 1 : 4}" data-f="ev-range" data-i="${i}" data-k="${k}" value="${s.evs[k] || 0}">
        <input type="number" class="st-in" min="0" max="${caps.perStat}" data-f="ev" data-i="${i}" data-k="${k}" value="${s.evs[k] || 0}" title="${champ ? 'Stat points' : 'EVs'}"></div>
      ${champ ? '' : `<input type="number" class="st-in" min="0" max="31" data-f="iv" data-i="${i}" data-k="${k}" value="${s.ivs[k] ?? 31}" title="IV">`}
      ${k === 'hp' ? '<span></span>' : `<div class="st-stage${boost > 0 ? ' up' : boost < 0 ? ' down' : ''}" data-stage="${k}"><button type="button" data-act="boost-step" data-d="-1" data-i="${i}" data-k="${k}">−</button><span data-boostval="${k}">${boost > 0 ? '+' + boost : boost}</span><button type="button" data-act="boost-step" data-d="1" data-i="${i}" data-k="${k}">+</button></div>`}
    </div>`;
  }

  function buildTabHtml(i) {
    const s = cs.sides[i], mon = monOf(s), champ = isChampions();
    const natureOpts = Object.keys(NATURES).map(n => opt(n, formatName(n) + (NATURES[n].plus ? ` (+${STAT_LABELS[NATURES[n].plus]}, −${STAT_LABELS[NATURES[n].minus]})` : ' (neutral)'), n === s.nature)).join('');
    const abilityNames = mon ? mon.abilities.map(a => a.name) : [];
    if (s.ability && !abilityNames.includes(s.ability)) abilityNames.push(s.ability);
    const abilityOpts = abilityNames.map(a => {
      const hidden = mon && mon.abilities.find(x => x.name === a && x.hidden);
      return opt(a, formatName(a) + (hidden ? ' (Hidden)' : ''), a === s.ability);
    }).join('');
    const abInfo = s.ability ? (abilityDetails.get(s.ability) || CHAMPIONS_ABILITY_OVERRIDES[s.ability] || {}) : {};
    const itemInfo = s.item ? itemsForGame(cs.game).find(it => it.slug === s.item) : null;
    const caps = evCapsForGame(cs.game);
    return `<div class="cc-form">
        <label>Nature<select data-f="nature" data-i="${i}">${natureOpts}</select></label>
        <label>Ability<select data-f="ability" data-i="${i}">${abilityOpts || '<option value="">—</option>'}</select></label>
        <label class="wide">Item<div class="calc-picker"><input type="text" data-picker="item" data-i="${i}" placeholder="Search items…" value="${esc(itemInfo ? itemInfo.name : (s.item ? formatName(s.item) : ''))}" autocomplete="off"><div class="option-dropdown"></div></div></label>
        ${abInfo.shortEffect ? `<div class="cc-hint wide">${esc(abInfo.shortEffect)}</div>` : ''}
        ${itemInfo && itemInfo.effect ? `<div class="cc-hint wide">${esc(itemInfo.effect)}</div>` : ''}
        <label class="wide">Types<span class="inline">${typeSelect(i, 0, s.types[0])}${typeSelect(i, 1, s.types[1])}</span></label>
        ${teraAllowed() ? `<label>Tera type<select data-f="tera" data-i="${i}"><option value="">(none)</option>${TYPES.map(t => opt(t, formatName(t), t === s.tera)).join('')}</select></label>` : ''}
        ${champ ? '' : `<label>Level<input type="number" class="calc-num" min="1" max="100" data-f="level" data-i="${i}" value="${s.level}"></label>`}
      </div>
      <div class="st-head"><span></span><span></span><span>Base</span><span>${champ ? 'Stat points' : 'EVs'}</span>${champ ? '' : '<span>IV</span>'}<span>Stage</span></div>
      <div class="st-grid${champ ? ' champ' : ''}">${STAT_KEYS.map(k => statRowHtml(i, k)).join('')}</div>
      <div class="st-total" data-evtotal="${i}"></div>
      <div class="cc-hint">Bars show the final stat at Lv ${sideLevel(s)}; the last column is the stat after stage changes. Max ${caps.perStat} per stat, ${caps.total} total.</div>`;
  }

  function stateTabHtml(i) {
    const s = cs.sides[i], c = s.conds;
    return `<div class="cc-form">
      <label>Status<select data-f="status" data-i="${i}">${STATUS_OPTS.map(([v, l]) => opt(v, l, v === s.status)).join('')}</select></label>
      <label>On the field<details class="calc-dd"><summary data-ddsum="flags-${i}">${countLabel('Pokémon effects', flagCount(i))}</summary><div class="calc-dd-body">
        ${MON_FLAGS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-f="mflag" data-i="${i}" data-k="${k}"${s.flags[k] ? ' checked' : ''}> ${l}</label>`).join('')}
        <div class="sub"><span>Fainted allies (Supreme Overlord)</span><select data-f="fainted" data-i="${i}">${[0, 1, 2, 3, 4, 5].map(n => opt(n, n, n === s.flags.fainted)).join('')}</select></div>
      </div></details></label>
      <label class="wide">This side<details class="calc-dd"><summary data-ddsum="side-${i}">${countLabel('Side conditions', sideCount(i))}</summary><div class="calc-dd-body">
        ${SIDE_TOGGLES.map(([k, l]) => `<label class="chk"><input type="checkbox" data-f="sidec" data-i="${i}" data-k="${k}"${c[k] ? ' checked' : ''}> ${l}</label>`).join('')}
        <div class="sub"><span>Spikes layers</span><select data-f="spikes" data-i="${i}">${[0, 1, 2, 3].map(n => opt(n, n, n === c.spikes)).join('')}</select></div>
      </div></details></label>
    </div>
    <div class="cc-hint">Reflect, Light Screen, Aurora Veil, Friend Guard and hazards protect or hurt this Pokémon; Helping Hand, Charge, Battery, Power Spot and Steely Spirit boost its attacks.</div>`;
  }

  function setsTabHtml(i) {
    return `<textarea id="calc-io-text-${i}" class="cc-paste" placeholder="Paste a Pokepaste set, or export this Pokémon's set…"></textarea>
      <div class="cc-io"><button type="button" class="reset-btn" data-act="import" data-i="${i}">Import set</button><button type="button" class="reset-btn" data-act="export" data-i="${i}">Export set</button></div>
      <div class="cc-hint" id="calc-io-msg-${i}"></div>`;
  }

  function renderCard(i) {
    const s = cs.sides[i];
    const card = root.querySelector(`#calc-panel-${i}`);
    const mon = monOf(s);
    const teamOpts = (typeof teams !== 'undefined' ? teams : []).flatMap(t => {
      const items = t.slots.map((sl, idx) => (sl ? opt(`${t.id}|${idx}`, `${idx + 1}. ${sl.nickname || sl.displayName}`, false) : '')).join('');
      return items ? [`<optgroup label="${esc(t.name)}">${items}</optgroup>`] : [];
    }).join('');

    let html = `<div class="cc-head">
      <div class="cc-sprite">${s.name ? `<img src="${spriteUrl(s.spriteId)}" alt="" onerror="this.onerror=null;this.src='${spriteFallbackUrl(s.spriteId)}';this.onerror=function(){this.src='${PLACEHOLDER_SPRITE}'};">` : '<span class="cc-slot">' + (i + 1) + '</span>'}</div>
      <div class="cc-id">
        <div class="calc-picker"><input type="text" class="cc-name" data-picker="species" data-i="${i}" placeholder="Search Pokémon…" value="${esc(s.label)}" autocomplete="off"><div class="option-dropdown"></div></div>
        <div class="cc-types">${s.types.filter(Boolean).map(typeBadge).join('')}${s.tera ? `<span class="tbadge tera" style="--tc:${typeColor(s.tera)}">Tera ${esc(formatName(s.tera))}</span>` : ''}</div>
      </div>
      <select class="calc-load" data-f="load" data-i="${i}" title="Load a Pokémon from a saved team"><option value="">Load from team…</option>${teamOpts}</select>
    </div>`;

    if (!s.name) { card.innerHTML = html + `<div class="calc-empty">Pick a Pokémon above, or load one from a saved team.</div>`; return; }

    html += `<div class="cc-hp">
        <div class="hp-track"><div class="hp-fill" data-hpbar="${i}"></div></div>
        <div class="hp-ctl"><span>HP</span><input type="number" class="calc-num" min="1" data-f="hp-abs" data-i="${i}"><span data-maxhp="${i}"></span>
          <input type="range" min="1" max="100" step="1" data-f="hp-range" data-i="${i}"><input type="number" class="calc-num" min="1" max="100" step="0.1" data-f="hp-pct" data-i="${i}"><span>%</span></div>
      </div>
      <div class="cc-sec-title"><span>Moves</span>${mon ? `<label class="chk small"><input type="checkbox" data-f="allmoves" data-i="${i}"${s.allMoves ? ' checked' : ''}> any move</label>` : ''}</div>
      <div class="cc-moves">${[0, 1, 2, 3].map(m => moveCardHtml(i, m)).join('')}</div>
      <div class="cc-tabs">${[['build', 'Build'], ['state', 'Battle state'], ['sets', 'Import / export']].map(([k, l]) => `<button type="button" class="${cs.tabs[i] === k ? 'on' : ''}" data-act="tab" data-i="${i}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="cc-tabbody">${cs.tabs[i] === 'build' ? buildTabHtml(i) : cs.tabs[i] === 'state' ? stateTabHtml(i) : setsTabHtml(i)}</div>`;
    card.innerHTML = html;
    updateDerived(i);
  }

  // refresh computed cells without rebuilding the card (keeps input focus while typing)
  function updateDerived(i) {
    const s = cs.sides[i];
    const card = root.querySelector(`#calc-panel-${i}`);
    if (!s.name || !card) return;
    const m = buildMon(i);
    for (const k of STAT_KEYS) {
      const fin = card.querySelector(`[data-final="${k}"]`);
      if (fin) {
        const eff = k === 'hp' ? null : (k === 'speed' ? m.speedFinal : CalcEngine.stage(m.stats[k], s.boosts[k] || 0));
        fin.textContent = eff != null && eff !== m.stats[k] ? `${m.stats[k]} → ${eff}` : m.stats[k];
      }
      const bar = card.querySelector(`[data-bar="${k}"]`);
      if (bar) bar.style.width = `${clamp(m.stats[k] / (k === 'hp' ? 450 : 330) * 100, 2, 100)}%`;
    }
    const maxHp = m.stats.hp, pctNow = m.curHp / maxHp * 100;
    const q = sel => card.querySelector(sel);
    if (document.activeElement !== q('[data-f="hp-abs"]')) q('[data-f="hp-abs"]').value = m.curHp;
    if (document.activeElement !== q('[data-f="hp-pct"]')) q('[data-f="hp-pct"]').value = Math.round(pctNow * 10) / 10;
    if (document.activeElement !== q('[data-f="hp-range"]')) q('[data-f="hp-range"]').value = Math.round(pctNow);
    q(`[data-maxhp="${i}"]`).textContent = `/ ${maxHp}`;
    const fill = q(`[data-hpbar="${i}"]`);
    fill.style.width = `${pctNow}%`; fill.className = 'hp-fill ' + (pctNow <= 20 ? 'low' : pctNow <= 50 ? 'mid' : 'ok');
    const tot = card.querySelector(`[data-evtotal="${i}"]`);
    if (tot) {
      const caps = evCapsForGame(cs.game), total = STAT_KEYS.reduce((t, k) => t + (s.evs[k] || 0), 0);
      tot.textContent = `${isChampions() ? 'Stat points' : 'EVs'} used: ${total} / ${caps.total}`; tot.classList.toggle('over', total > caps.total);
    }
  }

  function renderFieldBar() {
    const bar = root.querySelector('#calc-fieldbar');
    const autoNote = kind => {
      const a = cs.auto[kind];
      return a && cs.sides[a.side].name ? `<span class="fb-note">set by ${esc(cs.sides[a.side].label)} (${esc(formatName(a.ability))})</span>` : '';
    };
    bar.innerHTML = `
      <div class="fb-item"><span class="fb-label">Format</span><div class="calc-seg"><button type="button" data-format="singles" class="${cs.format === 'singles' ? 'active' : ''}">Singles</button><button type="button" data-format="doubles" class="${cs.format === 'doubles' ? 'active' : ''}">Doubles</button></div></div>
      <div class="fb-item"><span class="fb-label">Weather</span><select data-f="weather">${WEATHER_OPTS.map(([v, l]) => opt(v, l, v === cs.weather)).join('')}</select>${autoNote('weather')}</div>
      <div class="fb-item"><span class="fb-label">Terrain</span><select data-f="terrain">${TERRAIN_OPTS.map(([v, l]) => opt(v, l, v === cs.terrain)).join('')}</select>${autoNote('terrain')}</div>
      <div class="fb-item"><span class="fb-label">Field</span><details class="calc-dd"><summary data-ddsum="field">${countLabel('Field effects', fieldCount())}</summary><div class="calc-dd-body">
        ${FIELD_TOGGLES.map(([k, l]) => `<label class="chk"><input type="checkbox" data-f="fieldt" data-k="${k}"${cs[k] ? ' checked' : ''}> ${l}</label>`).join('')}</div></details></div>`;
    const arena = root.querySelector('#calc-arena');
    arena.className = `calc-arena w-${cs.weather || 'none'} t-${cs.terrain || 'none'}`;
  }

  function refreshDdCounts() {
    const set = (key, text) => { const e = root.querySelector(`[data-ddsum="${key}"]`); if (e) e.textContent = text; };
    set('field', countLabel('Field effects', fieldCount()));
    for (const i of [0, 1]) { set(`side-${i}`, countLabel('Side conditions', sideCount(i))); set(`flags-${i}`, countLabel('Pokémon effects', flagCount(i))); }
  }

  function resultHtml(r, mv) {
    if (!mv.name) return '';
    if (!r) return '<span class="res-text dim">Pick both Pokémon</span>';
    if (r.error) return '<span class="res-text dim">Calculation error</span>';
    if (r.noDamage) return '<span class="res-text dim">No direct damage</span>';
    if (r.immune) return `<span class="res-text dim">No effect · ${esc(r.immune)}</span>`;
    const lo = clamp(r.minPct, 0, 100), hi = clamp(r.maxPct, 0, 100);
    const sure = r.ko.chance >= 1 - 1e-9;
    const cls = r.ko.n === 1 ? (sure ? 'ko1' : 'ko1p') : r.ko.n === 2 ? (sure ? 'ko2' : 'ko2p') : '';
    return `<div class="mv-bar"><div class="mv-bar-min" style="width:${lo}%"></div><div class="mv-bar-rng" style="left:${lo}%;width:${Math.max(0.8, hi - lo)}%"></div></div>
      <div class="res-line"><span class="res-pct">${r.minPct} – ${r.maxPct}%</span><span class="res-ko ${cls}">${esc(r.ko.text)}</span></div>`;
  }

  function effectivenessChip(e) {
    if (e === 0) return '<span class="stg-chip bad">No effect</span>';
    if (e >= 4) return '<span class="stg-chip good">Super effective ×4</span>';
    if (e > 1) return '<span class="stg-chip good">Super effective</span>';
    if (e <= 0.25) return '<span class="stg-chip bad">Resisted ×¼</span>';
    if (e < 1) return '<span class="stg-chip bad">Not very effective</span>';
    return '<span class="stg-chip">Neutral</span>';
  }

  function renderStage() {
    const stage = root.querySelector('#calc-stage');
    const a = cs.sides[0], b = cs.sides[1];
    if (!a.name || !b.name) {
      stage.innerHTML = `<div class="stg-empty"><div class="stg-vs">VS</div><p>Choose two Pokémon and give them moves.<br>The damage breakdown appears here.</p></div>`;
      return;
    }
    let { side, idx } = cs.detail;
    if (!cs.sides[side].moves[idx].name) {
      const found = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]].find(([x, y]) => cs.sides[x].moves[y].name);
      if (!found) { stage.innerHTML = `<div class="stg-empty"><div class="stg-vs">VS</div><p>Add a move to either Pokémon to see damage.</p></div>`; return; }
      [side, idx] = found; cs.detail = { side, idx };
    }
    const att = cs.sides[side], def = cs.sides[1 - side], mv = att.moves[idx], r = cs.results[side][idx];
    const head = `<div class="stg-title"><span class="stg-who ${SIDE_CLS[side]}">${esc(att.label)}</span><span class="stg-arrow">uses</span><span class="stg-move" style="background:${typeColor(r && r.type ? r.type : mv.type)}">${esc(formatName(mv.name))}</span><span class="stg-arrow">on</span><span class="stg-who ${SIDE_CLS[1 - side]}">${esc(def.label)}</span></div>`;
    if (!r || r.error) { stage.innerHTML = head + `<div class="stg-empty"><p>${r ? esc(r.error) : ''}</p></div>`; return; }
    if (r.noDamage) { stage.innerHTML = head + `<div class="stg-empty"><p>${esc(formatName(mv.name))} does no direct damage.</p></div>`; return; }

    const dm = buildMon(1 - side), maxHp = dm.stats.hp, cur = dm.curHp;
    const remMax = Math.max(0, cur - r.max) / maxHp * 100, remMin = Math.max(0, cur - r.min) / maxHp * 100, curPct = cur / maxHp * 100;
    const sure = r.ko.chance >= 1 - 1e-9;
    const koCls = r.immune ? 'none' : r.ko.n === 1 ? (sure ? 'ko1' : 'ko1p') : r.ko.n === 2 ? (sure ? 'ko2' : 'ko2p') : 'none';
    const chips = [effectivenessChip(r.immune ? 0 : r.effectiveness)];
    if (r.stab && r.stab > 4096) chips.push('<span class="stg-chip">STAB</span>');
    if (r.crit) chips.push('<span class="stg-chip">Critical hit</span>');
    if (r.burned) chips.push('<span class="stg-chip bad">Burned</span>');
    if (r.spread) chips.push('<span class="stg-chip">Spread ×0.75</span>');
    if (r.hits > 1) chips.push(`<span class="stg-chip">${r.hits} hits</span>`);
    let rollsHtml = '';
    if (r.possible) {
      const lo = Math.min(...r.possible), hi = Math.max(...r.possible);
      rollsHtml = `<div class="stg-rolls-title">The 16 damage rolls</div><div class="stg-hist">${r.possible.map(v => {
        const h = hi === lo ? 100 : 30 + 70 * (v - lo) / (hi - lo);
        return `<div class="hb${v >= cur ? ' kill' : ''}" style="height:${h}%" title="${v} damage (${Math.floor(v * 1000 / maxHp) / 10}%)"><span>${v}</span></div>`;
      }).join('')}</div>`;
    } else {
      rollsHtml = `<div class="stg-rolls-title">Damage per hit</div><div class="stg-per-hit">${r.hitRolls.map(h => `<span>${Math.min(...h)}–${Math.max(...h)}</span>`).join('<i>+</i>')}</div>`;
    }
    stage.innerHTML = `${head}
      ${r.immune ? `<div class="stg-big none">No effect</div><div class="stg-sub">${esc(r.immune)}</div>` :
        `<div class="stg-big">${r.minPct} – ${r.maxPct}<small>%</small></div><div class="stg-sub">${r.min} – ${r.max} damage to ${esc(def.label)} (${cur}${cur < maxHp ? ' of ' + maxHp : ''} HP)</div>`}
      <div class="stg-hp"><div class="stg-hp-track">
        <div class="seg keep" style="width:${remMax}%"></div><div class="seg maybe" style="left:${remMax}%;width:${Math.max(0, remMin - remMax)}%"></div>
        <div class="seg lost" style="left:${remMin}%;width:${Math.max(0, curPct - remMin)}%"></div></div>
        <div class="stg-legend"><span class="k keep"></span>left standing <span class="k maybe"></span>depends on the roll <span class="k lost"></span>taken</div></div>
      <div class="stg-ko ${koCls}">${esc(r.ko.text)}</div>
      <div class="stg-chips">${chips.join('')}</div>
      ${rollsHtml}
      <div class="stg-desc">${esc(r.desc)}</div>`;
  }

  function renderResults() {
    computeAll();
    for (const i of [0, 1]) for (let m = 0; m < 4; m++) {
      const box = root.querySelector(`#mvres-${i}-${m}`);
      if (box) box.innerHTML = resultHtml(cs.results[i][m], cs.sides[i].moves[m]);
    }
    root.querySelectorAll('.mv-card').forEach(c => c.classList.toggle('selected', c.dataset.mv === `${cs.detail.side}:${cs.detail.idx}`));
    renderStage();
  }

  function renderAll() {
    renderFieldBar(); renderCard(0); renderCard(1); renderResults(); saveState();
  }

  function buildShell() {
    root.innerHTML = `
      <div class="calc-toolbar">
        <h2>Matchup Calculator</h2>
        <div class="game-select-wrap"><label>Game</label>
          <nav class="mode-toggle" id="calc-mode-toggle"><button type="button" class="view-nav-btn" data-mode="champions">Champions</button><button type="button" class="view-nav-btn" data-mode="mainline">Mainline</button></nav>
          <select id="calc-game-select"></select></div>
        <button type="button" class="reset-btn" data-act="swap">⇄ Swap sides</button>
        <button type="button" class="reset-btn" data-act="reset">Reset</button>
        <span class="calc-status" id="calc-status"></span>
      </div>
      <div class="calc-fieldbar" id="calc-fieldbar"></div>
      <div class="calc-arena" id="calc-arena">
        <section class="calc-card side-a" id="calc-panel-0"></section>
        <section class="calc-stage" id="calc-stage"></section>
        <section class="calc-card side-b" id="calc-panel-1"></section>
      </div>`;
    populateMainlineSelect(root.querySelector('#calc-game-select'));
    wireModeToggle(root.querySelector('#calc-mode-toggle'), root.querySelector('#calc-game-select'), vg => applyGame(vg));
    root.querySelector('#calc-game-select').addEventListener('change', e => applyGame(e.target.value));
  }

  // ---------- pickers ----------
  function pickerOptions(kind, i) {
    const s = cs.sides[i], mon = monOf(s);
    if (kind === 'species') return cs.roster.map(p => ({ value: p.name, label: monDisplayName(p), effect: '' }));
    if (kind === 'item') return [{ value: '', label: '(No item)', effect: '' }].concat(itemsForGame(cs.game).map(it => ({ value: it.slug, label: it.name, effect: it.effect })));
    if (kind === 'move') {
      const names = (s.allMoves || !mon) ? Array.from(moveDetails.keys()) : Array.from(mon.allMoveNames);
      names.sort();
      return [{ value: '', label: '(No move)', effect: '' }].concat(names.map(n => {
        const info = moveDetails.get(n) || {};
        return { value: n, label: formatName(n), effect: `${info.type ? formatName(info.type) : ''}${info.damageClass ? ' · ' + formatName(info.damageClass) : ''}${info.power ? ' · ' + info.power + ' BP' : ''}${info.shortEffect ? ' — ' + info.shortEffect : ''}` };
      }));
    }
    return [];
  }

  function openPicker(input) {
    const kind = input.dataset.picker, i = +input.dataset.i, m = input.dataset.m != null ? +input.dataset.m : null;
    const dd = input.parentElement.querySelector('.option-dropdown');
    closePickers(dd);
    const all = pickerOptions(kind, i);
    const q = input.value.trim().toLowerCase();
    let list = (!q || input.value === input.defaultValue) ? all : all.filter(o => o.label.toLowerCase().includes(q));
    list = list.slice(0, 80);
    cs.openPicker = { kind, i, m, list };
    dd.innerHTML = list.length ? list.map((o, idx) => `<div data-pick="${idx}"><div class="option-name">${esc(o.label)}</div>${o.effect ? `<div class="option-effect">${esc(o.effect)}</div>` : ''}</div>`).join('') : '<div style="color:var(--text-dim)">No matches</div>';
    dd.classList.add('open');
  }
  function closePickers(except) { root.querySelectorAll('.option-dropdown.open').forEach(d => { if (d !== except) d.classList.remove('open'); }); }

  function applyPick(idx) {
    const p = cs.openPicker; if (!p) return;
    const o = p.list[idx]; if (!o) return;
    const s = cs.sides[p.i];
    if (p.kind === 'species') { const mon = cs.rosterMap.get(o.value); if (mon) setSideSpecies(p.i, mon); }
    else if (p.kind === 'item') s.item = o.value || null;
    else if (p.kind === 'move') { setMove(p.i, p.m, o.value); cs.detail = { side: p.i, idx: p.m }; }
    cs.openPicker = null;
    renderAll();
  }

  // ---------- import / export / load from team ----------
  function loadSlotIntoSide(i, slot, teraRaw) {
    const mon = cs.rosterMap.get(slot.pokemonName);
    if (!mon) return false;
    setSideSpecies(i, mon);
    const s = cs.sides[i];
    if (slot.ability) s.ability = slot.ability;
    s.item = slot.item || null;
    s.nature = NATURES[slot.nature] ? slot.nature : DEFAULT_NATURE;
    s.evs = Object.assign(emptyEvs(), slot.evs);
    s.ivs = Object.assign(emptyIvs(), slot.ivs || {});
    (slot.moves || []).slice(0, 4).forEach((mv, idx) => { if (mv) setMove(i, idx, mv); });
    if (teraRaw && teraAllowed()) { const t = slugify(teraRaw); if (TYPES.includes(t)) s.tera = t; }
    applyAbilityField(i);
    return true;
  }

  function formatPaste(i) {
    const s = cs.sides[i];
    if (!s.name) return '';
    const lines = [`${s.label}${s.item ? ' @ ' + (itemsForGame(cs.game).find(it => it.slug === s.item) || { name: formatName(s.item) }).name : ''}`];
    if (s.ability) lines.push(`Ability: ${formatName(s.ability)}`);
    if (s.tera) lines.push(`Tera Type: ${formatName(s.tera)}`);
    const ab = { hp: 'HP', attack: 'Atk', defense: 'Def', 'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe' };
    const used = STAT_KEYS.filter(k => s.evs[k] > 0);
    if (isChampions()) { if (used.length) lines.push(`# Champions stat points: ${used.map(k => `${ab[k]} ${s.evs[k]}`).join(' / ')}`); }
    else if (used.length) lines.push(`EVs: ${used.map(k => `${s.evs[k]} ${ab[k]}`).join(' / ')}`);
    lines.push(`${formatName(s.nature)} Nature`);
    if (!isChampions()) { const iv = STAT_KEYS.filter(k => (s.ivs[k] ?? 31) !== 31).map(k => `${s.ivs[k]} ${ab[k]}`); if (iv.length) lines.push(`IVs: ${iv.join(' / ')}`); }
    s.moves.filter(m => m.name).forEach(m => lines.push(`- ${formatName(m.name)}`));
    return lines.join('\n');
  }

  function importInto(i) {
    const msg = root.querySelector(`#calc-io-msg-${i}`);
    const text = root.querySelector(`#calc-io-text-${i}`).value;
    const block = splitPokepasteBlocks(text)[0];
    if (!block) { msg.textContent = 'Paste a set first.'; return; }
    const parsed = parsePokepasteBlock(block);
    const { slot, warnings } = buildSlotFromParsedBlock(parsed, cs.roster, cs.game);
    if (!slot) { msg.textContent = warnings.join(' '); return; }
    loadSlotIntoSide(i, slot, parsed.teraType);
    const note = 'Imported.' + (warnings.length ? ' ' + warnings.join(' ') : '');
    cs.tabs[i] = 'sets';
    renderAll();
    root.querySelector(`#calc-io-msg-${i}`).textContent = note;
  }

  async function loadFromTeam(i, value) {
    const [teamId, idx] = value.split('|');
    const team = teams.find(t => t.id === teamId); const slot = team && team.slots[+idx];
    if (!slot) return;
    if (team.game !== cs.game) await applyGame(team.game);
    loadSlotIntoSide(i, slot, null);
    renderAll();
  }

  // ---------- events ----------
  function syncPair(i, k, value) {
    const card = root.querySelector(`#calc-panel-${i}`);
    const num = card.querySelector(`[data-f="ev"][data-k="${k}"]`), rng = card.querySelector(`[data-f="ev-range"][data-k="${k}"]`);
    if (num && document.activeElement !== num) num.value = value;
    if (rng && document.activeElement !== rng) rng.value = value;
  }

  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-picker]')) { openPicker(t); return; }
    const f = t.dataset.f; if (!f) return;
    const i = t.dataset.i != null ? +t.dataset.i : null, k = t.dataset.k, m = t.dataset.m != null ? +t.dataset.m : null;
    const s = i != null ? cs.sides[i] : null;
    const caps = evCapsForGame(cs.game);
    const num = () => (t.value === '' ? 0 : Number(t.value));
    switch (f) {
      case 'base': s.base[k] = Math.max(1, num()); break;
      case 'ev': case 'ev-range': s.evs[k] = clamp(num(), 0, caps.perStat); syncPair(i, k, s.evs[k]); break;
      case 'iv': s.ivs[k] = clamp(num(), 0, 31); break;
      case 'level': s.level = clamp(num() || 50, 1, 100); break;
      case 'mbp': s.moves[m].bp = Math.max(0, num()); break;
      case 'hp-abs': s.curHp = Math.max(1, num()); break;
      case 'hp-pct': case 'hp-range': { const max = buildMon(i).stats.hp; const p = clamp(num(), 0.1, 100); s.curHp = p >= 100 ? null : Math.max(1, Math.round(p * max / 100)); break; }
      default: return;
    }
    updateDerived(i); renderResults(); saveState();
  }

  function onChange(e) {
    const t = e.target, f = t.dataset.f; if (!f) return;
    const i = t.dataset.i != null ? +t.dataset.i : null, k = t.dataset.k, m = t.dataset.m != null ? +t.dataset.m : null;
    const s = i != null ? cs.sides[i] : null;
    let fieldChanged = false;
    switch (f) {
      case 'load': if (t.value) loadFromTeam(i, t.value); return;
      case 'type': { const types = s.types.slice(); types[+t.dataset.w] = t.value || undefined; s.types = [types[0], types[1]].filter(Boolean); renderCard(i); break; }
      case 'tera': s.tera = t.value || null; renderCard(i); break;
      case 'nature': s.nature = t.value; renderCard(i); break;
      case 'ability': s.ability = t.value; { const w = cs.weather, tr = cs.terrain; applyAbilityField(i); fieldChanged = w !== cs.weather || tr !== cs.terrain; } renderCard(i); break;
      case 'status': s.status = t.value; break;
      case 'mflag': s.flags[k] = t.checked; break;
      case 'fainted': s.flags.fainted = +t.value; break;
      case 'allmoves': s.allMoves = t.checked; break;
      case 'mtype': s.moves[m].type = t.value; renderCard(i); break;
      case 'mcat': s.moves[m].category = t.value; renderCard(i); break;
      case 'mhits': s.moves[m].hits = +t.value; renderCard(i); break;
      case 'sidec': s.conds[k] = t.checked; break;
      case 'spikes': s.conds.spikes = +t.value; break;
      case 'weather': cs.weather = t.value; cs.auto.weather = null; fieldChanged = true; break;
      case 'terrain': cs.terrain = t.value; cs.auto.terrain = null; fieldChanged = true; break;
      case 'fieldt': cs[k] = t.checked; break;
      default: return;
    }
    if (fieldChanged) renderFieldBar();
    refreshDdCounts();
    updateDerived(0); updateDerived(1);
    renderResults(); saveState();
  }

  function onClick(e) {
    const pick = e.target.closest('[data-pick]');
    if (pick) { applyPick(+pick.dataset.pick); return; }
    const fmt = e.target.closest('[data-format]');
    if (fmt) { cs.format = fmt.dataset.format; renderFieldBar(); renderResults(); saveState(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const i = act.dataset.i != null ? +act.dataset.i : null, m = act.dataset.m != null ? +act.dataset.m : null;
    switch (act.dataset.act) {
      case 'crit': { const mv = cs.sides[i].moves[m]; mv.crit = !mv.crit; act.classList.toggle('on', mv.crit); cs.detail = { side: i, idx: m }; renderResults(); saveState(); e.stopPropagation(); break; }
      case 'edit-move': { const key = `${i}:${m}`; cs.editMoves[key] = !cs.editMoves[key]; renderCard(i); renderResults(); break; }
      case 'select-move': if (cs.detail.side !== i || cs.detail.idx !== m) { cs.detail = { side: i, idx: m }; renderResults(); } break;
      case 'tab': cs.tabs[i] = act.dataset.tab; renderCard(i); renderResults(); break;
      case 'boost-step': {
        const s = cs.sides[i], k = act.dataset.k; s.boosts[k] = clamp((s.boosts[k] || 0) + (+act.dataset.d), -6, 6);
        const v = s.boosts[k], holder = act.closest('.st-stage');
        holder.querySelector('[data-boostval]').textContent = v > 0 ? `+${v}` : v;
        holder.classList.toggle('up', v > 0); holder.classList.toggle('down', v < 0);
        updateDerived(i); renderResults(); saveState(); break;
      }
      case 'swap':
        cs.sides.reverse(); cs.detail = { side: 1 - cs.detail.side, idx: cs.detail.idx };
        for (const kd of ['weather', 'terrain']) if (cs.auto[kd]) cs.auto[kd] = { side: 1 - cs.auto[kd].side, ability: cs.auto[kd].ability };
        cs.editMoves = {}; renderAll(); break;
      case 'reset':
        cs.sides = [makeSide(), makeSide()]; cs.weather = ''; cs.terrain = ''; cs.gravity = cs.magicRoom = cs.wonderRoom = false;
        cs.auto = { weather: null, terrain: null }; cs.editMoves = {}; renderAll(); break;
      case 'import': importInto(i); break;
      case 'export': { const txt = formatPaste(i); root.querySelector(`#calc-io-text-${i}`).value = txt; root.querySelector(`#calc-io-msg-${i}`).textContent = txt ? 'Exported.' : 'Nothing to export yet.'; break; }
    }
  }

  async function onShown() {
    if (cs.ready) return;
    cs.ready = true;
    root = document.getElementById('calc-view');
    buildShell();
    restoreState();
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('[data-picker]')) { e.target.select(); openPicker(e.target); } });
    document.addEventListener('click', e => { if (!e.target.closest('.calc-picker')) closePickers(); });
    await applyGame(cs.game);
  }

  window.onCalcViewShown = onShown;
  window.__calc = { cs, buildMon, engineMove, engineField, computeAll, setSideSpecies, setMove, applyGame, renderAll, applyAbilityField };
})();
