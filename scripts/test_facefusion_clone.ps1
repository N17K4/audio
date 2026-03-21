<#
.SYNOPSIS
    测试 FaceFusion 克隆逻辑：git clone 优先，git 不可用时回退 zip 下载。

.DESCRIPTION
    用法：
        .\scripts\test_facefusion_clone.ps1              # 自动检测 git
        .\scripts\test_facefusion_clone.ps1 -ForceZip    # 强制走 zip 路径
        .\scripts\test_facefusion_clone.ps1 -ForceGit    # 强制走 git 路径
#>
param(
    [switch]$ForceZip,
    [switch]$ForceGit
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Tag = "3.5.4"
$RepoUrl = "https://github.com/facefusion/facefusion.git"
$ZipUrl = "https://github.com/facefusion/facefusion/archive/refs/tags/$Tag.zip"
$Dest = Join-Path (Split-Path $PSScriptRoot -Parent) "cache\facefusion"
$Sentinel = Join-Path $Dest "facefusion\__init__.py"

# 精简时需要删除的开发文件/目录
$RemoveItems = @(".github", ".gitignore", ".pylintrc", "tests",
    "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE.md", "README.md", ".git")

function Clone-ViaGit {
    Write-Host "[git] git clone --depth 1 --branch $Tag -> $Dest"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath "git" `
        -ArgumentList "clone","--depth","1","--branch",$Tag,$RepoUrl,$Dest `
        -NoNewWindow -Wait -PassThru -RedirectStandardError (Join-Path $env:TEMP "ff_git_err.txt")
    $elapsed = $sw.Elapsed.TotalSeconds
    if ($proc.ExitCode -eq 0) {
        Write-Host "[git] OK clone done ($([math]::Round($elapsed,1))s)" -ForegroundColor Green
        return $true
    }
    $errMsg = ""
    $errFile = Join-Path $env:TEMP "ff_git_err.txt"
    if (Test-Path $errFile) { $errMsg = (Get-Content $errFile -Raw).Substring(0, [Math]::Min(300, (Get-Content $errFile -Raw).Length)) }
    Write-Host "[git] FAIL clone failed ($([math]::Round($elapsed,1))s): $errMsg" -ForegroundColor Red
    return $false
}

function Clone-ViaZip {
    Write-Host "[zip] download $ZipUrl"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $zipFile = Join-Path $env:TEMP "facefusion-$Tag.zip"
    $tmpDir = Join-Path $PSScriptRoot "_facefusion_tmp"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "AI-Workshop-Test")
        $wc.DownloadFile($ZipUrl, $zipFile)
        $sizeMB = [math]::Round((Get-Item $zipFile).Length / 1MB, 1)
        $dlTime = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        Write-Host "[zip] download done ($sizeMB MB, ${dlTime}s), extracting..."

        if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
        Expand-Archive -Path $zipFile -DestinationPath $tmpDir -Force

        $extracted = Get-ChildItem $tmpDir
        if ($extracted.Count -eq 1 -and $extracted[0].PSIsContainer) {
            Move-Item $extracted[0].FullName $Dest
        } else {
            Rename-Item $tmpDir $Dest
        }
        if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
        Remove-Item $zipFile -Force -ErrorAction SilentlyContinue

        $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        Write-Host "[zip] OK extract done (${elapsed}s)" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[zip] FAIL: $_" -ForegroundColor Red
        Remove-Item $zipFile -Force -ErrorAction SilentlyContinue
        if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
        return $false
    }
}

function Cleanup-Engine {
    $removed = 0
    foreach ($name in $RemoveItems) {
        $p = Join-Path $Dest $name
        if (Test-Path $p) {
            Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
            $removed++
        }
    }
    return $removed
}

# ── Main ──────────────────────────────────────────────────────────────────

Write-Host "target: $Dest"

if (Test-Path $Dest) {
    Write-Host "cleaning existing dir..."
    Remove-Item $Dest -Recurse -Force
}

$hasGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
Write-Host "git available: $hasGit"

$ok = $false

if ($ForceZip) {
    Write-Host "`n-- force zip mode --"
    $ok = Clone-ViaZip
} elseif ($ForceGit) {
    Write-Host "`n-- force git mode --"
    if (-not $hasGit) {
        Write-Host "FAIL: git not available" -ForegroundColor Red
        exit 1
    }
    $ok = Clone-ViaGit
} else {
    # auto: git first, fallback zip
    if ($hasGit) {
        Write-Host "`n-- trying git clone --"
        $ok = Clone-ViaGit
    }
    if (-not $ok) {
        Write-Host "`n-- fallback to zip download --"
        if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
        $ok = Clone-ViaZip
    }
}

if (-not $ok) {
    Write-Host "`nFAIL: could not get FaceFusion" -ForegroundColor Red
    exit 1
}

$nRemoved = Cleanup-Engine
$nFiles = (Get-ChildItem $Dest -Recurse -File).Count
Write-Host "`ncleanup done: removed $nRemoved items, $nFiles files remaining"

if (Test-Path $Sentinel) {
    Write-Host "OK sentinel exists: $Sentinel" -ForegroundColor Green
} else {
    Write-Host "FAIL sentinel missing: $Sentinel" -ForegroundColor Red
    exit 1
}

Write-Host "`ntest passed" -ForegroundColor Green
exit 0
