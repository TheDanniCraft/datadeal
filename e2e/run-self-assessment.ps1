param([string]$ReportDomain = "bild.de", [switch]$GuestRewardHandoff, [switch]$HistoryComparison)
$ErrorActionPreference = 'Stop'
# Run from the checkout root. Requires Bun, Node, PostgreSQL CLI, Chromium,
# and a published report in the local web database. No real payments occur.
$run = Join-Path (Resolve-Path '.') ('test-results/self-assessment-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $run -Force
$cluster = Join-Path $run 'data'
$keyFile = Join-Path $run 'password'
$password = [guid]::NewGuid().ToString('N')
Set-Content -LiteralPath $keyFile -Value $password -Encoding ASCII
try {
  & initdb -D $cluster -U postgres --auth=scram-sha-256 --pwfile=$keyFile --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE) { throw 'Could not initialize a disposable database.' }
} finally { Remove-Item -LiteralPath $keyFile }
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = $portProbe.LocalEndpoint.Port
$portProbe.Stop()
$starter = Start-Process -FilePath (Get-Command pg_ctl).Source -ArgumentList @('-D', ('"' + $cluster + '"'), '-l', ('"' + (Join-Path $run 'postgres.log') + '"'), '-o', ('"-p ' + $port + ' -h 127.0.0.1"'), '-w', 'start') -WindowStyle Hidden -PassThru
$starter.WaitForExit()
if ($starter.ExitCode) { throw 'Could not start the disposable database.' }
try {
  $env:DATADEAL_TEST_URL = $null
  $env:DATADEAL_TEST_DATABASE_URL = "postgres://postgres:$password@127.0.0.1:$port/postgres"
  $env:DATABASE_URL = $env:DATADEAL_TEST_DATABASE_URL
  & node packages/database/migrate.mjs
  if ($LASTEXITCODE) { throw 'Schema migration failed.' }
  $env:DATADEAL_SELF_ASSESSMENT_DOMAIN = $ReportDomain
  $env:DATADEAL_REWARD_HANDOFF_TEST = if ($GuestRewardHandoff -or $HistoryComparison) { 'true' } else { 'false' }
  $previousScan = & bun --no-env-file e2e/fixtures/copy-self-assessment-report.mts
  if ($LASTEXITCODE) { throw 'Could not seed the selected public report.' }
  $env:DATADEAL_AUTH_TEST_MAIL_FILE = Join-Path $run 'outbox'
  $env:BETTER_AUTH_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  $env:DATADEAL_BILLING_TEST_SECRET = [guid]::NewGuid().ToString('N')
  $env:CREEM_WEBHOOK_SECRET = $env:DATADEAL_BILLING_TEST_SECRET
  $env:CREEM_API_KEY = 'self-assessment-fixture'
  $env:CREEM_MODE = 'test'
  $env:CREEM_MONTHLY_PRODUCT = 'self-assessment-monthly'
  $env:CREEM_YEARLY_PRODUCT = 'self-assessment-yearly'
  $env:DATADEAL_LOCAL_SAMPLE_ADS = 'true'
  if ($HistoryComparison) {
    $env:DATADEAL_HISTORY_TEST = 'true'
    & bun --no-env-file x --no-install playwright test e2e/history-comparison.e2e.ts --output (Join-Path $run 'results') --reporter=line
    if ($LASTEXITCODE) { throw 'History comparison verification failed.' }
  } elseif ($GuestRewardHandoff) {
    $env:DATADEAL_REWARD_TEST_PREVIOUS_SCAN = $previousScan
    & bun --no-env-file x --no-install playwright test e2e/guest-reward-handoff.e2e.ts --output (Join-Path $run 'results') --reporter=line
    if ($LASTEXITCODE) { throw 'Guest reward handoff failed.' }
  } else {
    & bun --no-env-file x --no-install playwright test e2e/self-assessment.e2e.ts --output (Join-Path $run 'results') --reporter=line
    if ($LASTEXITCODE) { throw 'Self-assessment failed.' }
    Write-Output ('Evidence: ' + (Get-ChildItem -LiteralPath (Join-Path $run 'results') -Recurse -Filter 'datadeal-self-assessment.json' | Select-Object -First 1 -ExpandProperty FullName))
  }
} finally {
  & pg_ctl -D $cluster -w -m fast stop
  if ($LASTEXITCODE -eq 0) {
    $resolvedCluster = (Resolve-Path -LiteralPath $cluster).Path
    $expectedCluster = [IO.Path]::GetFullPath((Join-Path $run 'data'))
    if ($resolvedCluster -ne $expectedCluster -or (Split-Path $run -Leaf) -notmatch '^self-assessment-[0-9a-f]{32}$') {
      throw 'Unexpected temporary database path.'
    }
    Remove-Item -LiteralPath $resolvedCluster -Recurse -Force
    $fixtureOutbox = Join-Path $run 'outbox'
    if (Test-Path -LiteralPath $fixtureOutbox) {
      Remove-Item -LiteralPath $fixtureOutbox
    }
  }
}
