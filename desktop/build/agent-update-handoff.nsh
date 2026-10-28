!ifndef ZYRA_AGENT_UPDATE_HANDOFF
!define ZYRA_AGENT_UPDATE_HANDOFF
!ifndef BUILD_UNINSTALLER
Var /GLOBAL ZyraAgentUpdateMutex
Var /GLOBAL ZyraAgentUpdateNonce
Var /GLOBAL ZyraAgentUpdateConfirmed
!endif

; PRODUCT_NAME matches app.getPath('userData'); APP_FILENAME names the install folder.
; NSIS declares the agent update before replacing any installed files.
!macro ZyraPrepareAgentUpdate
  StrCpy $ZyraAgentUpdateConfirmed 0
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\ZyraAgentUpdate.${APP_FILENAME}") p .r0'
  StrCpy $ZyraAgentUpdateMutex $0
  System::Call 'kernel32::GetLastError() i .r1'
  StrCmp $0 0 zyraAgentUpdateAbort
  StrCmp $1 183 zyraAgentUpdateAbort
  ; An in-app update starts NSIS early, but permission arrives only at will-quit.
  IfFileExists "$APPDATA\${PRODUCT_NAME}\updates\installer-pending-${VERSION}.flag" zyraAgentAutomaticUpdate
  ; Fresh and legacy installations bootstrap without the unavailable app protocol.
  IfFileExists "$INSTDIR\resources\zyra-runtime\src\agent-server\update-maintenance.mjs" 0 zyraAgentUpdateBootstrap
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 zyraAgentUpdateBootstrap
  System::Call 'ole32::CoCreateGuid(g .r0)'
  StrCpy $ZyraAgentUpdateNonce $0
  StrCpy $R1 "$APPDATA\${PRODUCT_NAME}\updates\installer-requests"
  CreateDirectory "$R1"
  FileOpen $R2 "$R1\$ZyraAgentUpdateNonce.request" w
  FileWrite $R2 "${VERSION}"
  FileClose $R2
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--zyra-prepare-update=$ZyraAgentUpdateNonce"'
  StrCpy $R3 0
  zyraAgentManualWait:
    IfFileExists "$R1\$ZyraAgentUpdateNonce.later" zyraAgentManualLater
    IfFileExists "$R1\$ZyraAgentUpdateNonce.ready" zyraAgentManualReady
    Sleep 500
    IntOp $R3 $R3 + 1
    IntCmp $R3 600 zyraAgentManualLater zyraAgentManualWait zyraAgentManualLater
  zyraAgentManualReady:
    FileOpen $R2 "$R1\$ZyraAgentUpdateNonce.ready" r
    FileRead $R2 $R4
    FileClose $R2
    StrCmp $R4 "${VERSION}" 0 zyraAgentManualLater
    Delete "$R1\$ZyraAgentUpdateNonce.ready"
    Delete "$R1\$ZyraAgentUpdateNonce.request"
    StrCpy $ZyraAgentUpdateConfirmed 1
    Goto zyraAgentUpdateBootstrap
  zyraAgentManualLater:
    Delete "$R1\$ZyraAgentUpdateNonce.request"
    Delete "$R1\$ZyraAgentUpdateNonce.later"
    Abort
  zyraAgentAutomaticUpdate:
    FileOpen $R2 "$APPDATA\${PRODUCT_NAME}\updates\installer-pending-${VERSION}.flag" r
    FileRead $R2 $ZyraAgentUpdateNonce
    FileClose $R2
    StrCpy $R3 0
  zyraAgentAutomaticWait:
    IfFileExists "$APPDATA\${PRODUCT_NAME}\updates\installer-pending-${VERSION}.flag" 0 zyraAgentUpdateAbort
    IfFileExists "$APPDATA\${PRODUCT_NAME}\updates\installer-ready-${VERSION}.flag" zyraAgentAutomaticReady
    Sleep 500
    IntOp $R3 $R3 + 1
    IntCmp $R3 600 zyraAgentUpdateAbort zyraAgentAutomaticWait zyraAgentUpdateAbort
  zyraAgentAutomaticReady:
    FileOpen $R2 "$APPDATA\${PRODUCT_NAME}\updates\installer-ready-${VERSION}.flag" r
    FileRead $R2 $R4
    FileClose $R2
    StrCmp $R4 $ZyraAgentUpdateNonce 0 zyraAgentUpdateAbort
    Delete "$APPDATA\${PRODUCT_NAME}\updates\installer-ready-${VERSION}.flag"
    Delete "$APPDATA\${PRODUCT_NAME}\updates\installer-pending-${VERSION}.flag"
    StrCpy $ZyraAgentUpdateConfirmed 1
    Goto zyraAgentUpdateBootstrap
  zyraAgentUpdateAbort:
    Abort
  zyraAgentUpdateBootstrap:
!macroend

; Replace electron-builder's stop/force-kill fallback. The exact installed image
; must release its file lock naturally, or installation is aborted.
!macro customCheckAppRunning
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 zyraImageReleased
  StrCpy $R5 0
  zyraWaitForImage:
    ClearErrors
    FileOpen $R6 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
    IfErrors zyraImageStillOpen
    FileClose $R6
    Goto zyraImageReleased
  zyraImageStillOpen:
    Sleep 100
    IntOp $R5 $R5 + 1
    IntCmp $R5 300 zyraImageReleaseFailed zyraWaitForImage zyraImageReleaseFailed
  zyraImageReleaseFailed:
    Abort
  zyraImageReleased:
!macroend

!macro ZyraRecordAgentUpdateSuccess
  ${If} $ZyraAgentUpdateConfirmed != 1
    StrCpy $ZyraAgentUpdateNonce "bootstrap-complete"
  ${EndIf}
    CreateDirectory "$APPDATA\${PRODUCT_NAME}\assistant\agent-server"
    ClearErrors
    FileOpen $R2 "$APPDATA\${PRODUCT_NAME}\assistant\agent-server\install-success-${VERSION}.flag" w
    IfErrors zyraSuccessReceiptFailed
    FileWrite $R2 "$ZyraAgentUpdateNonce"
    FileClose $R2
    Goto zyraSuccessReceiptSaved
    zyraSuccessReceiptFailed:
      Abort
    zyraSuccessReceiptSaved:
!macroend
!endif
