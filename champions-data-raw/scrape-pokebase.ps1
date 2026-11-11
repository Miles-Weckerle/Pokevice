param(
  [string]$Only = '',          # comma-separated slugs to scrape instead of the whole roster
  [switch]$DryRun,             # scrape + validate but don't write files
  [switch]$Verbose2,           # print a field-level diff for every changed existing entry
  [int]$DelayMs = 250
)
# Scrapes https://pokebase.app/pokemon-champions into pokebase-dex.json / pokebase-dex.data.js.
# Works on Windows PowerShell 5.1 and PowerShell 7. Existing entries are replaced per-slug, never wholesale.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsonPath = Join-Path $dir 'pokebase-dex.json'
$jsPath = Join-Path $dir 'pokebase-dex.data.js'
$ua = 'Mozilla/5.0 (compatible; PokeviceDataRefresh/1.0)'
$utf8Bom = New-Object System.Text.UTF8Encoding($true)

function Get-Page($url) {
  for ($try = 1; $try -le 3; $try++) {
    try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -UserAgent $ua -TimeoutSec 60).Content }
    catch { if ($try -eq 3) { throw }; Start-Sleep -Seconds (2 * $try) }
  }
}
function Decode($s) { [System.Net.WebUtility]::HtmlDecode($s).Replace([string][char]0x2019, "'").Trim() }

# slug -> existing one-line JSON entry (file layout: one entry per line)
$existing = [ordered]@{}
foreach ($l in (Get-Content $jsonPath -Encoding UTF8)) {
  $m = [regex]::Match($l, '^"([a-z0-9-]+)":\s*(\{.*\})\s*,?\s*$')
  if ($m.Success) { $existing[$m.Groups[1].Value] = $m.Groups[2].Value }
}
"Existing entries: $($existing.Count)"

function Get-HiddenFlags($slug, $abilityNames) {
  # existing flag by ability name wins; otherwise PokeAPI; otherwise "last of three is hidden"
  $flags = @{}
  if ($existing.Contains($slug)) {
    foreach ($m in [regex]::Matches($existing[$slug], '\{"name":"([^"]+)","isHidden":(true|false)\}')) { $flags[$m.Groups[1].Value] = ($m.Groups[2].Value -eq 'true') }
  }
  if (($abilityNames | Where-Object { -not $flags.ContainsKey($_) }).Count -eq 0) { return $flags }
  try {
    $raw = (Invoke-WebRequest -Uri "https://pokeapi.co/api/v2/pokemon/$slug" -UseBasicParsing -TimeoutSec 30).Content
    foreach ($m in [regex]::Matches($raw, '"ability":\{"name":"([a-z0-9-]+)"[^}]*\},"is_hidden":(true|false)')) {
      $disp = (($m.Groups[1].Value -split '-' | ForEach-Object { if ($_) { $_.Substring(0,1).ToUpper() + $_.Substring(1) } }) -join ' ')
      foreach ($n in $abilityNames) { if (-not $flags.ContainsKey($n) -and ($n -replace '[^A-Za-z0-9]','').ToLower() -eq ($m.Groups[1].Value -replace '-','')) { $flags[$n] = ($m.Groups[2].Value -eq 'true') } }
    }
  } catch { }
  for ($i = 0; $i -lt $abilityNames.Count; $i++) {
    if (-not $flags.ContainsKey($abilityNames[$i])) { $flags[$abilityNames[$i]] = ($abilityNames.Count -eq 3 -and $i -eq 2) }
  }
  return $flags
}

function Parse-Entry($slug) {
  $html = Get-Page "https://pokebase.app/pokemon-champions/pokemon/$slug"
  $u = $html.Replace('\"', '"')
  $name = Decode ([regex]::Match($html, '<h1[^>]*>([^<]+)</h1>').Groups[1].Value)
  if (-not $name) { throw 'no <h1>' }

  $typeBlock = [regex]::Match($html, 'aria-label="Types">(.*?)</ul>').Groups[1].Value
  $types = @([regex]::Matches($typeBlock, '<span class="pt-px">([^<]+)</span>') | ForEach-Object { Decode $_.Groups[1].Value })
  if ($types.Count -lt 1 -or $types.Count -gt 2) { throw "bad types ($($types.Count))" }

  $stats = [ordered]@{}
  foreach ($pair in @(@('HP','hp'),@('Atk','attack'),@('Def','defense'),@('SpA','specialAttack'),@('SpD','specialDefense'),@('Spe','speed'))) {
    $m = [regex]::Match($html, '>' + $pair[0] + '</th><td[^>]*>(\d+)</td>')
    if (-not $m.Success) { throw "missing stat $($pair[0])" }
    $stats[$pair[1]] = [int]$m.Groups[1].Value
  }

  $abBlock = [regex]::Match($html, 'aria-label="Abilities">(.*?)</ul>').Groups[1].Value
  $abNames = @([regex]::Matches($abBlock, 'href="/pokemon-champions/abilities/[a-z0-9-]+"[^>]*>([^<]+)</a>') | ForEach-Object { Decode $_.Groups[1].Value })
  if ($abNames.Count -lt 1) { throw 'no abilities' }
  $flags = Get-HiddenFlags $slug $abNames
  $abilities = @($abNames | ForEach-Object { [ordered]@{ name = $_; isHidden = ($abNames.Count -gt 1 -and [bool]$flags[$_]) } })

  $moveSet = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($m in [regex]::Matches($u, '\{"name":"([^"]+)","slug":"[a-z0-9-]+","type":\{')) { [void]$moveSet.Add((Decode $m.Groups[1].Value)) }
  $declared = [regex]::Match($html, '(\d+)(?:<!--[^>]*-->|\s)*moves?(?:<!--[^>]*-->|\s)*it can learn')
  if (-not $declared.Success) { throw 'no declared move count' }
  if ($moveSet.Count -ne [int]$declared.Groups[1].Value) { throw "move count mismatch: found $($moveSet.Count), page says $($declared.Groups[1].Value)" }
  $moves = [string[]]$moveSet
  [Array]::Sort($moves, [StringComparer]::OrdinalIgnoreCase)

  $obj = [ordered]@{ displayName = $name; types = $types; stats = $stats; abilities = $abilities; moves = $moves }
  return (($obj | ConvertTo-Json -Compress -Depth 6).Replace(([string][char]92 + 'u0027'), [string][char]39))
}

