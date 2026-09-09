$ErrorActionPreference = "Stop"
$root = "C:\Users\mweckerle\Documents\Claude\pokemon-search-app"

$usageJson = Get-Content (Join-Path $root "champions-usage.json") -Raw
$usageOut = "window.CHAMPIONS_USAGE_DATA = $usageJson;"
$usageOut | Out-File (Join-Path $root "champions-usage.data.js") -Encoding utf8 -NoNewline
"Wrote champions-usage.data.js ($((Get-Item (Join-Path $root "champions-usage.data.js")).Length) bytes)"

$dexJson = Get-Content (Join-Path $root "champions-data-raw\pokebase-dex.json") -Raw
$dexOut = "window.CHAMPIONS_DEX_DATA = $dexJson;"
$dexOut | Out-File (Join-Path $root "champions-data-raw\pokebase-dex.data.js") -Encoding utf8 -NoNewline
"Wrote pokebase-dex.data.js ($((Get-Item (Join-Path $root "champions-data-raw\pokebase-dex.data.js")).Length) bytes)"
