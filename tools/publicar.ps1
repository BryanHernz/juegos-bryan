$ErrorActionPreference = 'Stop'
$repo = 'BryanHernz/juegos-bryan'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'No se encontro GitHub CLI (gh).'
}

# [pages] Consultar antes de crear; no borrar configuraciones existentes.
$oldPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$pageOutput = & gh api "repos/$repo/pages" 2>&1
$pageExit = $LASTEXITCODE
$ErrorActionPreference = $oldPreference

if ($pageExit -eq 0) {
    $page = ($pageOutput -join "`n") | ConvertFrom-Json
    if ($page.build_type -ne 'workflow') {
        & gh api --method PUT "repos/$repo/pages" -f build_type=workflow
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar Pages con GitHub Actions.' }
    }
} elseif (($pageOutput -join "`n") -match '404|Not Found') {
    & gh api --method POST "repos/$repo/pages" -f build_type=workflow
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo habilitar Pages. Revisa los permisos de gh.' }
} else {
    throw ('Error consultando Pages: ' + ($pageOutput -join "`n"))
}

& gh workflow run pages.yml --repo $repo --ref main
if ($LASTEXITCODE -ne 0) { throw 'Pages se configuro, pero no se pudo iniciar el workflow.' }

Write-Host 'Despliegue solicitado. Revisa que el workflow termine correctamente:'
Write-Host "https://github.com/$repo/actions/workflows/pages.yml"
Write-Host 'Direccion prevista al finalizar:'
Write-Host 'https://bryanhernz.github.io/juegos-bryan/'
