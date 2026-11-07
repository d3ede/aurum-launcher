# Reviewed translations

`messages/uk.json` is a manually reviewed Ukrainian catalog. Keep its coverage
aligned with both the base JSON catalogs and the feature dictionaries in this
directory. Do not regenerate it with the machine translation seed or overwrite it
with the old locale overrides. `npm test` checks coverage, interpolation values,
conditional translation calls, engine statuses and errors, and Ukrainian plural
forms. The message translator also recognizes templates from the active locale
and known error prefixes followed by an OS or library diagnostic.

Use these terms consistently:

| Concept                      | Ukrainian       |
| ---------------------------- | --------------- |
| Installed Minecraft instance | збірка          |
| Downloadable modpack         | модпак          |
| Account                      | обліковий запис |
| Skin / cape                  | скін / плащ     |
| Log                          | журнал          |
| Folder                       | папка           |
| Mod loader                   | завантажувач    |

Use infinitives for action buttons (Додати, Зберегти, Видалити) and polite plural
instructions in explanatory text (Виберіть, Додайте). Preserve product names,
file extensions, paths, versions, and every `{{placeholder}}`. Translate the full
meaning of explanations, including what happens to existing data. For fractional
project counts, use `проєкту`; integer plural forms are `проєкт`, `проєкти`, and
`проєктів`.

Check new text in context at the minimum window size. Catalog descriptions,
user-provided names, and raw third-party logs are external content and must not
be rewritten by the UI translation layer.
