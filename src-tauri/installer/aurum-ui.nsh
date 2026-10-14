; Aurum installer presentation. Application installation remains in Tauri's template.
!include nsDialogs.nsh
!include LogicLib.nsh
!addplugindir "${__FILEDIR__}\..\..\target\installer-plugins"
!define AURUM_BG E3E5DC
!define AURUM_INK 2D392F
!define AURUM_MUTED 65715F
!include "${__FILEDIR__}\language-selection.nsh"
!include "${__FILEDIR__}\install-path.nsh"
Var AurumDialog
Var AurumImage
Var AurumImageHandle
Var AurumFontTitle
Var AurumFontBody
Var AurumFontAction
Var AurumPath
Var AurumDesktop
Var AurumStart
Var AurumDesktopChoice
Var AurumStartChoice
Var AurumRun
Var AurumRunChoice
Var AurumSizeMB
Var AurumFreeMB
Var AurumSpaceLabel
Var AurumRuntime
Var AurumDpi
Var AurumWidth
Var AurumHeight
Var AurumLayoutReady

!macro AurumLabel x y w h text font color
  ${NSD_CreateLabel} ${x} ${y} ${w} ${h} "${text}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} ${font} 1
  SetCtlColors $0 ${color} ${AURUM_BG}
!macroend

Function AurumInit
  ; Interactive/fresh installs never place application files in a drive root.
  ; Automatic updates retain the registered installation location.
  ${If} $UpdateMode <> 1
    StrCpy $0 $INSTDIR
    Call AurumNormalizeInstallPath
    StrCpy $INSTDIR $0
  ${EndIf}
  StrCpy $AurumDesktopChoice 1
  StrCpy $AurumStartChoice 1
  StrCpy $AurumRunChoice 1
  StrCpy $AppStartMenuFolder "${STARTMENUFOLDER}"
  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $0 != ""
    ClearErrors
    ReadRegDWORD $AurumDesktopChoice SHCTX "${MANUPRODUCTKEY}" "DesktopShortcut"
    ${If} ${Errors}
      StrCpy $AurumDesktopChoice 0
      ${IfThen} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk" ${|} StrCpy $AurumDesktopChoice 1 ${|}
    ${EndIf}
    ClearErrors
    ReadRegDWORD $AurumStartChoice SHCTX "${MANUPRODUCTKEY}" "StartMenuShortcut"
    ${If} ${Errors}
      StrCpy $AurumStartChoice 0
      ${IfThen} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk" ${|} StrCpy $AurumStartChoice 1 ${|}
      ${IfThen} ${FileExists} "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" ${|} StrCpy $AurumStartChoice 1 ${|}
    ${EndIf}
  ${ElseIf} $NoShortcutMode = 1
    StrCpy $AurumDesktopChoice 0
    StrCpy $AurumStartChoice 0
  ${EndIf}
  ; Include a conservative allowance for the generated uninstaller.
  IntOp $0 ${ESTIMATEDSIZE} + 512
  IntOp $0 $0 * 1024
  IntOp $0 $0 / 100000
  IntOp $1 $0 % 10
  IntOp $0 $0 / 10
  StrCpy $AurumSizeMB "$0.$1"
  InitPluginsDir
  File /oname=$PLUGINSDIR\aurum-sidebar.bmp "${__FILEDIR__}\sidebar.bmp"
  File /oname=$PLUGINSDIR\LICENSE.txt "${__FILEDIR__}\..\..\LICENSE"
  File /oname=$PLUGINSDIR\NOTICE.txt "${__FILEDIR__}\..\..\NOTICE"
  File /oname=$PLUGINSDIR\TAURI-MIT-LICENSE.txt "${__FILEDIR__}\TAURI-MIT-LICENSE"
FunctionEnd

