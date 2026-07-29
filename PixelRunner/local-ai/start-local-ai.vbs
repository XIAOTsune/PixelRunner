Option Explicit

Dim shell, fileSystem, rootPath, serverPath
Const RequiredProtocolVersion = "2"
Const RequiredBuildId = "PixelRunnerV2.7.3-local-ai-native-cli"
Const FirstPort = 17836
Const LastPort = 17845
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
rootPath = fileSystem.GetParentFolderName(WScript.ScriptFullName)
serverPath = rootPath & "\server.py"

If FindCompatibleServicePort() > 0 Then WScript.Quit 0
StopCurrentPixelRunnerService

If HasCommand("pyw") Then
  shell.Run "pyw -3 " & Quote(serverPath) & PortArguments(), 0, False
ElseIf HasCommand("pythonw") Then
  shell.Run "pythonw " & Quote(serverPath) & PortArguments(), 0, False
ElseIf HasCommand("py") Then
  shell.Run "py -3 " & Quote(serverPath) & PortArguments(), 0, False
ElseIf HasCommand("python") Then
  shell.Run "python " & Quote(serverPath) & PortArguments(), 0, False
End If

Function HasCommand(commandName)
  HasCommand = (shell.Run("cmd.exe /c where " & commandName & " >nul 2>nul", 0, True) = 0)
End Function

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
