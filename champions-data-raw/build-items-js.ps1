$ErrorActionPreference = "Stop"
$root = "C:\Users\mweckerle\Documents\Claude\pokemon-search-app"
$raw = Get-Content (Join-Path $root "champions-data-raw\pokeapi-items-raw.json") -Raw | ConvertFrom-Json

# Categories that are technically flagged "holdable" in PokeAPI but aren't genuine
# competitive held items (poke balls, key items, consumable field items, etc).
$excludeCategories = @(
  'standard-balls','special-balls','apricorn-balls','collectibles','evolution','spelunking',
  'dex-completion','curry-ingredients','sandwich-ingredients','tm-materials','picnic',
  'species-candies','mulch','data-cards','apricorn-box','all-mail','all-machines',
  'event-items','gameplay','plot-advancement','unused','loot','tera-shard',
  'dynamax-crystals','flutes','miracle-shooter','nature-mints','stat-boosts'
)
$genNumber = @{
  'generation-i'=1; 'generation-ii'=2; 'generation-iii'=3; 'generation-iv'=4; 'generation-v'=5;
  'generation-vi'=6; 'generation-vii'=7; 'generation-viii'=8; 'generation-ix'=9;
}

function Add-Items($items, $out) {
  foreach ($item in $items) {
    $cat = $item.pokemon_v2_itemcategory.name
    if ($excludeCategories -contains $cat) { continue }
    $effect = if ($item.pokemon_v2_itemeffecttexts.Count -gt 0) { $item.pokemon_v2_itemeffecttexts[0].short_effect } else { '' }
    $gens = @($item.pokemon_v2_itemgameindices | ForEach-Object {
      $gname = $_.pokemon_v2_generation.name
      if ($genNumber.ContainsKey($gname)) { $genNumber[$gname] } else { $null }
    } | Where-Object { $_ -ne $null })
    $minGen = if ($gens.Count -gt 0) { ($gens | Measure-Object -Minimum).Minimum } else { 1 }

    $out[$item.name] = [ordered]@{
      category = $cat
      effect = $effect
      minGen = $minGen
    }
  }
}

$out = [ordered]@{}
Add-Items $raw.data.pokemon_v2_item $out

# Mega stones aren't flagged "holdable" in PokeAPI (a data quirk) so they're fetched
# separately and merged in here — otherwise every mainline-game mega form would be
# unreachable from the team builder's item picker.
$megaRaw = Get-Content (Join-Path $root "champions-data-raw\pokeapi-megastones-raw.json") -Raw | ConvertFrom-Json
Add-Items $megaRaw.data.pokemon_v2_item $out

"Total included items: $($out.Count)"
$json = $out | ConvertTo-Json -Depth 5 -Compress
$outPath = Join-Path $root "general-items.data.js"
"window.GENERAL_ITEMS_DATA = $json;" | Out-File $outPath -Encoding utf8 -NoNewline
"Wrote $outPath ($((Get-Item $outPath).Length) bytes)"
