/* Damage Calculator view. Uses globals from app.js (game data, computeStat, item catalogs, Pokepaste parser)
   and CalcEngine from calc-engine.js. Everything here is wrapped so names can't collide with app.js. */
(function () {
  'use strict';

  const STORE_KEY = 'pokemon-calc-state-v1';
  const EXTRAS_KEY = 'calc-move-extras-v1';
  const STATUS_OPTS = [['', 'Healthy'], ['brn', 'Burned'], ['par', 'Paralyzed'], ['psn', 'Poisoned'], ['tox', 'Badly Poisoned'], ['slp', 'Asleep'], ['frz', 'Frozen']];
  const WEATHER_OPTS = [['', 'None'], ['sun', 'Sun'], ['rain', 'Rain'], ['sand', 'Sandstorm'], ['snow', 'Snow'], ['harsh-sun', 'Harsh Sunshine'], ['heavy-rain', 'Heavy Rain'], ['strong-winds', 'Strong Winds']];
  const TERRAIN_OPTS = [['', 'None'], ['electric', 'Electric Terrain'], ['grassy', 'Grassy Terrain'], ['misty', 'Misty Terrain'], ['psychic', 'Psychic Terrain']];
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
  const BOOST_KEYS = ['attack', 'defense', 'special-attack', 'special-defense', 'speed'];
  const TYPES = CalcEngine.TYPES;

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
    results: [[], []],
  };
  let root = null;

  const isChampions = () => cs.game === CHAMPIONS_VG;
  const gameGen = () => { const g = GAMES.find(x => x.vg === cs.game); return g && typeof g.gen === 'number' ? g.gen : 9; };
  const teraAllowed = () => !isChampions() && (gameGen() === 9 || cs.game === NATIONAL_DEX_VG);
  const sideLevel = s => (isChampions() ? 50 : (s.level || 50));
  const monOf = s => (s.name ? cs.rosterMap.get(s.name) || null : null);
  const esc = escapeHtml;

  // ---------- persistence ----------
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        game: cs.game, format: cs.format, weather: cs.weather, terrain: cs.terrain, gravity: cs.gravity,
        magicRoom: cs.magicRoom, wonderRoom: cs.wonderRoom, sides: cs.sides,
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
        if (!isChampions()) { /* keep levels */ } else { s.level = 50; }
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

  // ---------- picking Pokémon / moves ----------
  function setSideSpecies(i, mon) {
    const s = cs.sides[i];
    s.name = mon.name; s.label = monDisplayName(mon); s.types = mon.types.slice(); s.base = Object.assign({}, mon.stats);
    s.canEvolve = !mon.isFinalEvolution; s.spriteId = mon.spriteId || mon.id;
    const ab = mon.abilities.find(a => !a.hidden) || mon.abilities[0];
    s.ability = ab ? ab.name : null;
    s.moves = [emptyMove(), emptyMove(), emptyMove(), emptyMove()];
    s.curHp = null; s.boosts = emptyBoosts(); s.tera = null;
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
  const typeSelect = (i, which, cur) => `<select data-f="type" data-i="${i}" data-w="${which}"><option value="">(none)</option>${TYPES.map(t => opt(t, formatName(t), t === cur)).join('')}</select>`;

  function renderPanel(i) {
    const s = cs.sides[i];
    const panel = root.querySelector(`#calc-panel-${i}`);
    const mon = monOf(s);
    const champ = isChampions();
    const caps = evCapsForGame(cs.game);
    const evTotal = STAT_KEYS.reduce((t, k) => t + (s.evs[k] || 0), 0);

    const teamOpts = (typeof teams !== 'undefined' ? teams : []).flatMap(t => {
      const items = t.slots.map((sl, idx) => (sl ? opt(`${t.id}|${idx}`, `${idx + 1}. ${sl.nickname || sl.displayName}`, false) : '')).join('');
      return items ? [`<optgroup label="${esc(t.name)}">${items}</optgroup>`] : [];
    }).join('');

    let html = `<h3><span>Pokémon ${i + 1}</span>
      <select class="calc-load" data-f="load" data-i="${i}"><option value="">Load from team…</option>${teamOpts}</select></h3>
      <div class="calc-species">
        ${s.name ? `<img src="${spriteUrl(s.spriteId)}" alt="" onerror="this.onerror=null;this.src='${spriteFallbackUrl(s.spriteId)}';this.onerror=function(){this.src='${PLACEHOLDER_SPRITE}'};">` : ''}
        <div class="calc-picker"><input type="text" data-picker="species" data-i="${i}" placeholder="Search Pokémon…" value="${esc(s.label)}" autocomplete="off"><div class="option-dropdown"></div></div>
      </div>`;

    if (!s.name) { panel.innerHTML = html + `<div class="calc-empty">Pick a Pokémon, or load one from a saved team.</div>`; return; }

    const natureOpts = Object.keys(NATURES).map(n => opt(n, formatName(n) + (NATURES[n].plus ? ` (+${STAT_LABELS[NATURES[n].plus]}, −${STAT_LABELS[NATURES[n].minus]})` : ''), n === s.nature)).join('');
    const abilityNames = mon ? mon.abilities.map(a => a.name) : [];
    if (s.ability && !abilityNames.includes(s.ability)) abilityNames.push(s.ability);
    const abilityOpts = abilityNames.map(a => {
      const hidden = mon && mon.abilities.find(x => x.name === a && x.hidden);
      return opt(a, formatName(a) + (hidden ? ' (Hidden)' : ''), a === s.ability);
    }).join('');
    const abInfo = s.ability ? (abilityDetails.get(s.ability) || CHAMPIONS_ABILITY_OVERRIDES[s.ability] || {}) : {};
    const itemInfo = s.item ? itemsForGame(cs.game).find(it => it.slug === s.item) : null;
    const flagCount = MON_FLAGS.filter(([k]) => s.flags[k]).length + (s.flags.fainted > 0 ? 1 : 0);

    html += `
      <div class="calc-row"><label>Type</label><div class="inline">${typeSelect(i, 0, s.types[0])}${typeSelect(i, 1, s.types[1])}
        ${teraAllowed() ? `<label style="margin-left:8px;color:var(--text-dim);font-size:12px">Tera</label><select data-f="tera" data-i="${i}"><option value="">(none)</option>${TYPES.map(t => opt(t, formatName(t), t === s.tera)).join('')}</select>` : ''}
        ${champ ? '' : `<label style="margin-left:8px;color:var(--text-dim);font-size:12px">Level</label><input type="number" class="calc-num" min="1" max="100" data-f="level" data-i="${i}" value="${s.level}">`}
      </div></div>
      <table class="calc-stats"><thead><tr><th></th><th>Base</th><th>${champ ? 'SP' : 'EVs'}</th>${champ ? '' : '<th>IVs</th>'}<th>Stat</th><th>Stage</th><th>Eff.</th></tr></thead><tbody>
      ${STAT_KEYS.map(k => {
        const nm = natureModifier(s.nature, k);
        const mark = nm > 1 ? '<span class="nature-plus">+</span>' : nm < 1 ? '<span class="nature-minus">−</span>' : '';
        return `<tr data-stat="${k}"><td>${STAT_LABELS[k]}${mark}</td>
          <td><input type="number" min="1" data-f="base" data-i="${i}" data-k="${k}" value="${s.base[k]}"></td>
          <td><input type="number" min="0" max="${caps.perStat}" data-f="ev" data-i="${i}" data-k="${k}" value="${s.evs[k] || 0}"></td>
          ${champ ? '' : `<td><input type="number" min="0" max="31" data-f="iv" data-i="${i}" data-k="${k}" value="${s.ivs[k] ?? 31}"></td>`}
          <td class="calc-final" data-final="${k}"></td>
          <td>${k === 'hp' ? '' : `<select data-f="boost" data-i="${i}" data-k="${k}">${[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map(b => opt(b, b === 0 ? '--' : (b > 0 ? `+${b}` : `${b}`), (s.boosts[k] || 0) === b)).join('')}</select>`}</td>
          <td class="calc-eff" data-eff="${k}"></td></tr>`;
      }).join('')}</tbody></table>
      <div class="calc-total${evTotal > caps.total ? ' over' : ''}" data-evtotal="${i}">${champ ? 'SP' : 'EV'} total: ${evTotal} / ${caps.total}</div>

      <div class="calc-row"><label>Nature</label><select data-f="nature" data-i="${i}">${natureOpts}</select></div>
      <div class="calc-row"><label>Ability</label><div><select data-f="ability" data-i="${i}">${abilityOpts || '<option value="">—</option>'}</select>
        ${abInfo.shortEffect ? `<div class="calc-hint">${esc(abInfo.shortEffect)}</div>` : ''}</div></div>
      <div class="calc-row"><label>Item</label><div><div class="calc-picker"><input type="text" data-picker="item" data-i="${i}" placeholder="Search items…" value="${esc(itemInfo ? itemInfo.name : (s.item ? formatName(s.item) : ''))}" autocomplete="off"><div class="option-dropdown"></div></div>
        ${itemInfo && itemInfo.effect ? `<div class="calc-hint">${esc(itemInfo.effect)}</div>` : ''}</div></div>
      <div class="calc-row"><label>Status</label><select data-f="status" data-i="${i}">${STATUS_OPTS.map(([v, l]) => opt(v, l, v === s.status)).join('')}</select></div>
      <div class="calc-row"><label>HP</label><div class="inline"><input type="number" class="calc-num" min="1" data-f="hp-abs" data-i="${i}"> <span data-maxhp="${i}"></span>
        <span>(</span><input type="number" class="calc-num" min="1" max="100" step="0.1" data-f="hp-pct" data-i="${i}"><span>%)</span></div></div>
      <div class="calc-hpbar"><div data-hpbar="${i}"></div></div>
      <div class="calc-row"><label>Other</label>
        <details class="calc-dd"><summary>Conditions${flagCount ? ` (${flagCount})` : ''}</summary><div class="calc-dd-body">
          ${MON_FLAGS.map(([k, l]) => `<label><input type="checkbox" data-f="mflag" data-i="${i}" data-k="${k}"${s.flags[k] ? ' checked' : ''}> ${l}</label>`).join('')}
          <div class="sub"><span>Fainted allies (Supreme Overlord)</span><select data-f="fainted" data-i="${i}">${[0, 1, 2, 3, 4, 5].map(n => opt(n, n, n === s.flags.fainted)).join('')}</select></div>
        </div></details></div>

      <div class="calc-moves">
        <div class="calc-hint">Moves ${mon ? `<label style="margin-left:8px"><input type="checkbox" data-f="allmoves" data-i="${i}"${s.allMoves ? ' checked' : ''}> show all moves</label>` : ''}</div>
        ${s.moves.map((mv, m) => {
          const hopts = hitOptions(mv);
          return `<div class="calc-move-row">
            <div class="calc-picker"><input type="text" data-picker="move" data-i="${i}" data-m="${m}" placeholder="Move ${m + 1}" value="${esc(mv.name ? formatName(mv.name) : '')}" autocomplete="off"><div class="option-dropdown"></div></div>
            <input type="number" class="calc-num" min="0" data-f="mbp" data-i="${i}" data-m="${m}" value="${mv.bp}" title="Base power">
            <select data-f="mtype" data-i="${i}" data-m="${m}">${TYPES.map(t => opt(t, formatName(t), t === mv.type)).join('')}</select>
            <select data-f="mcat" data-i="${i}" data-m="${m}">${['physical', 'special', 'status'].map(c => opt(c, formatName(c), c === mv.category)).join('')}</select>
            <button type="button" class="calc-crit${mv.crit ? ' active' : ''}" data-act="crit" data-i="${i}" data-m="${m}">Crit</button>
            ${hopts ? `<select data-f="mhits" data-i="${i}" data-m="${m}" title="Number of hits">${hopts.map(n => opt(n, `${n} hit${n > 1 ? 's' : ''}`, n === mv.hits)).join('')}</select>` : '<span></span>'}
          </div>`;
        }).join('')}
      </div>`;
    panel.innerHTML = html;
    updateDerived(i);
  }

  // refresh the computed cells of a panel without rebuilding it (so typing keeps focus)
  function updateDerived(i) {
    const s = cs.sides[i];
    const panel = root.querySelector(`#calc-panel-${i}`);
    if (!s.name || !panel) return;
    const m = buildMon(i);
    for (const k of STAT_KEYS) {
      const fin = panel.querySelector(`[data-final="${k}"]`); if (fin) fin.textContent = m.stats[k];
      const eff = panel.querySelector(`[data-eff="${k}"]`);
      if (eff) eff.textContent = k === 'hp' ? '' : (k === 'speed' ? m.speedFinal : CalcEngine.stage(m.stats[k], s.boosts[k] || 0));
    }
    const maxHp = m.stats.hp;
    const hpAbs = panel.querySelector('[data-f="hp-abs"]'), hpPct = panel.querySelector('[data-f="hp-pct"]');
    if (document.activeElement !== hpAbs) hpAbs.value = m.curHp;
    if (document.activeElement !== hpPct) hpPct.value = Math.round(m.curHp / maxHp * 1000) / 10;
    panel.querySelector(`[data-maxhp="${i}"]`).textContent = `/ ${maxHp}`;
    const bar = panel.querySelector(`[data-hpbar="${i}"]`), pct = m.curHp / maxHp * 100;
    bar.style.width = `${pct}%`; bar.className = pct <= 20 ? 'low' : pct <= 50 ? 'mid' : '';
    const caps = evCapsForGame(cs.game), total = STAT_KEYS.reduce((t, k) => t + (s.evs[k] || 0), 0);
    const tot = panel.querySelector(`[data-evtotal="${i}"]`);
    tot.textContent = `${isChampions() ? 'SP' : 'EV'} total: ${total} / ${caps.total}`; tot.classList.toggle('over', total > caps.total);
  }

  function renderField() {
    const f = root.querySelector('#calc-field');
    const toggles = (list, src, scope) => list.map(([k, l]) => `<label><input type="checkbox" data-f="${scope}" data-k="${k}"${src[k] ? ' checked' : ''}> ${l}</label>`).join('');
    const sideDd = (i) => {
      const c = cs.sides[i].conds;
      const n = SIDE_TOGGLES.filter(([k]) => c[k]).length + (c.spikes > 0 ? 1 : 0);
      return `<details class="calc-dd"><summary>${esc(cs.sides[i].label || `Pokémon ${i + 1}`)}'s side${n ? ` (${n})` : ''}</summary><div class="calc-dd-body">
        ${SIDE_TOGGLES.map(([k, l]) => `<label><input type="checkbox" data-f="sidec" data-i="${i}" data-k="${k}"${c[k] ? ' checked' : ''}> ${l}</label>`).join('')}
        <div class="sub"><span>Spikes layers</span><select data-f="spikes" data-i="${i}">${[0, 1, 2, 3].map(n => opt(n, n, n === c.spikes)).join('')}</select></div>
      </div></details>`;
    };
    const nField = FIELD_TOGGLES.filter(([k]) => cs[k]).length;
    f.innerHTML = `<h3>Field</h3>
      <div style="text-align:center"><div class="calc-seg" id="calc-format"><button type="button" data-format="singles" class="${cs.format === 'singles' ? 'active' : ''}">Singles</button><button type="button" data-format="doubles" class="${cs.format === 'doubles' ? 'active' : ''}">Doubles</button></div></div>
      <div class="calc-section">
        <div class="calc-row"><label>Weather</label><select data-f="weather">${WEATHER_OPTS.map(([v, l]) => opt(v, l, v === cs.weather)).join('')}</select></div>
        <div class="calc-row"><label>Terrain</label><select data-f="terrain">${TERRAIN_OPTS.map(([v, l]) => opt(v, l, v === cs.terrain)).join('')}</select></div>
        <div class="calc-row"><label>Effects</label><details class="calc-dd"><summary>Field effects${nField ? ` (${nField})` : ''}</summary><div class="calc-dd-body">${toggles(FIELD_TOGGLES, cs, 'fieldt')}</div></details></div>
      </div>
      <div class="calc-section"><h4>Side conditions</h4>
        <div class="calc-row" style="grid-template-columns:1fr">${sideDd(0)}</div>
        <div class="calc-row" style="grid-template-columns:1fr">${sideDd(1)}</div>
      </div>
      <div class="calc-section calc-io"><h4>Import / Export (Pokepaste)</h4>
        <textarea id="calc-io-text" placeholder="Paste a set here, then choose which Pokémon to import it into…"></textarea>
        <div class="calc-io-actions">
          <button type="button" class="reset-btn" data-act="import" data-i="0">Import → 1</button>
          <button type="button" class="reset-btn" data-act="import" data-i="1">Import → 2</button>
          <button type="button" class="reset-btn" data-act="export" data-i="0">Export 1</button>
          <button type="button" class="reset-btn" data-act="export" data-i="1">Export 2</button>
        </div>
        <div class="calc-io-msg" id="calc-io-msg"></div>
      </div>`;
  }

  function resBtnHtml(i, m) {
    const mv = cs.sides[i].moves[m], r = cs.results[i][m];
    const sel = cs.detail.side === i && cs.detail.idx === m ? ' selected' : '';
    if (!mv.name) return `<div class="calc-res-btn empty"><span class="res-name">—</span><span></span></div>`;
    let range = '—', ko = '', cls = '';
    if (r) {
      if (r.error) { range = 'error'; }
      else if (r.noDamage) { range = '0 - 0%'; ko = 'no direct damage'; }
      else if (r.immune) { range = '0%'; ko = `no effect (${r.immune})`; }
      else {
        range = `${r.minPct} - ${r.maxPct}%`; ko = r.ko.text;
        cls = r.ko.n === 1 && r.ko.chance >= 1 - 1e-9 ? ' ko1' : r.ko.n === 2 && r.ko.chance >= 1 - 1e-9 ? ' ko2' : '';
      }
    }
    return `<button type="button" class="calc-res-btn${sel}${cls}" data-act="select-move" data-i="${i}" data-m="${m}">
      <span class="res-name">${esc(formatName(mv.name))}</span><span class="res-range">${range}<span class="res-ko">${esc(ko)}</span></span></button>`;
  }

  function renderResults() {
    computeAll();
    const box = root.querySelector('#calc-results');
    if (!cs.sides[0].name || !cs.sides[1].name) {
      box.innerHTML = '';
      root.querySelector('#calc-detail').innerHTML = `<div class="calc-desc" style="font-weight:400;color:var(--text-dim)">Choose two Pokémon and give them some moves to see damage results.</div>`;
      return;
    }
    box.innerHTML = [0, 1].map(i => `<div><h4>${esc(cs.sides[i].label)}'s Moves (select one to show detailed results)</h4>
      <div class="calc-move-results">${[0, 1, 2, 3].map(m => resBtnHtml(i, m)).join('')}</div></div>`).join('');
    let { side, idx } = cs.detail;
    if (!cs.sides[side].moves[idx] || !cs.sides[side].moves[idx].name) {
      const found = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]].find(([a, b]) => cs.sides[a].moves[b].name);
      if (found) { side = found[0]; idx = found[1]; cs.detail = { side, idx }; box.innerHTML = [0, 1].map(i => `<div><h4>${esc(cs.sides[i].label)}'s Moves (select one to show detailed results)</h4><div class="calc-move-results">${[0, 1, 2, 3].map(m => resBtnHtml(i, m)).join('')}</div></div>`).join(''); }
    }
    const r = cs.results[side][idx];
    const det = root.querySelector('#calc-detail');
    if (!r) det.innerHTML = '';
    else if (r.error) det.innerHTML = `<div class="calc-desc">Calculation error: ${esc(r.error)}</div>`;
    else if (r.noDamage) det.innerHTML = `<div class="calc-desc">${esc(formatName(cs.sides[side].moves[idx].name))} does no direct damage.</div>`;
    else {
      det.innerHTML = `<div class="calc-desc">${esc(r.desc)}</div>` +
        (r.possible ? `<div class="calc-rolls">Possible damage amounts: (${r.possible.join(', ')})</div>`
          : `<div class="calc-rolls">Damage per hit: ${r.hitRolls.map(h => `${Math.min(...h)}-${Math.max(...h)}`).join(' + ')}</div>`);
    }
  }

  function renderAll() {
    renderField(); renderPanel(0); renderPanel(1); renderResults(); saveState();
  }

  function buildShell() {
    root.innerHTML = `
      <div class="calc-toolbar">
        <h2>Damage Calculator</h2>
        <div class="game-select-wrap"><label>Game</label>
          <nav class="mode-toggle" id="calc-mode-toggle"><button type="button" class="view-nav-btn" data-mode="champions">Champions</button><button type="button" class="view-nav-btn" data-mode="mainline">Mainline</button></nav>
          <select id="calc-game-select"></select></div>
        <button type="button" class="reset-btn" data-act="swap">⇄ Swap</button>
        <button type="button" class="reset-btn" data-act="reset">Reset</button>
        <span class="calc-status" id="calc-status"></span>
      </div>
      <div class="calc-results" id="calc-results"></div>
      <div class="calc-detail" id="calc-detail"></div>
      <div class="calc-grid">
        <div class="calc-panel" id="calc-panel-0"></div>
        <div class="calc-panel calc-field" id="calc-field"></div>
        <div class="calc-panel" id="calc-panel-1"></div>
      </div>`;
    populateMainlineSelect(root.querySelector('#calc-game-select'));
    wireModeToggle(root.querySelector('#calc-mode-toggle'), root.querySelector('#calc-game-select'), vg => applyGame(vg));
    root.querySelector('#calc-game-select').addEventListener('change', e => applyGame(e.target.value));
  }

  // ---------- pickers ----------
  function pickerOptions(kind, i, m) {
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
    const all = pickerOptions(kind, i, m);
    const current = input.defaultValue;
    const q = input.value.trim().toLowerCase();
    let list = (!q || input.value === current) ? all : all.filter(o => o.label.toLowerCase().includes(q));
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
    else if (p.kind === 'move') setMove(p.i, p.m, o.value);
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
    return true;
  }

  function formatPaste(i) {
    const s = cs.sides[i];
    if (!s.name) return '';
    const lines = [`${s.label}${s.item ? ' @ ' + (itemsForGame(cs.game).find(it => it.slug === s.item) || { name: formatName(s.item) }).name : ''}`];
    if (s.ability) lines.push(`Ability: ${formatName(s.ability)}`);
    if (s.tera) lines.push(`Tera Type: ${formatName(s.tera)}`);
    const ab = { hp: 'HP', attack: 'Atk', defense: 'Def', 'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe' };
    const evs = STAT_KEYS.filter(k => s.evs[k] > 0).map(k => `${s.evs[k]} ${ab[k]}`);
    if (isChampions()) { if (evs.length) lines.push(`# Champions stat points: ${STAT_KEYS.filter(k => s.evs[k] > 0).map(k => `${ab[k]} ${s.evs[k]}`).join(' / ')}`); }
    else if (evs.length) lines.push(`EVs: ${evs.join(' / ')}`);
    lines.push(`${formatName(s.nature)} Nature`);
    if (!isChampions()) { const iv = STAT_KEYS.filter(k => (s.ivs[k] ?? 31) !== 31).map(k => `${s.ivs[k]} ${ab[k]}`); if (iv.length) lines.push(`IVs: ${iv.join(' / ')}`); }
    s.moves.filter(m => m.name).forEach(m => lines.push(`- ${formatName(m.name)}`));
    return lines.join('\n');
  }

  function importInto(i) {
    const msg = root.querySelector('#calc-io-msg');
    const text = root.querySelector('#calc-io-text').value;
    const block = splitPokepasteBlocks(text)[0];
    if (!block) { msg.textContent = 'Paste a set first.'; return; }
    const parsed = parsePokepasteBlock(block);
    const { slot, warnings } = buildSlotFromParsedBlock(parsed, cs.roster, cs.game);
    if (!slot) { msg.textContent = warnings.join(' '); return; }
    loadSlotIntoSide(i, slot, parsed.teraType);
    msg.textContent = `Imported into Pokémon ${i + 1}.` + (warnings.length ? ' ' + warnings.join(' ') : '');
    const keep = msg.textContent;
    renderAll();
    root.querySelector('#calc-io-msg').textContent = keep;
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
      case 'ev': s.evs[k] = Math.max(0, Math.min(caps.perStat, num())); break;
      case 'iv': s.ivs[k] = Math.max(0, Math.min(31, num())); break;
      case 'level': s.level = Math.max(1, Math.min(100, num() || 50)); break;
      case 'mbp': s.moves[m].bp = Math.max(0, num()); break;
      case 'hp-abs': s.curHp = Math.max(1, num()); break;
      case 'hp-pct': { const max = buildMon(i).stats.hp; const p = Math.max(0.1, Math.min(100, num())); s.curHp = p >= 100 ? null : Math.max(1, Math.round(p * max / 100)); break; }
      default: return;
    }
    updateDerived(i); renderResults(); saveState();
  }

  function onChange(e) {
    const t = e.target, f = t.dataset.f; if (!f) return;
    const i = t.dataset.i != null ? +t.dataset.i : null, k = t.dataset.k, m = t.dataset.m != null ? +t.dataset.m : null;
    const s = i != null ? cs.sides[i] : null;
    switch (f) {
      case 'load': if (t.value) loadFromTeam(i, t.value); return;
      case 'type': { const types = s.types.slice(); types[+t.dataset.w] = t.value || undefined; s.types = [types[0], types[1]].filter(Boolean); break; }
      case 'tera': s.tera = t.value || null; break;
      case 'nature': s.nature = t.value; renderPanel(i); break;
      case 'ability': s.ability = t.value; if (s.ability !== 'skill-link') { /* hits unchanged */ } break;
      case 'status': s.status = t.value; break;
      case 'boost': s.boosts[k] = +t.value; break;
      case 'mflag': s.flags[k] = t.checked; break;
      case 'fainted': s.flags.fainted = +t.value; break;
      case 'allmoves': s.allMoves = t.checked; break;
      case 'mtype': s.moves[m].type = t.value; break;
      case 'mcat': s.moves[m].category = t.value; break;
      case 'mhits': s.moves[m].hits = +t.value; break;
      case 'sidec': s.conds[k] = t.checked; break;
      case 'spikes': s.conds.spikes = +t.value; break;
      case 'weather': cs.weather = t.value; break;
      case 'terrain': cs.terrain = t.value; break;
      case 'fieldt': cs[k] = t.checked; break;
      default: return;
    }
    if (['ability', 'item', 'tera', 'status', 'boost', 'mflag', 'fainted', 'type', 'sidec', 'spikes', 'fieldt', 'allmoves', 'weather', 'terrain', 'mtype', 'mcat', 'mhits'].includes(f)) {
      if (['ability', 'allmoves', 'type', 'mflag', 'fainted'].includes(f) && i != null) renderPanel(i);
      if (['sidec', 'spikes', 'fieldt'].includes(f)) renderField();
    }
    if (i != null) updateDerived(i);
    if (f === 'sidec' || f === 'spikes') { /* tailwind affects speed of that side */ updateDerived(0); updateDerived(1); }
    renderResults(); saveState();
  }

  function onClick(e) {
    const pick = e.target.closest('[data-pick]');
    if (pick) { applyPick(+pick.dataset.pick); return; }
    const fmt = e.target.closest('[data-format]');
    if (fmt) { cs.format = fmt.dataset.format; renderField(); renderResults(); saveState(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const i = act.dataset.i != null ? +act.dataset.i : null, m = act.dataset.m != null ? +act.dataset.m : null;
    switch (act.dataset.act) {
      case 'crit': { const mv = cs.sides[i].moves[m]; mv.crit = !mv.crit; act.classList.toggle('active', mv.crit); renderResults(); saveState(); break; }
      case 'select-move': cs.detail = { side: i, idx: m }; renderResults(); break;
      case 'swap': cs.sides.reverse(); cs.detail = { side: 1 - cs.detail.side, idx: cs.detail.idx }; renderAll(); break;
      case 'reset': cs.sides = [makeSide(), makeSide()]; cs.weather = ''; cs.terrain = ''; cs.gravity = cs.magicRoom = cs.wonderRoom = false; renderAll(); break;
      case 'import': importInto(i); break;
      case 'export': { const txt = formatPaste(i); root.querySelector('#calc-io-text').value = txt; root.querySelector('#calc-io-msg').textContent = txt ? `Exported Pokémon ${i + 1}.` : 'Nothing to export yet.'; break; }
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
  window.__calc = { cs, buildMon, engineMove, engineField, computeAll, setSideSpecies, setMove, applyGame, renderAll };
})();
