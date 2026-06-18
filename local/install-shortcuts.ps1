# Crée/maj les 2 raccourcis Bureau Finance Tracker (à lancer une fois depuis Windows).
$ErrorActionPreference = "Stop"

# Chemin Windows du repo (UNC \\wsl$). Adapter la distro si besoin (wsl -l -q).
$repoWin = "\\wsl.localhost\Ubuntu\home\sylvain_ladoire\projects\developpeur\finance-tracker"
if (-not (Test-Path $repoWin)) {
    $repoWin = "\\wsl$\Ubuntu\home\sylvain_ladoire\projects\developpeur\finance-tracker"
}
if (-not (Test-Path $repoWin)) {
    throw "Repo introuvable via \\wsl. Vérifie le nom de la distro (wsl -l -q) et adapte le script."
}

$desktop = [Environment]::GetFolderPath("Desktop")
$icon    = Join-Path $repoWin "finance-tracker.ico"
$ws      = New-Object -ComObject WScript.Shell

function New-FtShortcut($name, $vbs, $desc) {
    $lnk = $ws.CreateShortcut((Join-Path $desktop "$name.lnk"))
    $lnk.TargetPath       = "wscript.exe"
    $lnk.Arguments        = '"' + (Join-Path $repoWin ("local\" + $vbs)) + '"'
    $lnk.WorkingDirectory = $repoWin
    $lnk.IconLocation     = $icon
    $lnk.Description       = $desc
    $lnk.Save()
}

New-FtShortcut "Finance Tracker"        "start.vbs" "Démarre Finance Tracker (local) et ouvre le navigateur"
New-FtShortcut "Finance Tracker - Stop" "stop.vbs"  "Arrête Finance Tracker (local)"

Write-Host "Raccourcis créés sur le Bureau."
