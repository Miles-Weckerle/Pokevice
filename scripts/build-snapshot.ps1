param(
  [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data'),
  [string]$CacheDir = (Join-Path ([System.IO.Path]::GetTempPath()) 'pokeapi-csv'),
  [switch]$UseCache      # reuse previously downloaded CSVs instead of re-downloading
)
# Builds the offline PokeAPI snapshot the app loads instead of calling PokeAPI at runtime.
# Source: the raw CSV tables PokeAPI itself is generated from (github.com/PokeAPI/pokeapi).
# Output: data/snapshot-core.js (moves, abilities, Pokemon table, evolutions) and one data/games/<game>.js per game.
# Works on Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
$base = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv'
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
New-Item -ItemType Directory -Force -Path $CacheDir, $OutDir, (Join-Path $OutDir 'games') | Out-Null

# Same order the app uses to decide which game's data is "most recent" for the National Dex.
$recencyOrder = @('the-indigo-disk','the-teal-mask','scarlet-violet','brilliant-diamond-and-shining-pearl','the-crown-tundra','the-isle-of-armor','sword-shield',
  'lets-go-pikachu-lets-go-eevee','ultra-sun-ultra-moon','sun-moon','omega-ruby-alpha-sapphire','x-y','black-2-white-2','black-white',
  'heartgold-soulsilver','platinum','diamond-pearl','xd','colosseum','firered-leafgreen','emerald','ruby-sapphire','crystal','gold-silver',
  'yellow','red-blue','red-green-japan','blue-japan')

function Get-CsvPath($name) {
  $path = Join-Path $CacheDir "$name.csv"
  if ($UseCache -and (Test-Path $path)) { return $path }
  for ($try = 1; $try -le 4; $try++) {
    try { Invoke-WebRequest -Uri "$base/$name.csv" -OutFile $path -UseBasicParsing -TimeoutSec 180; return $path }
    catch { if ($try -eq 4) { throw "Could not download $name.csv: $($_.Exception.Message)" }; Start-Sleep -Seconds (3 * $try) }
  }
}
function Read-Csv($name) { Import-Csv -Path (Get-CsvPath $name) -Encoding UTF8 }
function Js($s) {
  if ($null -eq $s) { return 'null' }
  '"' + ([string]$s).Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '\n') + '"'
}
function NumOrNull($v) { if ($null -eq $v -or $v -eq '') { 'null' } else { [string][int]$v } }

Write-Host 'Downloading tables...'
$types = @{}; foreach ($r in Read-Csv 'types') { $types[[int]$r.id] = $r.identifier }
$classes = @{}; foreach ($r in Read-Csv 'move_damage_classes') { $classes[[int]$r.id] = $r.identifier }
$targets = @{}; foreach ($r in Read-Csv 'move_targets') { $targets[[int]$r.id] = $r.identifier }
$flagNames = @{}; foreach ($r in Read-Csv 'move_flags') { $flagNames[[int]$r.id] = $r.identifier }

# ---------- moves ----------
$effectText = @{}
foreach ($r in Read-Csv 'move_effect_prose') { if ($r.local_language_id -eq '9') { $effectText[[int]$r.move_effect_id] = $r.short_effect } }
$meta = @{}; foreach ($r in Read-Csv 'move_meta') { $meta[[int]$r.move_id] = $r }
$moveFlags = @{}
foreach ($r in Read-Csv 'move_flag_map') {
  $id = [int]$r.move_id; if (-not $moveFlags.ContainsKey($id)) { $moveFlags[$id] = New-Object System.Collections.ArrayList }
  [void]$moveFlags[$id].Add($flagNames[[int]$r.move_flag_id])
}
$moveSlugById = @{}
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('window.SNAPSHOT_CORE = { moves: {')
$moveRows = @(Read-Csv 'moves' | Sort-Object { [int]$_.id })
$i = 0
foreach ($m in $moveRows) {
  $i++; $id = [int]$m.id; $moveSlugById[$id] = $m.identifier
  $mt = $meta[$id]
  $eff = ''
  if ($m.effect_id -ne '' -and $effectText.ContainsKey([int]$m.effect_id)) { $eff = $effectText[[int]$m.effect_id] }
  if ($eff -and $m.effect_chance -ne '') { $eff = $eff.Replace('$effect_chance', $m.effect_chance) }
  $flags = if ($moveFlags.ContainsKey($id)) { ($moveFlags[$id] | Sort-Object) -join ',' } else { '' }
  $minH = if ($mt) { NumOrNull $mt.min_hits } else { 'null' }
  $maxH = if ($mt) { NumOrNull $mt.max_hits } else { 'null' }
  $drain = if ($mt -and $mt.drain -ne '') { [int]$mt.drain } else { 0 }
  $row = '[' + $id + ',' + (Js $types[[int]$m.type_id]) + ',' + (Js $classes[[int]$m.damage_class_id]) + ',' + (NumOrNull $m.power) + ',' + (NumOrNull $m.accuracy) + ',' +
    (NumOrNull $m.pp) + ',' + [int]$m.priority + ',' + (NumOrNull $m.effect_chance) + ',' + (Js $targets[[int]$m.target_id]) + ',' + $minH + ',' + $maxH + ',' + $drain + ',' + (Js $flags) + ',' + (Js $eff) + ']'
  [void]$sb.Append((Js $m.identifier) + ':' + $row)
  if ($i -lt $moveRows.Count) { [void]$sb.AppendLine(',') } else { [void]$sb.AppendLine() }
}
[void]$sb.AppendLine('},')
Write-Host "Moves: $($moveRows.Count)"