Function AurumLayout
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
  StrCpy $AurumDpi $0
  ${IfThen} $AurumDpi < 96 ${|} StrCpy $AurumDpi 96 ${|}
  IntOp $AurumWidth 728 * $AurumDpi
  IntOp $AurumWidth $AurumWidth / 96
  IntOp $AurumHeight 470 * $AurumDpi
  IntOp $AurumHeight $AurumHeight / 96
  System::Call 'user32::SetWindowPos(p $HWNDPARENT,p0,i0,i0,i $AurumWidth,i $AurumHeight,i6)'
  ; Center once, preserving the position when the user drags the window.
  ${If} $AurumLayoutReady != 1
    System::Call 'user32::GetSystemMetrics(i0) i .r0'
    System::Call 'user32::GetSystemMetrics(i1) i .r1'
    IntOp $0 $0 - $AurumWidth
    IntOp $0 $0 / 2
    IntOp $1 $1 - $AurumHeight
    IntOp $1 $1 / 2
    System::Call 'user32::SetWindowPos(p $HWNDPARENT,p0,i r0,i r1,i0,i0,i5)'
    StrCpy $AurumLayoutReady 1
  ${EndIf}
  ShowWindow $mui.Header.Text 0
  ShowWindow $mui.Header.SubText 0
  ShowWindow $mui.Header.Background 0
  ShowWindow $mui.Header.Image 0
  ShowWindow $mui.Line.Standard 0
  ShowWindow $mui.Line.FullWindow 0
  ShowWindow $mui.Branding.Text 0
  ShowWindow $mui.Branding.Background 0
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 0
  SetCtlColors $HWNDPARENT ${AURUM_INK} ${AURUM_BG}
  GetDlgItem $0 $HWNDPARENT 1018
  IntOp $1 20 * $AurumDpi
  IntOp $1 $1 / 96
  IntOp $2 688 * $AurumDpi
  IntOp $2 $2 / 96
  IntOp $3 384 * $AurumDpi
  IntOp $3 $3 / 96
  System::Call 'user32::MoveWindow(p r0,i r1,i r1,i r2,i r3,i1)'
  IntOp $4 422 * $AurumDpi
  IntOp $4 $4 / 96
  IntOp $5 90 * $AurumDpi
  IntOp $5 $5 / 96
  IntOp $6 36 * $AurumDpi
  IntOp $6 $6 / 96
  IntOp $1 434 * $AurumDpi
  IntOp $1 $1 / 96
  System::Call 'user32::MoveWindow(p $mui.Button.Back,i r1,i r4,i r5,i r6,i1)'
  IntOp $5 170 * $AurumDpi
  IntOp $5 $5 / 96
  IntOp $1 538 * $AurumDpi
  IntOp $1 $1 / 96
  System::Call 'user32::MoveWindow(p $mui.Button.Next,i r1,i r4,i r5,i r6,i1)'
  IntOp $1 674 * $AurumDpi
  IntOp $1 $1 / 96
  IntOp $4 10 * $AurumDpi
  IntOp $4 $4 / 96
  IntOp $5 34 * $AurumDpi
  IntOp $5 $5 / 96
  System::Call 'user32::MoveWindow(p $mui.Button.Cancel,i r1,i r4,i r5,i r5,i1)'
  AurumUI::Initialize /NOUNLOAD "$HWNDPARENT"
  AurumUI::Button /NOUNLOAD "$mui.Button.Next" "1"
  AurumUI::Button /NOUNLOAD "$mui.Button.Back" "2"
  AurumUI::Button /NOUNLOAD "$mui.Button.Cancel" "3"
  SendMessage $mui.Button.Cancel ${WM_SETTEXT} 0 "STR:$(AurumClose)"
  SendMessage $mui.Button.Next ${WM_SETFONT} $AurumFontAction 1
FunctionEnd

Function AurumGuiInit
  CreateFont $AurumFontTitle "Segoe UI" 20 650
  CreateFont $AurumFontBody "Segoe UI" 10 400
  CreateFont $AurumFontAction "Segoe UI" 10 650
  Call AurumLayout
