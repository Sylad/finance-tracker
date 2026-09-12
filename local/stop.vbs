' Finance Tracker — Arrêt manuel (dépannage : le raccourci normal arrête l'appli à la fermeture de sa fenêtre).
Option Explicit
Dim ws, proj
Set ws = CreateObject("WScript.Shell")
proj = "/home/sylvain_ladoire/projects/developpeur/finance-tracker"
ws.Run "wsl.exe bash -lic ""cd " & proj & " && ./local/stop.sh""", 0, True
