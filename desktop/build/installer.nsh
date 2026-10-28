!include "WinMessages.nsh"
!include "${PROJECT_DIR}\build\agent-update-handoff.nsh"
!macro customInit
  !insertmacro ZyraPrepareAgentUpdate
!macroend
!include "${PROJECT_DIR}\build\windows-file-icons.nsh"
!include "StrFunc.nsh"
!ifndef BUILD_UNINSTALLER
  ${StrStr}
!endif

; Existing Windows default-app choices can still refer to an old shared ProgID.
; Keep those choices valid, but use a generic file-type icon instead of the logo.
!macro ZyraLegacyFileIcon NAME ICON
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\${NAME}\shell\open\command" ""
  ${If} $0 == '$appExe "%1"'
  ${OrIf} $0 == '"$appExe" "%1"'
    WriteRegStr SHELL_CONTEXT "Software\Classes\${NAME}\DefaultIcon" "" "$INSTDIR\resources\zyra-file-${ICON}.ico"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro ZyraInstallFileIcons
  !insertmacro ZyraLegacyFileIcon "Zyra Code and Text Preview" "document"
  !insertmacro ZyraLegacyFileIcon "Zyra Document Preview" "file"
  !insertmacro ZyraLegacyFileIcon "Zyra Image Preview" "image"
  !insertmacro ZyraLegacyFileIcon "Zyra Media Preview" "video"
  WriteRegStr SHELL_CONTEXT "Software\Classes\*\shell\Zyra" "" "Open with Zyra"
  WriteRegStr SHELL_CONTEXT "Software\Classes\*\shell\Zyra" "Icon" "$appExe,0"
  ; Remove the old pinned position on upgrades as well as fresh installs.
  DeleteRegValue SHELL_CONTEXT "Software\Classes\*\shell\Zyra" "Position"
  WriteRegStr SHELL_CONTEXT "Software\Classes\*\shell\Zyra\command" "" '"$appExe" "%1"'

  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\shell\Zyra" "" "Open with Zyra"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\shell\Zyra" "Icon" "$appExe,0"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\Directory\shell\Zyra" "Position"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\shell\Zyra\command" "" '"$appExe" "%1"'

  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\Background\shell\Zyra" "" "Open with Zyra"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\Background\shell\Zyra" "Icon" "$appExe,0"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\Directory\Background\shell\Zyra" "Position"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\Background\shell\Zyra\command" "" '"$appExe" "%V"'

  ; Desktop carries the lockstep TUI runtime. Install one user-owned terminal
  ; launcher and add its stable directory without exposing resources paths.
  CreateDirectory "$LOCALAPPDATA\Zyra\bin"
  GetFullPathName /SHORT $3 "$INSTDIR"
  FileOpen $0 "$LOCALAPPDATA\Zyra\bin\zyra.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "setlocal$\r$\n"
  FileWrite $0 "rem zyra-desktop-managed-launcher:v1$\r$\n"
  FileWrite $0 "set $\"ZYRA_ROOT=$3\resources\zyra-runtime$\"$\r$\n"
  FileWrite $0 "set $\"ZYRA_DATA_ROOT=%USERPROFILE%$\"$\r$\n"
  FileWrite $0 "set $\"ZYRA_DISTRIBUTION=desktop-bundle$\"$\r$\n"
  FileWrite $0 "if defined ZYRA_STATE_DIR goto zyra_server_namespace_ready$\r$\n"
  FileWrite $0 "set $\"ZYRA_STATE_DIR=%APPDATA%\Zyra\assistant\agent-server$\"$\r$\n"
  FileWrite $0 "set $\"ZYRA_AGENT_SERVER_CHANNEL=desktop$\"$\r$\n"
  FileWrite $0 ":zyra_server_namespace_ready$\r$\n"
  FileWrite $0 "if not exist $\"$3\resources\zyra-node\node.exe$\" goto zyra_cli_fallback$\r$\n"
  FileWrite $0 "$\"$3\resources\zyra-node\node.exe$\" $\"$3\resources\zyra-runtime\bin\zyra.mjs$\" %*$\r$\n"
  FileWrite $0 "exit /b %ERRORLEVEL%$\r$\n"
  FileWrite $0 ":zyra_cli_fallback$\r$\n"
  FileWrite $0 "if exist $\"$LOCALAPPDATA\Zyra\zyra.cmd$\" call $\"$LOCALAPPDATA\Zyra\zyra.cmd$\" %*$\r$\n"
  FileWrite $0 "exit /b %ERRORLEVEL%$\r$\n"
  FileClose $0
  ReadRegStr $1 HKCU "Environment" "Path"
  ${StrStr} $2 "$1" "$LOCALAPPDATA\Zyra\bin"
  StrCmp $2 "" 0 zyra_path_ready
  StrCmp $1 "" 0 +2
    StrCpy $1 "$LOCALAPPDATA\Zyra\bin"
    Goto +2
  StrCpy $1 "$1;$LOCALAPPDATA\Zyra\bin"
  WriteRegExpandStr HKCU "Environment" "Path" "$1"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  zyra_path_ready:
  !insertmacro ZyraRecordAgentUpdateSuccess
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro ZyraUninstallFileIcons
    DeleteRegKey SHELL_CONTEXT "Software\Classes\*\shell\Zyra"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\shell\Zyra"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\Background\shell\Zyra"
    Delete "$LOCALAPPDATA\Zyra\bin\zyra.cmd"
    IfFileExists "$LOCALAPPDATA\Zyra\zyra.cmd" 0 zyra_no_standalone_fallback
      CreateDirectory "$LOCALAPPDATA\Zyra\bin"
      FileOpen $0 "$LOCALAPPDATA\Zyra\bin\zyra.cmd" w
      FileWrite $0 "@echo off$\r$\n"
      FileWrite $0 "rem zyra-managed-launcher:v1$\r$\n"
      FileWrite $0 "call $\"$LOCALAPPDATA\Zyra\zyra.cmd$\" %*$\r$\n"
      FileWrite $0 "exit /b %ERRORLEVEL%$\r$\n"
      FileClose $0
      Goto zyra_launcher_cleanup_done
    zyra_no_standalone_fallback:
      RMDir "$LOCALAPPDATA\Zyra\bin"
    zyra_launcher_cleanup_done:
  ${endIf}
!macroend
