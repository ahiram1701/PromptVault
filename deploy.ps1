<#
.SYNOPSIS
  Despliega PromptVault a Puter (https://<subdominio>.puter.site).

.DESCRIPTION
  Copia solo los archivos que la app necesita a una carpeta dist/ limpia y la
  publica con el CLI oficial de Puter. Sube bytes desde disco, así que el
  contenido desplegado es idéntico al del repo — sin transcripciones ni
  reinterpretación de secuencias de escape \uXXXX.

  Requisitos (una sola vez):
    npm install -g @heyputer/cli
    puter login

  En CI, en lugar de 'puter login', define la variable PUTER_AUTH_TOKEN.

.PARAMETER Subdomain
  Subdominio destino. Por defecto el actual: witty-meerkat-9381.

.PARAMETER SkipVerify
  Omite la verificación HTTP posterior al despliegue.

.EXAMPLE
  .\deploy.ps1
  .\deploy.ps1 -Subdomain mi-otro-sitio
#>
[CmdletBinding()]
param(
  [string]$Subdomain = 'witty-meerkat-9381',
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

# Archivos que la app realmente sirve. index.html referencia exactamente estos.
# Deliberadamente NO se despliegan: app.full.js, app.js.v0.9.bak,
# .app.js.bak-pre-v0.9.3 (respaldos muertos, ~76 KB), ni CLAUDE.md / README.md /
# .claude / .git.
$files = @(
  'index.html',
  'app.js',
  'storage.js',
  'styles.css',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'debug.html',
  'tests.html'
)

# Librerias vendorizadas. El CLI de Puter APLANA los subdirectorios al
# desplegar (comprobado en 0.1.2 y en 0.2.0): vendor/xlsx.full.min.js acababa
# servido en la raiz del sitio mientras index.html lo pedia en ./vendor/, asi
# que daba 404 y produccion se quedaba sin Excel y sin busqueda fuzzy, en
# silencio. Se publican en plano a proposito y se reescriben las dos rutas en
# la copia de index.html que va a dist/. El repo conserva vendor/ intacto: en
# local index.html sigue funcionando tal cual.
$vendorFiles = @('vendor/fuse.min.js', 'vendor/xlsx.full.min.js')

Write-Host "PromptVault -> $Subdomain.puter.site" -ForegroundColor Cyan

# --- 1. comprobar el CLI ---------------------------------------------------
if (-not (Get-Command puter -ErrorAction SilentlyContinue)) {
  Write-Error @'
El CLI de Puter no está instalado. Instálalo y autentícate una vez:

    npm install -g @heyputer/cli
    puter login
'@
}

# --- 2. armar dist/ limpio -------------------------------------------------
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Path $dist | Out-Null

foreach ($f in $files) {
  $src = Join-Path $root $f
  if (-not (Test-Path $src)) { Write-Error "Falta un archivo requerido: $f" }
  Copy-Item $src -Destination (Join-Path $dist $f)
}
foreach ($v in $vendorFiles) {
  $src = Join-Path $root $v
  if (-not (Test-Path $src)) { Write-Error "Falta una libreria vendorizada: $v" }
  Copy-Item $src -Destination (Join-Path $dist (Split-Path $v -Leaf))
}

# Reescribir ./vendor/<lib> -> ./<lib>, solo en la copia de dist/.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$indexPath = Join-Path $dist 'index.html'
$html = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
foreach ($v in $vendorFiles) {
  $leaf = Split-Path $v -Leaf
  $html = $html.Replace("./vendor/$leaf", "./$leaf")
}
if ($html -match '\./vendor/') {
  Write-Error "index.html sigue referenciando ./vendor/ tras reescribir; revisa `$vendorFiles."
}
[System.IO.File]::WriteAllText($indexPath, $html, $utf8NoBom)

$count = (Get-ChildItem $dist -Recurse -File).Count
$bytes = (Get-ChildItem $dist -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host "dist/ listo: $count archivos, $bytes bytes" -ForegroundColor DarkGray

# --- 3. desplegar ----------------------------------------------------------
Write-Host "Desplegando..." -ForegroundColor Cyan
puter site deploy $dist $Subdomain
# El CLI (0.1.2) puede abortar con un assertion failure de libuv al salir aunque
# el despliegue haya ido bien, así que un exit code no-cero solo avisa: la
# verificación por hash de abajo es la autoridad.
if ($LASTEXITCODE -ne 0) {
  Write-Host "Aviso: el CLI salió con código $LASTEXITCODE; decide la verificación." -ForegroundColor Yellow
}

# --- 4. verificar ----------------------------------------------------------
if ($SkipVerify) {
  Write-Host "Verificación omitida." -ForegroundColor Yellow
  return
}

Write-Host "Verificando..." -ForegroundColor Cyan
$bust = [guid]::NewGuid().ToString('N')
$ok = $true
$sha = [System.Security.Cryptography.SHA256]::Create()
$wc = New-Object System.Net.WebClient

# Se verifica TODO lo que hay en dist/, subcarpetas incluidas, y en la misma
# ruta relativa con la que index.html lo pide. Verificar solo los archivos
# sueltos de la raiz dejo pasar meses de despliegues sin vendor/: el CLI 0.1.2
# aplana los subdirectorios, asi que vendor/xlsx.full.min.js acababa en la raiz
# y la app se quedaba sin Excel ni busqueda fuzzy, con 404 silenciosos.
$distFiles = Get-ChildItem $dist -Recurse -File
foreach ($item in $distFiles) {
  # .Replace() es el metodo de String (literal), no el operador -replace (regex).
  $rel = $item.FullName.Substring($dist.Length + 1).Replace('\', '/')
  $url = "https://$Subdomain.puter.site/$rel`?cb=$bust"
  try {
    $localBytes  = [System.IO.File]::ReadAllBytes($item.FullName)
    $remoteBytes = $wc.DownloadData($url)
    $lh = [BitConverter]::ToString($sha.ComputeHash($localBytes))
    $rh = [BitConverter]::ToString($sha.ComputeHash($remoteBytes))
    if ($lh -eq $rh) {
      Write-Host ("  OK   {0,-26} {1} bytes" -f $rel, $localBytes.Length) -ForegroundColor Green
    } else {
      Write-Host ("  DIFF {0,-26} local {1} vs remoto {2} bytes" -f $rel, $localBytes.Length, $remoteBytes.Length) -ForegroundColor Red
      $ok = $false
    }
  } catch {
    Write-Host "  FAIL $rel -> $($_.Exception.Message)" -ForegroundColor Red
    $ok = $false
  }
}
$wc.Dispose()

if ($ok) {
  Write-Host "`nDesplegado y verificado: https://$Subdomain.puter.site" -ForegroundColor Green
} else {
  Write-Error "El despliegue terminó, pero la verificación encontró diferencias."
}
