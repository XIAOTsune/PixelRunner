Option Explicit

Dim shell, fileSystem, rootPath, serverPath, runtimePath
Const RequiredProtocolVersion = "2"
Const RequiredBuildId = "PixelRunnerV2.8.1-local-ai-bundled-runtime"
Const FirstPort = 17836
Const LastPort = 17845
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
rootPath = fileSystem.GetParentFolderName(WScript.ScriptFullName)
serverPath = rootPath & "\server.py"
runtimePath = rootPath & "\runtime\python.exe"

If FindCompatibleServicePort() > 0 Then WScript.Quit 0
StopCurrentPixelRunnerService

If Not fileSystem.FileExists(runtimePath) Then
  WriteLauncherLog "Bundled Python runtime is missing: " & runtimePath
  WScript.Quit 2
End If

StartBundledRuntime

Function FindCompatibleServicePort()
  Dim port
  FindCompatibleServicePort = 0
  For port = FirstPort To LastPort
    If IsServiceCompatible(port) Then
      FindCompatibleServicePort = port
      Exit Function
    End If
  Next
End Function

Function IsServiceCompatible(port)
  On Error Resume Next
  Dim request, responseBody
  Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
  request.SetTimeouts 300, 300, 300, 700
  request.Open "GET", "http://127.0.0.1:" & CStr(port) & "/v1/health", False
  request.Send
  responseBody = request.ResponseText
  IsServiceCompatible = (Err.Number = 0 And request.Status = 200 _
    And InStr(responseBody, """protocolVersion"": """ & RequiredProtocolVersion & """") > 0 _
    And InStr(responseBody, """buildId"": """ & RequiredBuildId & """") > 0)
  Err.Clear
  On Error GoTo 0
End Function

Function PortArguments()
  PortArguments = " --port " & CStr(FirstPort) & " --port-end " & CStr(LastPort)
End Function

Sub StartBundledRuntime()
  Dim logPath, command
  logPath = GetLauncherLogPath()
  EnsureFolder fileSystem.GetParentFolderName(logPath)
  WriteLauncherLog "Starting bundled Python runtime: " & runtimePath
  command = Quote(runtimePath) & " " & Quote(serverPath) & PortArguments() & " >> " & Quote(logPath) & " 2>&1"
  shell.Run "cmd.exe /d /s /c " & Quote(command), 0, False
End Sub

Function GetLauncherLogPath()
  Dim basePath
  basePath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
  If InStr(basePath, "%") > 0 Then basePath = shell.ExpandEnvironmentStrings("%TEMP%")
  GetLauncherLogPath = basePath & "\PixelRunner\local-ai\launcher.log"
End Function

Sub EnsureFolder(folderPath)
  If folderPath = "" Or fileSystem.FolderExists(folderPath) Then Exit Sub
  EnsureFolder fileSystem.GetParentFolderName(folderPath)
  If Not fileSystem.FolderExists(folderPath) Then fileSystem.CreateFolder folderPath
End Sub

Sub WriteLauncherLog(message)
  On Error Resume Next
  Dim logPath, output
  logPath = GetLauncherLogPath()
  EnsureFolder fileSystem.GetParentFolderName(logPath)
  Set output = fileSystem.OpenTextFile(logPath, 8, True)
  output.WriteLine Now & " " & message
  output.Close
  Err.Clear
  On Error GoTo 0
End Sub

Sub StopCurrentPixelRunnerService()
  On Error Resume Next
  Dim locator, processes, processInfo, commandLine
  Set locator = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = locator.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='python.exe' OR Name='pythonw.exe' OR Name='py.exe' OR Name='pyw.exe'")
  For Each processInfo In processes
    commandLine = LCase(CStr(processInfo.CommandLine))
    If InStr(commandLine, LCase(serverPath)) > 0 Then
      processInfo.Terminate
    End If
  Next
  WScript.Sleep 300
  Err.Clear
  On Error GoTo 0
End Sub

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
