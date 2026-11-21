# Work around electron-builder 26.18.0's FIND_PROCESS bug: on Windows
# PowerShell 5.1, `(Get-CimInstance ... | ? {...}).Count` is $null when a
# single process matches, so the installer sees no running instance and never
# closes the app before uninstalling the old version.
#
# This include is injected before allowOnlyOneInstallerInstance.nsh, so
# defining customCheckAppRunning disables the built-in CHECK_APP_RUNNING and
# its getProcessInfo/$pid dependency.

!include "LogicLib.nsh"

!ifndef _OMNI_CHECK_APP_RUNNING_NSH
!define _OMNI_CHECK_APP_RUNNING_NSH

Var /GLOBAL omniAppRunning
Var /GLOBAL omniExecResult
Var /GLOBAL omniKillAttempt

# Sets ${_RETURN} to 1 when at least one process runs from $INSTDIR, and to 0
# otherwise. The @(...) wrapper makes .Count work for a single match too.
!macro _OMNI_APP_IS_RUNNING _RETURN
  ${If} $INSTDIR == ""
    # An empty path would make StartsWith('') match every process.
    StrCpy ${_RETURN} 0
  ${Else}
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$procs = @(Get-CimInstance -ClassName Win32_Process | Where-Object { ${_OMNI_PROCESS_FILTER} }); if ($$procs.Count -gt 0) { exit 0 } else { exit 1 }"`
    Pop $omniExecResult
    StrCpy ${_RETURN} 0
    ${If} $omniExecResult == "0"
      StrCpy ${_RETURN} 1
    ${EndIf}
  ${EndIf}
!macroend

# Stops processes running from $INSTDIR. The first attempt asks the app to
# close through its main window; retries use forced termination.
!macro _OMNI_STOP_APP _FORCE
  !if "${_FORCE}" == "1"
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { ${_OMNI_PROCESS_FILTER} } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  !else
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { ${_OMNI_PROCESS_FILTER} } | ForEach-Object { $$appProcess = Get-Process -Id $$_.ProcessId -ErrorAction SilentlyContinue; if ($$appProcess) { $$null = $$appProcess.CloseMainWindow() } }"`
  !endif
  Pop $omniExecResult
!macroend

!macro customCheckAppRunning
  # One process filter for the three PowerShell calls below. It is defined at
  # insertion time because APP_EXECUTABLE_FILENAME comes from common.nsh, which
  # is included after this file. The trailing backslash keeps a sibling
  # directory such as "$INSTDIR-old" out.
  !define /redef _OMNI_PROCESS_FILTER "$$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and $$_.Path -and $$_.Path.StartsWith('$INSTDIR\', [System.StringComparison]::CurrentCultureIgnoreCase)"

  !insertmacro _OMNI_APP_IS_RUNNING $omniAppRunning
  ${If} $omniAppRunning == 0
    Goto omni_check_done
  ${EndIf}

  ${If} ${isUpdated}
    # electron-updater already requested a graceful quit; give it time.
    Sleep 1000
    !insertmacro _OMNI_APP_IS_RUNNING $omniAppRunning
    ${If} $omniAppRunning == 0
      Goto omni_check_done
    ${EndIf}
  ${EndIf}

  ${If} ${Silent}
    Goto omni_stop_app
  ${EndIf}

  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" IDOK omni_stop_app
  Quit

  omni_stop_app:
  DetailPrint "$(appClosing)"
  !insertmacro _OMNI_STOP_APP 0
  Sleep 500

  StrCpy $omniKillAttempt 0

  omni_wait_loop:
    IntOp $omniKillAttempt $omniKillAttempt + 1
    !insertmacro _OMNI_APP_IS_RUNNING $omniAppRunning
    ${If} $omniAppRunning == 0
      Goto omni_check_done
    ${EndIf}

    ${If} $omniKillAttempt > 3
      ${If} ${Silent}
        SetErrorLevel 2
        Quit
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" IDRETRY omni_stop_app
      Quit
    ${EndIf}

    DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
    Sleep 500
    !insertmacro _OMNI_STOP_APP 1
    Sleep 500
    Goto omni_wait_loop

  omni_check_done:
!macroend

!endif
