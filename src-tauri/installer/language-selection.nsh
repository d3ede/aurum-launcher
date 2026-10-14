; Use the Windows display language, including regional variants.
; Unknown languages fall back to English; no downloads or language packs.
Function AurumMatchLanguage
  IntOp $0 $0 & 0x3FF
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  ${Switch} $0
    ${Case} 25
      StrCpy $LANGUAGE ${LANG_RUSSIAN}
      ${Break}
    ${Case} 34
      StrCpy $LANGUAGE ${LANG_UKRAINIAN}
      ${Break}
    ${Case} 10
      StrCpy $LANGUAGE ${LANG_SPANISH}
      ${Break}
    ${Case} 7
      StrCpy $LANGUAGE ${LANG_GERMAN}
      ${Break}
    ${Case} 12
      StrCpy $LANGUAGE ${LANG_FRENCH}
      ${Break}
    ${Case} 21
      StrCpy $LANGUAGE ${LANG_POLISH}
      ${Break}
  ${EndSwitch}
FunctionEnd

Function AurumSelectLanguage
  System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
  Call AurumMatchLanguage
FunctionEnd
