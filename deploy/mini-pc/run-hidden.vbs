' Launch a command with no console window.
'
' Why this exists rather than "cmd /c start /b":
'
'   The stack used to launch the tunnel as
'       cmd /c <cloudflared> ...
'   which works, but leaves cmd alive as the parent for the whole life of
'   cloudflared, and cmd owns a console window. On a headless clinic PC that is
'   a black rectangle nobody can dismiss.
'
'       cmd /c start "" /b <cloudflared> ...
'   hides the window but exits cmd immediately, and WMI launches processes inside
'   a job object -- the detached child is torn down with its parent. The tunnel
'   registered its connections and then vanished a second later.
'
'   WScript.Shell.Run with windowStyle 0 is the supported way to start a
'   windowless process that outlives its launcher.
'
' Why the command arrives in a FILE rather than as arguments:
'
'   wscript.exe parses its own command line with the standard C rules, so a
'   quoted executable path plus two more quoted arguments does not survive the
'   trip -- the quotes are consumed before the script ever sees them and
'   cloudflared is invoked with a truncated path and never starts. Passing one
'   argument that names a file has no quotes to mangle.
'
' Usage: run-hidden.vbs <path-to-command-file>

Option Explicit
Dim shell, fso, stream, cmdLine

If WScript.Arguments.Count < 1 Then
    WScript.Echo "usage: run-hidden.vbs <command-file>"
    WScript.Quit 1
End If

Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(WScript.Arguments(0)) Then
    WScript.Echo "command file not found: " & WScript.Arguments(0)
    WScript.Quit 1
End If

Set stream = fso.OpenTextFile(WScript.Arguments(0), 1)
cmdLine = Trim(stream.ReadLine)
stream.Close

If Len(cmdLine) = 0 Then
    WScript.Echo "command file is empty"
    WScript.Quit 1
End If

Set shell = CreateObject("WScript.Shell")

' 0 = hidden window, False = do not wait for the child to exit.
shell.Run cmdLine, 0, False

Set shell = Nothing
Set fso = Nothing