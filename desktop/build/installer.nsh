!include "WinMessages.nsh"
!include "${PROJECT_DIR}\build\terminal-command.nsh"
!include "${PROJECT_DIR}\build\agent-update-handoff.nsh"
!macro customInit
  !insertmacro ZyraPrepareAgentUpdate
!macroend
!include "${PROJECT_DIR}\build\windows-file-icons.nsh"


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

  !insertmacro ZyraInstallTerminal "stable"
  !insertmacro ZyraRecordAgentUpdateSuccess
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro ZyraUninstallFileIcons
    DeleteRegKey SHELL_CONTEXT "Software\Classes\*\shell\Zyra"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\shell\Zyra"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\Background\shell\Zyra"
    !insertmacro ZyraRemoveTerminal "stable"
  ${endIf}
!macroend
