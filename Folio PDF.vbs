' Folio PDF Suite - click to launch dev server with live hot-reload
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = scriptDir
' 0 = hidden window, False = don't wait (app stays open)
sh.Run "cmd /c npm run dev", 0, False
