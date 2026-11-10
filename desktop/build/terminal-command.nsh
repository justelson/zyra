!include "WinMessages.nsh"
!include "StrFunc.nsh"
!ifndef BUILD_UNINSTALLER
  ${StrStr}
!endif
; Install once per channel, outside the replaceable app folder. The launcher
; invokes the native TUI directly; Node is used only during installation/removal.
!macro ZyraInstallTerminal CHANNEL
  nsExec::ExecToLog '"$INSTDIR\resources\zyra-node\node.exe" "$INSTDIR\resources\zyra-runtime\src\desktop-tui-install-cli.mjs" install "--package=$INSTDIR\resources\zyra-tui" "--channel=${CHANNEL}" "--version=${VERSION}"'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "The matching terminal payload could not be installed."
    Abort
  ${EndIf}
  ReadRegStr $1 HKCU "Environment" "Path"
  ${StrStr} $2 "$1" "$LOCALAPPDATA\Zyra\bin"
  ${If} $2 == ""
    ${If} $1 == ""
      StrCpy $1 "$LOCALAPPDATA\Zyra\bin"
    ${Else}
      StrCpy $1 "$1;$LOCALAPPDATA\Zyra\bin"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" "$1"
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
!macroend
!macro ZyraRemoveTerminal CHANNEL
  nsExec::ExecToLog '"$INSTDIR\resources\zyra-node\node.exe" "$INSTDIR\resources\zyra-runtime\src\desktop-tui-install-cli.mjs" remove "--package=$INSTDIR\resources\zyra-tui" "--channel=${CHANNEL}" "--version=${VERSION}"'
  Pop $0
!macroend
