param(
  [Parameter(Mandatory=$true)][ValidateSet('novaStar','cartonLleno')][string]$App,
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [Parameter(Mandatory=$true)][string]$InputFile,
  [ValidateSet('DryRun','PublishPrivate','VerifyPrivate','PublishHistory')][string]$Mode='DryRun',
  [switch]$DownloadsVerified
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $AppRoot).Path
$inputPath=(Resolve-Path -LiteralPath $InputFile).Path
$nexo=Split-Path -Parent $PSScriptRoot
function Assert-Exit([string]$Step) { if($LASTEXITCODE -ne 0){throw "Falló $Step; publicación detenida."} }
function Assert-Clean {
  $status=& git -C $root status --porcelain
  Assert-Exit 'git status'
  if($status){throw 'La app debe tener Git limpio antes y después de las pruebas.'}
}
if((& node --version) -notmatch '^v22\.') {throw 'Usa Node 22 para el publicador Nexo.'}
Assert-Exit 'Node'
Assert-Clean
if($Mode -eq 'PublishHistory' -and -not $DownloadsVerified) {
  throw 'Primero verifica API/descargas completas y hashes con la cuenta real. Después usa -DownloadsVerified.'
}
& node (Join-Path $PSScriptRoot 'app-release-preflight.mjs') $App $root $inputPath
Assert-Exit 'versión, contrato, aliases y SHA256 local'
Push-Location $root
try {
  & flutter analyze
  Assert-Exit 'flutter analyze'
  & flutter test
  Assert-Exit 'flutter test'
} finally {Pop-Location}
Assert-Clean
$publisher=Join-Path $PSScriptRoot 'publish-release.mjs'
$bucket='nova-star-bd0d9-nexo-releases'
switch($Mode) {
  'DryRun' {& node $publisher --dry-run $inputPath; Assert-Exit 'dry-run'}
  'PublishPrivate' {
    & node $publisher --publish-private $inputPath $bucket; Assert-Exit 'publicación privada'
    & node $publisher --verify-private $inputPath $bucket; Assert-Exit 'verificación privada'
  }
  'VerifyPrivate' {& node $publisher --verify-private $inputPath $bucket; Assert-Exit 'verificación privada'}
  'PublishHistory' {
    # No draft/upload GitHub until Storage/latest have been checked read-only.
    & node $publisher --verify-private $inputPath $bucket; Assert-Exit 'Nexo antes de histórico'
    & node $publisher --publish $inputPath $bucket; Assert-Exit 'histórico GitHub privado'
    & node $publisher --verify $inputPath $bucket; Assert-Exit 'Nexo y GitHub privados'
  }
}
# No compilation, deploy, credential persistence, visibility or IAM mutation.