FunctionEnd

Function AurumPageBase
  Call AurumLayout
  nsDialogs::Create 1018
  Pop $AurumDialog
  ; The newly created page otherwise covers part of the close control.
  System::Call 'user32::SetWindowPos(p $mui.Button.Cancel,p0,i0,i0,i0,i0,i3)'
  SetCtlColors $AurumDialog ${AURUM_INK} ${AURUM_BG}
  ${NSD_CreateBitmap} 0 0 27% 100% ""
  Pop $AurumImage
  ${NSD_SetStretchedBitmap} $AurumImage "$PLUGINSDIR\aurum-sidebar.bmp" $AurumImageHandle
  AurumUI::DragPane /NOUNLOAD "$AurumImage"
FunctionEnd

Function AurumSetup
  Call SkipIfPassive
  Call AurumPageBase
  !insertmacro AurumLabel 32% 2% 65% 5% "$(AurumStep) 1 / 3" $AurumFontBody ${AURUM_MUTED}
  !insertmacro AurumLabel 32% 10% 65% 10% "$(AurumTitle)" $AurumFontTitle ${AURUM_INK}
  !insertmacro AurumLabel 32% 21% 65% 9% "$(AurumIntro)" $AurumFontBody ${AURUM_MUTED}
  !insertmacro AurumLabel 32% 33% 65% 5% "$(AurumFolder)" $AurumFontBody ${AURUM_INK}
  ${NSD_CreateDirRequest} 32% 39% 47% 7% "$INSTDIR"
  Pop $AurumPath
  SetCtlColors $AurumPath ${AURUM_INK} F1F3EB
  AurumUI::Edit /NOUNLOAD "$AurumPath"
  ${NSD_OnChange} $AurumPath AurumSpaceChanged
  ${NSD_CreateBrowseButton} 81% 39% 16% 7% "$(AurumBrowse)"
  Pop $0
  AurumUI::Button /NOUNLOAD "$0" "2"
  ${NSD_OnClick} $0 AurumBrowse
  !insertmacro AurumLabel 32% 50% 65% 6% "$(AurumSize)" $AurumFontBody ${AURUM_INK}
  ${NSD_CreateLabel} 32% 57% 65% 6% ""
  Pop $AurumSpaceLabel
  SetCtlColors $AurumSpaceLabel ${AURUM_MUTED} ${AURUM_BG}
  ReadRegStr $1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${If} $1 == ""
    ReadRegStr $1 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $1 == ""
    StrCpy $AurumRuntime "$(AurumRuntimeDownload)"
  ${Else}
    StrCpy $AurumRuntime "$(AurumRuntimeReady)"
  ${EndIf}
  !insertmacro AurumLabel 32% 64% 65% 8% "$AurumRuntime" $AurumFontBody ${AURUM_MUTED}
  ${NSD_CreateCheckbox} 32% 75% 65% 6% "$(AurumDesktop)"
  Pop $AurumDesktop
  AurumUI::Checkbox /NOUNLOAD "$AurumDesktop"
  SetCtlColors $AurumDesktop ${AURUM_INK} ${AURUM_BG}
  ${NSD_SetState} $AurumDesktop $AurumDesktopChoice
  ${NSD_CreateCheckbox} 32% 82% 65% 6% "$(AurumStart)"
  Pop $AurumStart
  AurumUI::Checkbox /NOUNLOAD "$AurumStart"
  SetCtlColors $AurumStart ${AURUM_INK} ${AURUM_BG}
  ${NSD_SetState} $AurumStart $AurumStartChoice
  ${NSD_CreateLink} 32% 94% 65% 5% "$(AurumLicense)"
  Pop $0
  AurumUI::Button /NOUNLOAD "$0" "5"
  ${NSD_OnClick} $0 AurumLicense
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(AurumInstall)"
  Call AurumSpaceChanged
  nsDialogs::Show
  ${NSD_FreeImage} $AurumImageHandle