# Roster
if ($Only) { $slugs = $Only -split ',' }
else {
  $roster = Get-Page 'https://pokebase.app/pokemon-champions/pokemon'
  $slugs = @([regex]::Matches($roster, 'href="/pokemon-champions/pokemon/([a-z0-9-]+)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  if ($slugs.Count -lt 250) { throw "roster looks wrong ($($slugs.Count) slugs); refusing to continue" }
}
"Roster slugs to scrape: $($slugs.Count)"

$results = [ordered]@{}; $failures = @(); $n = 0
foreach ($slug in $slugs) {
  $n++
  try { $results[$slug] = Parse-Entry $slug }
  catch { $failures += "$slug : $($_.Exception.Message)"; Write-Host "[$n/$($slugs.Count)] FAIL $slug - $($_.Exception.Message)" }
  if ($n % 25 -eq 0) { Write-Host "[$n/$($slugs.Count)] ok so far: $($results.Count)" }
  Start-Sleep -Milliseconds $DelayMs
}

# Merge + validate
$merged = [ordered]@{}
foreach ($k in $existing.Keys) { $merged[$k] = $existing[$k] }
function Diff-Entry($old, $new) {
  $out = @()
  foreach ($f in 'displayName','types','stats','abilities') {
    $o = [regex]::Match($old, '"' + $f + '":(\[[^\]]*\]|\{[^\}]*\}|"[^"]*")').Groups[1].Value
    $n = [regex]::Match($new, '"' + $f + '":(\[[^\]]*\]|\{[^\}]*\}|"[^"]*")').Groups[1].Value
    if ($o -ne $n) { $out += "$f $o -> $n" }
  }
  $om = @([regex]::Matches([regex]::Match($old, '"moves":\[([^\]]*)\]').Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  $nm = @([regex]::Matches([regex]::Match($new, '"moves":\[([^\]]*)\]').Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  $rm = @($om | Where-Object { $nm -notcontains $_ }); $ad = @($nm | Where-Object { $om -notcontains $_ })
  if ($rm.Count) { $out += "moves removed: $($rm -join ', ')" }
  if ($ad.Count) { $out += "moves added: $($ad -join ', ')" }
  return $out
}
$added = @(); $changed = 0
foreach ($k in $results.Keys) {
  if (-not $merged.Contains($k)) { $added += $k }
  elseif ($merged[$k] -ne $results[$k]) { $changed++; if ($Verbose2) { "  CHANGED ${k}:"; Diff-Entry $merged[$k] $results[$k] | ForEach-Object { "    $_" } } }
  $merged[$k] = $results[$k]
}
$notOnSite = @(); if (-not $Only) { $notOnSite = @($existing.Keys | Where-Object { $slugs -notcontains $_ }) }
if ($notOnSite.Count -gt 10) { throw "$($notOnSite.Count) entries vanished from the roster; refusing to prune ($($notOnSite -join ', '))" }
foreach ($k in $notOnSite) { $merged.Remove($k) }
"Updated: $changed | Added: $($added.Count) ($($added -join ', ')) | Failed: $($failures.Count) | Pruned (no longer on site): $($notOnSite -join ', ')"
if ($failures.Count) { $failures | ForEach-Object { "  FAIL $_" } }

if ($merged.Count -lt [Math]::Floor($existing.Count * 0.9)) { throw 'entry count collapsed; not writing' }
if ($merged.Contains('incineroar') -and $merged['incineroar'] -match '"Knock Off"') { throw 'canary failed: Incineroar has Knock Off; not writing' }
if (-not $Only -and $failures.Count -gt [Math]::Max(5, $slugs.Count * 0.05)) { throw 'too many failures; not writing' }
if ($DryRun) { 'Dry run: nothing written.'; return }

$lines = @($merged.Keys | ForEach-Object { '"' + $_ + '": ' + $merged[$_] })
$json = "{`n" + ($lines -join ",`n") + "`n}`n"
[System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))
$js = 'window.CHAMPIONS_DEX_DATA = ' + ($json.TrimEnd() -replace "`n", ' ') + ' ;'
[System.IO.File]::WriteAllText($jsPath, $js, $utf8Bom)
"Wrote $($merged.Count) entries."
