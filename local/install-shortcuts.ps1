# Crée/maj le raccourci Bureau « Finance Tracker » (à lancer une fois depuis Windows).
# Un seul raccourci : lancer = démarrer + ouvrir la fenêtre ; fermer la fenêtre = arrêter.
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

$lnk = $ws.CreateShortcut((Join-Path $desktop "Finance Tracker.lnk"))
$lnk.TargetPath       = "wscript.exe"
$lnk.Arguments        = '"' + (Join-Path $repoWin "local\start.vbs") + '"'
$lnk.WorkingDirectory = $repoWin
$lnk.IconLocation     = $icon
$lnk.Description      = "Finance Tracker (local) — fermer la fenêtre arrête l'application"
$lnk.Save()

# L'ancien raccourci « Stop » n'a plus de raison d'être.
$old = Join-Path $desktop "Finance Tracker - Stop.lnk"
if (Test-Path $old) { Remove-Item $old; Write-Host "Ancien raccourci Stop supprimé." }

Write-Host "Raccourci « Finance Tracker » créé sur le Bureau."
