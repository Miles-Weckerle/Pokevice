$ErrorActionPreference = "Stop"
$root = "C:\Users\mweckerle\Documents\Claude\pokemon-search-app"
$raw = Get-Content (Join-Path $root "champions-data-raw\champions-items-raw.json") -Raw | ConvertFrom-Json

function Slugify($name) {
  $s = $name.ToLower() -replace "'", "" -replace "[^a-z0-9]+", "-" -replace "^-|-$", ""
  return $s
}

$out = [ordered]@{}
foreach ($prop in $raw.PSObject.Properties) {
  $slug = Slugify $prop.Name
  $out[$slug] = [ordered]@{
    displayName = $prop.Name
    category = $prop.Value[0]
    effect = $prop.Value[1]
  }
}

"Total Champions items: $($out.Count)"
$json = $out | ConvertTo-Json -Depth 5 -Compress
$outPath = Join-Path $root "champions-items.data.js"
"window.CHAMPIONS_ITEMS_DATA = $json;" | Out-File $outPath -Encoding utf8 -NoNewline
"Wrote $outPath ($((Get-Item $outPath).Length) bytes)"
