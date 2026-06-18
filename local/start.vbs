' Finance Tracker — Démarrage (fenêtre cachée) + ouverture du navigateur.
Option Explicit
Dim ws, proj, url, i, rc
Set ws = CreateObject("WScript.Shell")
proj = "/home/sylvain_ladoire/projects/developpeur/finance-tracker"
url  = "http://localhost:3000"

' 1) Lancer le serveur en tâche de fond, fenêtre cachée (0), sans attendre (False)
ws.Run "wsl.exe bash -lic ""cd " & proj & " && ./local/run.sh""", 0, False

' 2) Attendre que le serveur réponde (max ~30s) avant d'ouvrir le navigateur
For i = 1 To 30
    rc = ws.Run("wsl.exe bash -lic ""curl -sf " & url & "/api/health >/dev/null""", 0, True)
    If rc = 0 Then Exit For
    WScript.Sleep 1000
Next

' 3) Ouvrir le navigateur par défaut uniquement si le serveur a répondu
If rc = 0 Then
    ws.Run url, 1, False
Else
    MsgBox "Finance Tracker n'a pas démarré à temps. Voir logs/finance.log."
End If
