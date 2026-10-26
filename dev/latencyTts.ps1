# Generate 8 kHz 16-bit mono WAVs for the scripted latency baseline (Windows built-in TTS, free/offline).
# Usage: pwsh dev/latencyTts.ps1 -OutDir <dir> [-Prompts test/fixtures/latencyPrompts.json]
# Only prompts with lang "en" and not "scripted": false are generated (no local voices for other languages).
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$Prompts = (Join-Path $PSScriptRoot "..\test\fixtures\latencyPrompts.json")
)

Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force $OutDir | Out-Null

$fixture = Get-Content $Prompts -Raw | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  8000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($p in $fixture.prompts) {
  if ($p.lang -ne "en" -or $p.scripted -eq $false) { continue }
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = 0
  $path = Join-Path $OutDir ("{0}.wav" -f $p.id)
  $synth.SetOutputToWaveFile($path, $format)
  $synth.Speak($p.text)
  $synth.Dispose()
  Write-Output $path
}
