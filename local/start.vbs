' Finance Tracker — application standalone.
' Un seul raccourci : démarre le serveur (et Ollama) en tâche de fond, ouvre
' l'appli dans une fenêtre Chrome dédiée (mode application, sans barre
' d'adresse) et ATTEND sa fermeture : fermer la fenêtre arrête le serveur.
' Ollama n'est jamais arrêté (partagé avec jobmail-assistant, se met en veille seul).
Option Explicit
Dim ws, fso, sh, proj, url, i, rc, chrome, profile, args
Set ws  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
proj = "/home/sylvain_ladoire/projects/developpeur/finance-tracker"
url  = "http://localhost:3000"

' 1) Lancer le serveur en tâche de fond, fenêtre cachée (0), sans attendre (False)
ws.Run "wsl.exe bash -lic ""cd " & proj & " && ./local/run.sh""", 0, False

' 2) Attendre que le serveur réponde (max ~30s)
For i = 1 To 30
    rc = ws.Run("wsl.exe bash -lic ""curl -sf " & url & "/api/health >/dev/null""", 0, True)
    If rc = 0 Then Exit For
    WScript.Sleep 1000
Next
If rc <> 0 Then
    MsgBox "Finance Tracker n'a pas démarré à temps. Voir logs/finance.log.", 48, "Finance Tracker"
    WScript.Quit 1
End If

' 3) Fenêtre application Chrome (Edge en secours). Le profil dédié garantit un
'    process propre à cette fenêtre : Chrome ne délègue pas à une instance déjà
'    ouverte, donc Run(..., True) bloque bien jusqu'à la fermeture de la fenêtre.
chrome = FindBrowser()
If chrome = "" Then
    MsgBox "Aucun navigateur Chrome/Edge trouvé. Ouvre " & url & " à la main ; le serveur reste lancé.", 48, "Finance Tracker"
    WScript.Quit 1
End If
profile = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\FinanceTracker\chrome-profile"
args = " --app=" & url & " --user-data-dir=""" & profile & """" & _
       " --window-size=1440,1000 --no-first-run --no-default-browser-check --disable-background-mode"
ws.Run """" & chrome & """" & args, 1, True

' 4) Fenêtre fermée → arrêt du serveur
ws.Run "wsl.exe bash -lic ""cd " & proj & " && ./local/stop.sh""", 0, True

Function FindBrowser()
    Dim candidates, p
    candidates = Array( _
        ws.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
        ws.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
        ws.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe", _
        ws.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
        ws.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe")
    FindBrowser = ""
    For Each p In candidates
        If fso.FileExists(p) Then
            FindBrowser = p
            Exit Function
        End If
    Next
End Function
