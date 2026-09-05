Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Projects\opencode-mobile-notify"
WshShell.Run "node bridge.js", 0, False