FunctionEnd

Function AurumSpaceChanged
  ${NSD_GetText} $AurumPath $0
  ${GetRoot} "$0" $0
  StrCpy $AurumFreeMB "—"
  ${If} $0 != ""
    System::Call 'kernel32::GetDiskFreeSpaceExW(w r0,*l .r1,p0,p0) i .r2'
    ${If} $2 <> 0
      System::Int64Op $1 / 1000000
      Pop $AurumFreeMB
    ${EndIf}
  ${EndIf}
  ${NSD_SetText} $AurumSpaceLabel "$(AurumFree)"
FunctionEnd

Function AurumBrowse
  nsDialogs::SelectFolderDialog "$(AurumFolder)" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    Call AurumNormalizeInstallPath
    ${NSD_SetText} $AurumPath $0
  ${EndIf}
FunctionEnd

Function AurumLicense
  ExecShell "open" "$PLUGINSDIR\LICENSE.txt"
FunctionEnd

Function AurumSetupLeave
  ${NSD_GetText} $AurumPath $0
  Call AurumNormalizeInstallPath
  StrCpy $INSTDIR $0
  ${NSD_SetText} $AurumPath $INSTDIR
  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
  ${OrIf} $INSTDIR == $0
    MessageBox MB_ICONEXCLAMATION "$(AurumInvalidFolder)"
    Abort
  ${EndIf}
  System::Call 'kernel32::GetDiskFreeSpaceExW(w r0,*l .r1,p0,p0) i .r2'
  ${If} $2 <> 0
    IntOp $3 ${ESTIMATEDSIZE} + 512
    IntOp $3 $3 * 1024
    System::Int64Op $1 < $3
    Pop $0
    ${If} $0 = 1
      MessageBox MB_ICONEXCLAMATION "$(AurumNoSpace)"
      Abort
    ${EndIf}
  ${EndIf}
  ${NSD_GetState} $AurumDesktop $AurumDesktopChoice
  ${NSD_GetState} $AurumStart $AurumStartChoice
FunctionEnd

Function AurumFinish
  Call SkipIfPassive
  Call AurumPageBase
  !insertmacro AurumLabel 32% 2% 65% 5% "$(AurumStep) 3 / 3" $AurumFontBody ${AURUM_MUTED}
  !insertmacro AurumLabel 32% 16% 65% 12% "$(AurumReady)" $AurumFontTitle ${AURUM_INK}
  !insertmacro AurumLabel 32% 31% 65% 10% "$(AurumReadyText)" $AurumFontBody ${AURUM_MUTED}
  !insertmacro AurumLabel 32% 44% 65% 13% "$INSTDIR" $AurumFontBody ${AURUM_INK}
  ${NSD_CreateCheckbox} 32% 65% 65% 8% "$(AurumRun)"
  Pop $AurumRun
  AurumUI::Checkbox /NOUNLOAD "$AurumRun"
  SetCtlColors $AurumRun ${AURUM_INK} ${AURUM_BG}
  ${NSD_SetState} $AurumRun $AurumRunChoice
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(AurumDone)"
  EnableWindow $mui.Button.Back 0
  nsDialogs::Show
  ${NSD_FreeImage} $AurumImageHandle
FunctionEnd

Function AurumFinishLeave
  ${NSD_GetState} $AurumRun $AurumRunChoice
  ${IfThen} $AurumRunChoice = 1 ${|} Call RunMainBinary ${|}
FunctionEnd

!macro AurumMove handle x y w h
  IntOp $R0 ${x} * $AurumDpi
  IntOp $R0 $R0 / 96
  IntOp $R1 ${y} * $AurumDpi
  IntOp $R1 $R1 / 96
  IntOp $R2 ${w} * $AurumDpi
  IntOp $R2 $R2 / 96
  IntOp $R3 ${h} * $AurumDpi
  IntOp $R3 $R3 / 96
  System::Call 'user32::MoveWindow(p ${handle},i $R0,i $R1,i $R2,i $R3,i1)'