# ---------- abilities ----------
$abilityText = @{}
foreach ($r in Read-Csv 'ability_prose') { if ($r.local_language_id -eq '9') { $abilityText[[int]$r.ability_id] = $r.short_effect } }
$abilityNameById = @{}
$abRows = @(Read-Csv 'abilities' | Sort-Object { [int]$_.id })
[void]$sb.AppendLine('abilities: {')
$i = 0
foreach ($a in $abRows) {
  $i++; $abilityNameById[[int]$a.id] = $a.identifier
  $t = if ($abilityText.ContainsKey([int]$a.id)) { $abilityText[[int]$a.id] } else { '' }
  [void]$sb.Append((Js $a.identifier) + ':[' + [int]$a.generation_id + ',' + (Js $t) + ']')
  if ($i -lt $abRows.Count) { [void]$sb.AppendLine(',') } else { [void]$sb.AppendLine() }
}
[void]$sb.AppendLine('},')
Write-Host "Abilities: $($abRows.Count)"

# ---------- Pokemon table + evolutions ----------
$species = @{}; foreach ($r in Read-Csv 'pokemon_species') { $species[[int]$r.id] = $r }
$pokemonRows = @(Read-Csv 'pokemon' | Sort-Object { [int]$_.id })
$pokemonById = @{}
[void]$sb.AppendLine('pokemon: {')
$i = 0
foreach ($p in $pokemonRows) {
  $i++; $id = [int]$p.id; $pokemonById[$id] = $p
  [void]$sb.Append((Js $p.identifier) + ':[' + $id + ',' + [int]$p.species_id + ',' + [int]$p.weight + ']')
  if ($i -lt $pokemonRows.Count) { [void]$sb.AppendLine(',') } else { [void]$sb.AppendLine() }
}
[void]$sb.AppendLine('},')
[void]$sb.Append('evolvesFrom: {')
$evo = @($species.Values | Where-Object { $_.evolves_from_species_id -ne '' } | Sort-Object { [int]$_.id } | ForEach-Object { '"' + $_.id + '":' + [int]$_.evolves_from_species_id })
[void]$sb.Append(($evo -join ','))
[void]$sb.AppendLine('},')
Write-Host "Pokemon: $($pokemonRows.Count), evolutions: $($evo.Count)"

# ---------- per-game data ----------
$statsByPokemon = @{}   # id -> int[6] in hp,atk,def,spa,spd,spe order
foreach ($r in Read-Csv 'pokemon_stats') {
  $id = [int]$r.pokemon_id; if (-not $statsByPokemon.ContainsKey($id)) { $statsByPokemon[$id] = New-Object int[] 6 }
  $statsByPokemon[$id][[int]$r.stat_id - 1] = [int]$r.base_stat
}
$typesByPokemon = @{}
foreach ($r in (Read-Csv 'pokemon_types' | Sort-Object { [int]$_.slot })) {
  $id = [int]$r.pokemon_id; if (-not $typesByPokemon.ContainsKey($id)) { $typesByPokemon[$id] = New-Object System.Collections.ArrayList }
  [void]$typesByPokemon[$id].Add($types[[int]$r.type_id])
}
$abilitiesByPokemon = @{}
foreach ($r in (Read-Csv 'pokemon_abilities' | Sort-Object { [int]$_.slot })) {
  $id = [int]$r.pokemon_id; if (-not $abilitiesByPokemon.ContainsKey($id)) { $abilitiesByPokemon[$id] = New-Object System.Collections.ArrayList }
  [void]$abilitiesByPokemon[$id].Add('[' + (Js $abilityNameById[[int]$r.ability_id]) + ',' + [int]$r.is_hidden + ']')
}
$vgName = @{}
foreach ($r in Read-Csv 'version_groups') {
  $n = $r.identifier
  if ($n -eq 'brilliant-diamond-shining-pearl') { $n = 'brilliant-diamond-and-shining-pearl' }   # the app uses PokeAPI's live-API spelling
  $vgName[[int]$r.id] = $n
}
$methodBucket = @{}
foreach ($r in Read-Csv 'pokemon_move_methods') {
  $methodBucket[[int]$r.id] = switch ($r.identifier) { 'level-up' { 0 } 'machine' { 1 } 'egg' { 2 } 'tutor' { 3 } default { 4 } }
}

