Function un.AurumConfirm
  Call un.SkipIfPassive
  Call un.AurumPageBase
  !insertmacro AurumLabel 32% 2% 65% 5% "$(AurumStep) 1 / 3" $AurumFontBody ${AURUM_MUTED}
  !insertmacro AurumLabel 32% 11% 65% 12% "$(AurumUninstallTitle)" $AurumFontTitle ${AURUM_INK}
  !insertmacro AurumLabel 32% 26% 65% 16% "$(AurumUninstallIntro)" $AurumFontBody ${AURUM_MUTED}
  StrCpy $AurumUninstallRoots ""
  ExecWait '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --uninstall-data-list $\"${BUNDLEID}$\" $\"$PLUGINSDIR\data-roots.txt$\"' $0
  ${If} $0 = 0
    FileOpen $0 "$PLUGINSDIR\data-roots.txt" r
    ${Do}
      ClearErrors
      FileReadUTF16LE $0 $1
      ${IfThen} ${Errors} ${|} ${ExitDo} ${|}
      StrCpy $AurumUninstallRoots "$AurumUninstallRoots$1"
    ${Loop}
    FileClose $0
  ${EndIf}
  nsDialogs::CreateControl "EDIT" "${WS_VISIBLE}|${WS_CHILD}|${WS_TABSTOP}|${ES_MULTILINE}|${ES_READONLY}|${WS_VSCROLL}" "${WS_EX_CLIENTEDGE}" 32% 43% 65% 22% "$AurumUninstallRoots"
  Pop $AurumUninstallRootsText
  SetCtlColors $AurumUninstallRootsText ${AURUM_INK} F1F3EB
  ${NSD_CreateCheckbox} 32% 68% 65% 15% "$(AurumUninstallData)"
  Pop $DeleteAppDataCheckbox
  SetCtlColors $DeleteAppDataCheckbox ${AURUM_INK} ${AURUM_BG}
  ; Keep native multiline text: the custom checkbox renderer is single-line.
  ${NSD_AddStyle} $DeleteAppDataCheckbox ${BS_MULTILINE}
  ${NSD_SetState} $DeleteAppDataCheckbox $DeleteAppDataCheckboxState
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(AurumUninstallAction)"
  EnableWindow $mui.Button.Back 0
  nsDialogs::Show
  ${NSD_FreeImage} $AurumImageHandle
FunctionEnd

Function un.AurumConfirmLeave
  ${NSD_GetState} $DeleteAppDataCheckbox $DeleteAppDataCheckboxState
FunctionEnd

Function un.AurumFinish
  Call un.SkipIfPassive
  Call un.AurumPageBase
  !insertmacro AurumLabel 32% 2% 65% 5% "$(AurumStep) 3 / 3" $AurumFontBody ${AURUM_MUTED}
  !insertmacro AurumLabel 32% 17% 65% 14% "$(AurumUninstallDone)" $AurumFontTitle ${AURUM_INK}
  ${If} $DeleteAppDataCheckboxState = 1
    !insertmacro AurumLabel 32% 36% 65% 24% "$(AurumUninstallRemoved)" $AurumFontBody ${AURUM_MUTED}
  ${Else}
    !insertmacro AurumLabel 32% 36% 65% 24% "$(AurumUninstallKept)" $AurumFontBody ${AURUM_MUTED}
  ${EndIf}
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(AurumDone)"
  EnableWindow $mui.Button.Back 0
  nsDialogs::Show
  ${NSD_FreeImage} $AurumImageHandle
FunctionEnd