!macroend

Function AurumProgressShow
  Call AurumLayout
  SetCtlColors $mui.InstFilesPage ${AURUM_INK} ${AURUM_BG}
  !insertmacro AurumMove $mui.InstFilesPage 20 20 688 384
  System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i 0x5000000E,i0,i0,i228,i480,p $mui.InstFilesPage,p0,p0,p0)p .r0'
  StrCpy $AurumImage $0
  !insertmacro AurumMove $AurumImage 0 0 186 384
  ${NSD_SetStretchedBitmap} $AurumImage "$PLUGINSDIR\aurum-sidebar.bmp" $AurumImageHandle
  AurumUI::DragPane /NOUNLOAD "$AurumImage"
  System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "$(AurumStep) 2 / 3",i 0x50000000,i270,i10,i530,i30,p $mui.InstFilesPage,p0,p0,p0)p .r0'
  !insertmacro AurumMove $0 220 10 447 28
  SendMessage $0 ${WM_SETFONT} $AurumFontBody 1
  SetCtlColors $0 ${AURUM_MUTED} ${AURUM_BG}
  System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "$(AurumTitle)",i 0x50000000,i270,i50,i530,i50,p $mui.InstFilesPage,p0,p0,p0)p .r0'
  !insertmacro AurumMove $0 220 50 447 40
  SendMessage $0 ${WM_SETFONT} $AurumFontTitle 1
  SetCtlColors $0 ${AURUM_INK} ${AURUM_BG}
  !insertmacro AurumMove $mui.InstFilesPage.Text 220 100 447 30
  SetCtlColors $mui.InstFilesPage.Text ${AURUM_MUTED} ${AURUM_BG}
  !insertmacro AurumMove $mui.InstFilesPage.ProgressBar 220 148 447 18
  !insertmacro AurumMove $mui.InstFilesPage.Log 220 192 447 148
  !insertmacro AurumMove $mui.InstFilesPage.ShowLogButton 220 350 180 30
  AurumUI::Button /NOUNLOAD "$mui.InstFilesPage.ShowLogButton" "2"
  System::Call 'user32::SetWindowPos(p $mui.Button.Cancel,p0,i0,i0,i0,i0,i3)'
FunctionEnd

Function AurumShortcuts
  ${If} $NoShortcutMode <> 1
    ${If} $AurumStartChoice = 1
      Call CreateOrUpdateStartMenuShortcut
    ${ElseIf} $UpdateMode <> 1
      !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${IfThen} $0 = 1 ${|} Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk" ${|}
      !if "${STARTMENUFOLDER}" != ""
        !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
        Pop $0
        ${IfThen} $0 = 1 ${|} Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" ${|}
        RMDir "$SMPROGRAMS\$AppStartMenuFolder"
      !endif
    ${EndIf}
    ${If} $AurumDesktopChoice = 1
      Call CreateOrUpdateDesktopShortcut
    ${ElseIf} $UpdateMode <> 1
      !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${IfThen} $0 = 1 ${|} Delete "$DESKTOP\${PRODUCTNAME}.lnk" ${|}
    ${EndIf}
    !if "${STARTMENUFOLDER}" != ""
      WriteRegStr SHCTX "${MANUPRODUCTKEY}" "Start Menu Folder" "$AppStartMenuFolder"
    !endif
    WriteRegDWORD SHCTX "${MANUPRODUCTKEY}" "DesktopShortcut" $AurumDesktopChoice
    WriteRegDWORD SHCTX "${MANUPRODUCTKEY}" "StartMenuShortcut" $AurumStartChoice
  ${EndIf}
FunctionEnd

!include "${__FILEDIR__}\languages.nsh"
