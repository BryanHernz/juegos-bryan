[CmdletBinding()]
param([string]$NovaStarPath)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $NovaStarPath) {
    $NovaStarPath = Join-Path (Split-Path -Parent $root) 'NovaStar'
}
$source = Join-Path $NovaStarPath 'assets\branding\nova_star_logo.png'
$target = Join-Path $root 'assets\nova-star-logo.png'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Logo original no encontrado: $source. Usa -NovaStarPath con la carpeta del proyecto."
}
Copy-Item -LiteralPath $source -Destination $target -Force
Write-Host "Logo original copiado: $target"
Write-Host 'No se modifico el dibujo. No se copio codigo privado ni credenciales.'
Write-Host 'Para incluirlo en el portal: git add assets/nova-star-logo.png'
