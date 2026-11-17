# Tiny static file server for local testing:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8934]
# (The app also works by just double-clicking index.html; this is only for tools that need http://.)
param([int]$Port = 8934)

# tools that assign a port (preview panes) pass it in the PORT environment variable
if (-not $PSBoundParameters.ContainsKey('Port') -and $env:PORT -match '^\d+$') { $Port = [int]$env:PORT }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.mjs' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.csv' = 'text/csv; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.map' = 'application/json'; '.webmanifest' = 'application/manifest+json'
}

# Already running? Say so instead of dying with an obscure error.
$busy = $false
try { $probe = [System.Net.Sockets.TcpClient]::new(); $probe.Connect('127.0.0.1', $Port); $probe.Close(); $busy = $true } catch { }
if ($busy) { Write-Host "Port $Port is already in use - a server is probably already running at http://localhost:$Port/"; exit 0 }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch { Write-Host "Could not start the listener: $($_.Exception.Message)"; exit 2 }
Write-Host "Serving $root on http://localhost:$Port/"

while ($listener.IsListening) {
  $context = $null
  try { $context = $listener.GetContext() } catch { Start-Sleep -Milliseconds 100; continue }   # a dropped connection must never end the server
  $res = $context.Response
  try {
    $path = [System.Uri]::UnescapeDataString($context.Request.Url.LocalPath)
    if ($path -eq '/') { $path = '/index.html' }
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', '\')))
    if (-not $filePath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
    } elseif (Test-Path -LiteralPath $filePath -PathType Leaf) {
      $ct = $mime[[System.IO.Path]::GetExtension($filePath).ToLowerInvariant()]
      if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $res.ContentType = $ct
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $bytes.Length
      if ($context.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
  }
}
