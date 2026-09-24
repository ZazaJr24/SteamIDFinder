# Tiny local web server for the game folder (no installation needed).
$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [System.IO.Path]::GetFullPath((Join-Path $base 'game'))
$port = 8080
$listener = $null
while ($true) {
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
    break
  } catch {
    $port++
    if ($port -gt 8120) { Write-Host 'No free port found.'; exit 1 }
  }
}
$url = "http://localhost:$port/"
Write-Host "CubeCraft Legends is running at $url"
Start-Process $url
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.mjs' = 'text/javascript'
  '.css' = 'text/css'; '.json' = 'application/json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
  '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain'
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $type = $mime[[System.IO.Path]::GetExtension($full).ToLower()]
      if (-not $type) { $type = 'application/octet-stream' }
      $ctx.Response.ContentType = $type
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  } finally {
    $ctx.Response.OutputStream.Close()
  }
}
