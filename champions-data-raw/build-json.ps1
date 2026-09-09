$ErrorActionPreference = "Stop"
$base = "C:\Users\mweckerle\Documents\Claude\pokemon-search-app\champions-data-raw\battle_data"
$outPath = "C:\Users\mweckerle\Documents\Claude\pokemon-search-app\champions-usage.json"

# Explicit overrides for names that don't auto-normalize to their PokeAPI slug.
$overrides = @{
  "Aegislash Shield Forme"       = "aegislash-shield"
  "Florges Red Flower"           = "florges"
  "Furfrou Natural Form"         = "furfrou"
  "Gourgeist"                    = "gourgeist-average"
  "Gourgeist Jumbo Variety"      = "gourgeist-super"
  "Gourgeist Large Variety"      = "gourgeist-large"
  "Gourgeist Small Variety"      = "gourgeist-small"
  "Lycanroc"                     = "lycanroc-midday"
  "Lycanroc Dusk Form"           = "lycanroc-dusk"
  "Lycanroc Midnight Form"       = "lycanroc-midnight"
  "Maushold"                     = "maushold-family-of-four"
  "Meowstic"                     = "meowstic-male"
  "Mimikyu"                      = "mimikyu-disguised"
  "Morpeko"                      = "morpeko-full-belly"
  "Palafin Zero Form"            = "palafin-zero"
  "Paldean Tauros Aqua Breed"    = "tauros-paldea-aqua-breed"
  "Paldean Tauros Blaze Breed"   = "tauros-paldea-blaze-breed"
  "Paldean Tauros Combat Breed"  = "tauros-paldea-combat-breed"
  "Vivillon Fancy Pattern"       = "vivillon"
}

function Normalize-ChampName($raw) {
  if ($overrides.ContainsKey($raw)) { return $overrides[$raw] }
  $s = $raw
  $prefixMap = [ordered]@{ "Alolan " = "-alola"; "Galarian " = "-galar"; "Hisuian " = "-hisui" }
  $base2 = $s
  $suffix = ""
  foreach ($p in $prefixMap.Keys) {
    if ($base2.StartsWith($p)) {
      $base2 = $base2.Substring($p.Length)
      $suffix = $prefixMap[$p]
    }
  }
  $slug = ($base2 -replace "[.']", "" -replace "\s+", "-").ToLower()
  return "$slug$suffix"
}

function Parse-Format($csvPath) {
  $rows = Import-Csv $csvPath
  $result = [ordered]@{
    moves = @()
    items = @()
    teammates = @()
    abilities = @()
    natures = @()
    evSpreads = @()
  }
  foreach ($row in $rows) {
    switch ($row.category) {
      "move" { $result.moves += [ordered]@{ name = $row.name; pct = $row.percentage } }
      "held_item" { $result.items += [ordered]@{ name = $row.name; pct = $row.percentage } }
      "teammate" { $result.teammates += [ordered]@{ name = $row.name; pct = $row.percentage } }
      "ability" { $result.abilities += [ordered]@{ name = $row.name; pct = $row.percentage } }
      "stat_alignment" { $result.natures += [ordered]@{ name = $row.name; pct = $row.percentage; up = $row.stat_up; down = $row.stat_down } }
      "stat_points" {
        $result.evSpreads += [ordered]@{
          pct = $row.percentage
          hp = $row.hp_points; atk = $row.attack_points; def = $row.defense_points
          spa = $row.sp_atk_points; spd = $row.sp_def_points; spe = $row.speed_points
        }
      }
    }
  }
  return $result
}

$singlesFiles = Get-ChildItem "$base\Singles" -Filter *.csv
$out = [ordered]@{}
$unmatchedLog = @()

foreach ($f in $singlesFiles) {
  $rawName = $f.BaseName
  $slug = Normalize-ChampName $rawName
  $doublesPath = Join-Path "$base\Doubles" $f.Name

  $entry = [ordered]@{
    displayName = $rawName
    singles = Parse-Format $f.FullName
    doubles = if (Test-Path $doublesPath) { Parse-Format $doublesPath } else { $null }
  }
  $out[$slug] = $entry
}

$out | ConvertTo-Json -Depth 8 -Compress | Out-File $outPath -Encoding utf8
"Wrote $outPath"
"Entries: $($out.Count)"
(Get-Item $outPath).Length
