const fs = require('node:fs');
const path = require('node:path');
const overrides = require('./locale-overrides.cjs');
for(const [code,values] of Object.entries(require('./skin-locale-overrides.cjs'))) {
  overrides[code] = {...overrides[code], ...values};
}
Object.assign(overrides.es, {
  'Поиск проектов':'Buscar proyectos',
  'Быстрый поиск проектов':'Búsqueda rápida de proyectos',
  'Пример форматов':'Ejemplo de formato',
  'Тёплый свет':'Claro', 'Тихий вечер':'Oscuro',
  'Системная тема':'Tema del sistema', 'Язык сохранён':'Idioma guardado',
  'Выберите язык или используйте язык системы.':'Elige un idioma o usa el del sistema.',
  'Переключение сразу, без перезапуска.':'Se aplica al instante, sin reiniciar.',
  'Другие регионы':'Otros idiomas', 'Язык не найден':'No se encontró el idioma',
});
Object.assign(overrides.uk, {
  'Поиск проектов':'Пошук проєктів',
  'Быстрый поиск проектов':'Швидкий пошук проєктів',
  'Пример форматов':'Приклад форматів',
  'Тёплый свет':'Світла', 'Тихий вечер':'Темна',
  'Системная тема':'Системна тема', 'Язык сохранён':'Мову збережено',
  'Выберите язык или используйте язык системы.':'Виберіть мову або використовуйте мову системи.',
  'Переключение сразу, без перезапуска.':'Зміни застосовуються одразу, без перезапуску.',
  'Другие регионы':'Інші регіони', 'Язык не найден':'Мову не знайдено',
});
Object.assign(overrides.sr, {'@project.few':'пројекта', '@project.many':'пројеката', '@project.other':'пројеката'});
Object.assign(overrides.hr, {'@project.few':'projekta', '@project.many':'projekata', '@project.other':'projekata'});
Object.assign(overrides.sl, {'@project.two':'projekta', '@project.few':'projekti', '@project.other':'projektov'});
Object.assign(overrides.lt, {'@project.few':'projektai', '@project.many':'projekto', '@project.other':'projektų'});
Object.assign(overrides.lv, {'@project.zero':'projektu', '@project.other':'projekti'});
const folder = path.resolve(__dirname, '../src/locales/messages');
for (const [code, fixed] of Object.entries(overrides)) {
  const file = path.join(folder, `${code}.json`);
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(pack, fixed);
  for (const key of Object.keys(pack)) {
    if (fixed[key.trim()] !== undefined) pack[key] = key.match(/^\s*/)[0] + fixed[key.trim()] + key.match(/\s*$/)[0];
  }
  fs.writeFileSync(file, JSON.stringify(pack, null, 2) + '\n');
}
