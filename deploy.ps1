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
  'debug.html',
  'tests.html'
)
$dirs = @('vendor')

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
foreach ($d in $dirs) {
  $src = Join-Path $root $d
  if (-not (Test-Path $src)) { Write-Error "Falta un directorio requerido: $d" }
  Copy-Item $src -Destination $dist -Recurse
}

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

# Comparación a nivel de bytes. Nada de comparar texto: Get-Content sin
# -Encoding lee ANSI mientras que la respuesta HTTP se decodifica como UTF-8,
# y esa asimetría marca como distintos archivos que son idénticos.
foreach ($f in $files) {
  $url = "https://$Subdomain.puter.site/$f`?cb=$bust"
  try {
    $localBytes  = [System.IO.File]::ReadAllBytes((Join-Path $root $f))
    $remoteBytes = $wc.DownloadData($url)
    $lh = [BitConverter]::ToString($sha.ComputeHash($localBytes))
    $rh = [BitConverter]::ToString($sha.ComputeHash($remoteBytes))
    if ($lh -eq $rh) {
      Write-Host ("  OK   {0,-12} {1} bytes" -f $f, $localBytes.Length) -ForegroundColor Green
    } else {
      Write-Host ("  DIFF {0,-12} local {1} vs remoto {2} bytes" -f $f, $localBytes.Length, $remoteBytes.Length) -ForegroundColor Red
      $ok = $false
    }
  } catch {
    Write-Host "  FAIL $f -> $($_.Exception.Message)" -ForegroundColor Red
    $ok = $false
  }
}
$wc.Dispose()

if ($ok) {
  Write-Host "`nDesplegado y verificado: https://$Subdomain.puter.site" -ForegroundColor Green
} else {
  Write-Error "El despliegue terminó, pero la verificación encontró diferencias."
}
