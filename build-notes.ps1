$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$NotesRoot = Join-Path $Root "notes"
$Output = Join-Path $Root "notes-data.js"

if (-not (Test-Path $NotesRoot)) {
  New-Item -ItemType Directory -Path $NotesRoot | Out-Null
}

function New-Slug([string] $Value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-NoteTitle([string] $Content, [string] $Fallback) {
  $firstHeading = [regex]::Match($Content, "(?m)^#\s+(.+)$")
  if ($firstHeading.Success) {
    return $firstHeading.Groups[1].Value.Trim()
  }

  $firstLine = ($Content -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
  if ($firstLine) {
    $title = $firstLine.Trim()
    if ($title.Length -gt 28) {
      return $title.Substring(0, 28) + "..."
    }
    return $title
  }

  return $Fallback
}

function Get-Excerpt([string] $Content) {
  $plain = (($Content -replace "(?m)^#+\s+", "") -replace "\s+", " ").Trim()
  if ($plain.Length -le 82) {
    return $plain
  }
  return $plain.Substring(0, 82) + "..."
}

$categories = @()
$categoryDirs = Get-ChildItem -LiteralPath $NotesRoot -Directory | Sort-Object Name

foreach ($dir in $categoryDirs) {
  $notes = @()
  $files = Get-ChildItem -LiteralPath $dir.FullName -Filter "*.md" -File | Sort-Object Name

  foreach ($file in $files) {
    $content = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($file.FullName))
    $relative = $file.FullName.Substring($Root.Length + 1)
    $fallbackTitle = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $plain = (($content -replace "(?m)^#+\s+", "") -replace "\s+", "")

    $notes += [ordered]@{
      id = New-Slug $relative
      title = Get-NoteTitle $content $fallbackTitle
      excerpt = Get-Excerpt $content
      path = $relative.Replace("\", "/")
      updatedAt = $file.LastWriteTime.ToString("yyyy-MM-dd")
      wordCount = $plain.Length
      content = $content
    }
  }

  $categories += [ordered]@{
    id = New-Slug $dir.Name
    name = $dir.Name
    notes = $notes
  }
}

$payload = [ordered]@{
  generatedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
  categories = $categories
}

$json = $payload | ConvertTo-Json -Depth 8
$script = "window.NOTE_LIBRARY = $json;"
[System.IO.File]::WriteAllText($Output, $script, [System.Text.Encoding]::UTF8)

Write-Host "Generated $Output"