Write-Host 'Reading learnsets (large)...'
# games[vg][pokemonId] = array of 5 hashtables (bucket -> moveId -> level)
$games = @{}
$reader = New-Object System.IO.StreamReader((Get-CsvPath 'pokemon_moves'), [System.Text.Encoding]::UTF8)
[void]$reader.ReadLine()
$rowCount = 0
while ($null -ne ($line = $reader.ReadLine())) {
  if ($line.Length -eq 0) { continue }
  $f = $line.Split(',')
  $pkId = [int]$f[0]; $vg = [int]$f[1]; $mid = [int]$f[2]; $bucket = $methodBucket[[int]$f[3]]
  $lvl = if ($bucket -eq 0 -and $f[4] -ne '') { [int]$f[4] } else { 0 }
  if (-not $games.ContainsKey($vg)) { $games[$vg] = @{} }
  $g = $games[$vg]
  if (-not $g.ContainsKey($pkId)) { $g[$pkId] = @(@{}, @{}, @{}, @{}, @{}) }
  $h = $g[$pkId][$bucket]
  if (-not $h.ContainsKey($mid) -or $lvl -lt $h[$mid]) { $h[$mid] = $lvl }
  $rowCount++
}
$reader.Close()
Write-Host "Learnset rows: $rowCount across $($games.Count) version groups"

function Record-Text($pkId, $buckets) {
  $st = $statsByPokemon[$pkId]; $p = $pokemonById[$pkId]
  $parts = @()
  for ($b = 0; $b -lt 5; $b++) {
    $keys = @($buckets[$b].Keys | Sort-Object)
    if ($b -eq 0) { $parts += '[' + (($keys | ForEach-Object { [int]$_ * 128 + [int]$buckets[0][$_] }) -join ',') + ']' }
    else { $parts += '[' + ($keys -join ',') + ']' }
  }
  '[' + $pkId + ',' + (Js $p.identifier) + ',' + [int]$p.species_id + ',[' + ($st -join ',') + '],[' + (($typesByPokemon[$pkId] | ForEach-Object { Js $_ }) -join ',') + '],[' +
    ($abilitiesByPokemon[$pkId] -join ',') + '],' + ($parts -join ',') + ']'
}

$bestVg = @{}   # pokemonId -> @{rank; vgId}
$outFiles = New-Object System.Collections.ArrayList
foreach ($vg in ($games.Keys | Sort-Object)) {
  $name = $vgName[[int]$vg]
  if ($name -eq 'champions') { continue }   # the app uses fresher pokebase.app data for Champions
  $recs = New-Object System.Collections.ArrayList
  foreach ($pkId in ($games[$vg].Keys | Sort-Object)) {
    if (-not $statsByPokemon.ContainsKey($pkId)) { continue }
    [void]$recs.Add((Record-Text $pkId $games[$vg][$pkId]))
    $rank = [Array]::IndexOf($recencyOrder, $name)
    if ($rank -ge 0 -and (-not $bestVg.ContainsKey($pkId) -or $rank -lt $bestVg[$pkId].rank)) { $bestVg[$pkId] = @{ rank = $rank; vg = $vg } }
  }
  $text = 'window.SNAPSHOT_GAMES = window.SNAPSHOT_GAMES || {};' + "`n" + 'window.SNAPSHOT_GAMES[' + (Js $name) + '] = [' + "`n" + ($recs -join ",`n") + "`n" + '];' + "`n"
  [System.IO.File]::WriteAllText((Join-Path $OutDir "games/$name.js"), $text, $utf8Bom)
  [void]$outFiles.Add($name)
  Write-Host ("  {0}: {1} Pokemon" -f $name, $recs.Count)
}

# National Dex: each Pokemon's data from the most recent (non-excluded) game it appears in.
$nat = New-Object System.Collections.ArrayList
foreach ($pkId in ($bestVg.Keys | Sort-Object)) { [void]$nat.Add((Record-Text $pkId $games[$bestVg[$pkId].vg][$pkId])) }
$text = 'window.SNAPSHOT_GAMES = window.SNAPSHOT_GAMES || {};' + "`n" + 'window.SNAPSHOT_GAMES["national-dex"] = [' + "`n" + ($nat -join ",`n") + "`n" + '];' + "`n"
[System.IO.File]::WriteAllText((Join-Path $OutDir 'games/national-dex.js'), $text, $utf8Bom)
[void]$outFiles.Add('national-dex')
Write-Host "National Dex: $($nat.Count) Pokemon"

# ---------- finish core ----------
[void]$sb.AppendLine('games: [' + (($outFiles | ForEach-Object { Js $_ }) -join ',') + '],')
[void]$sb.AppendLine('generatedAt: ' + (Js ((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')))  + ',')
[void]$sb.AppendLine('source: "github.com/PokeAPI/pokeapi data/v2/csv" };')
[System.IO.File]::WriteAllText((Join-Path $OutDir 'snapshot-core.js'), $sb.ToString(), $utf8Bom)
Write-Host 'Done.'
