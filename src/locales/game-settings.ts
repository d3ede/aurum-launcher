const messages: Record<string, [string, string, string]> = {
  title: ["Game settings", "Настройки игры", "Налаштування гри"],
  description: [
    "Save your Minecraft preferences and choose a preset when installing an instance.",
    "Сохраните привычные настройки Minecraft и выбирайте профиль при установке сборки.",
    "Збережіть звичні налаштування Minecraft та вибирайте профіль під час установлення збірки.",
  ],
  destination: [
    "Minecraft preferences and up to five settings profiles",
    "Настройки Minecraft и до пяти профилей",
    "Налаштування Minecraft і до п’яти профілів",
  ],
  intro: [
    "Your Minecraft, in any instance",
    "Привычный Minecraft в любой сборке",
    "Звичний Minecraft у будь-якій збірці",
  ],
  introText: [
    "Import a copy of your settings, adjust them here and choose what travels with you.",
    "Импортируйте копию настроек, подстройте их здесь и выберите, что переносить.",
    "Імпортуйте копію налаштувань, змініть їх тут і виберіть, що переносити.",
  ],
  profiles: ["Settings profiles", "Профили настроек", "Профілі налаштувань"],
  profile: ["Settings profile", "Профиль настроек", "Профіль налаштувань"],
  editor: [
    "Settings profile editor",
    "Редактор профиля настроек",
    "Редактор профілю налаштувань",
  ],
  new: ["Create profile", "Создать профиль", "Створити профіль"],
  import: [
    "Import from instance",
    "Импортировать из сборки",
    "Імпортувати зі збірки",
  ],
  limit: [
    "You can save up to five profiles. Update or delete an existing profile to make room.",
    "Можно сохранить до пяти профилей. Обновите или удалите существующий, чтобы освободить место.",
    "Можна зберегти до п’яти профілів. Оновіть або видаліть наявний, щоб звільнити місце.",
  ],
  local: [
    "Profiles are stored on this computer. Editing a preset does not change the source instance.",
    "Профили хранятся на этом компьютере. Редактирование не меняет исходную сборку.",
    "Профілі зберігаються на цьому комп’ютері. Редагування не змінює вихідну збірку.",
  ],
  source: [
    "From {{name}} · Minecraft {{version}}",
    "Из «{{name}}» · Minecraft {{version}}",
    "Із «{{name}}» · Minecraft {{version}}",
  ],
  defaults: [
    "Standard settings · Minecraft {{version}}",
    "Стандартные настройки · Minecraft {{version}}",
    "Стандартні налаштування · Minecraft {{version}}",
  ],
  name: ["Profile name", "Название профиля", "Назва профілю"],
  namePlaceholder: [
    "For example: Everyday, Performance, Quiet",
    "Например: Основной, Для FPS, Тихий",
    "Наприклад: Основний, Для FPS, Тихий",
  ],
  untitled: ["Untitled profile", "Без названия", "Без назви"],
  categories: ["What to transfer", "Что переносить", "Що переносити"],
  categoriesText: [
    "Open a category to edit it. Its switch controls whether it is applied to instances.",
    "Откройте категорию для настройки. Переключатель включает её перенос в сборки.",
    "Відкрийте категорію для налаштування. Перемикач вмикає її перенесення до збірок.",
  ],
  configure: [
    "Configure {{name}}",
    "Настроить: {{name}}",
    "Налаштувати: {{name}}",
  ],
  transfer: ["Transfer", "Переносить", "Переносити"],
  keepPack: [
    "Keep instance settings",
    "Оставлять как в сборке",
    "Залишати як у збірці",
  ],
  transferCategory: [
    "Transfer: {{name}}",
    "Переносить: {{name}}",
    "Переносити: {{name}}",
  ],
  saved: [
    "Settings profile saved",
    "Профиль настроек сохранён",
    "Профіль налаштувань збережено",
  ],
  save: ["Save profile", "Сохранить профиль", "Зберегти профіль"],
  unsaved: [
    "Unsaved changes",
    "Есть несохранённые изменения",
    "Є незбережені зміни",
  ],
  unsavedText: [
    "Save your changes before opening another profile?",
    "Сохранить изменения перед открытием другого профиля?",
    "Зберегти зміни перед відкриттям іншого профілю?",
  ],
  discard: ["Discard changes", "Не сохранять", "Не зберігати"],
  ready: [
    "Ready to use when installing instances",
    "Готов к выбору при установке сборки",
    "Готовий до вибору під час установлення збірки",
  ],
  chooseCategory: [
    "Choose at least one category to transfer.",
    "Выберите хотя бы одну категорию для переноса.",
    "Виберіть хоча б одну категорію для перенесення.",
  ],
  replaceImport: [
    "Update from instance",
    "Обновить из сборки",
    "Оновити зі збірки",
  ],
  importText: [
    "A copy of options.txt is saved. The original instance stays as it is.",
    "Сохраняется копия options.txt. Исходная сборка остаётся без изменений.",
    "Зберігається копія options.txt. Вихідна збірка залишається без змін.",
  ],
  importSource: ["Source instance", "Сборка-источник", "Збірка-джерело"],
  chooseSource: ["Choose an instance", "Выберите сборку", "Виберіть збірку"],
  useDefaults: [
    "Standard Minecraft 1.21.1 settings",
    "Стандартные настройки Minecraft 1.21.1",
    "Стандартні налаштування Minecraft 1.21.1",
  ],
  closeBeforeImport: [
    "Close the game before importing: Minecraft writes its latest settings when it exits.",
    "Закройте игру перед импортом: Minecraft записывает последние настройки при выходе.",
    "Закрийте гру перед імпортом: Minecraft записує останні налаштування під час виходу.",
  ],
  replaceCurrent: [
    "Replace the current settings profile",
    "Заменить текущий профиль настроек",
    "Замінити поточний профіль налаштувань",
  ],
  importAction: [
    "Import settings",
    "Импортировать настройки",
    "Імпортувати налаштування",
  ],
  createAction: ["Create profile", "Создать профиль", "Створити профіль"],
  delete: [
    "Delete settings profile",
    "Удалить профиль настроек",
    "Видалити профіль налаштувань",
  ],
  deleteText: [
    "Delete “{{name}}”? Settings already applied to instances will stay in place.",
    "Удалить «{{name}}»? Уже применённые настройки сборок сохранятся.",
    "Видалити «{{name}}»? Уже застосовані налаштування збірок збережуться.",
  ],
  empty: [
    "Keep your favourite settings",
    "Сохраните привычные настройки",
    "Збережіть звичні налаштування",
  ],
  emptyText: [
    "Import them from an instance you have already configured, or create a new profile.",
    "Импортируйте их из уже настроенной сборки или создайте новый профиль.",
    "Імпортуйте їх із уже налаштованої збірки або створіть новий профіль.",
  ],
  applyExisting: [
    "Apply to an instance",
    "Применить к сборке",
    "Застосувати до збірки",
  ],
  applyText: [
    "Only selected categories will change. Existing options.txt is backed up before the first application. Close Minecraft first.",
    "Изменятся только выбранные категории. Перед первым применением сохраняется исходный options.txt. Сначала закройте Minecraft.",
    "Зміняться лише вибрані категорії. Перед першим застосуванням зберігається вихідний options.txt. Спочатку закрийте Minecraft.",
  ],
  instance: ["Instance", "Сборка", "Збірка"],
  applied: [
    "Settings applied",
    "Настройки применены",
    "Налаштування застосовано",
  ],
  apply: ["Apply profile", "Применить профиль", "Застосувати профіль"],
  restore: [
    "Restore original settings",
    "Вернуть исходные настройки",
    "Повернути вихідні налаштування",
  ],
  restored: [
    "Original settings restored",
    "Исходные настройки восстановлены",
    "Вихідні налаштування відновлено",
  ],
  partial: [
    "Settings applied: {{applied}} · skipped for compatibility: {{skipped}}",
    "Применено настроек: {{applied}} · пропущено для совместимости: {{skipped}}",
    "Застосовано налаштувань: {{applied}} · пропущено для сумісності: {{skipped}}",
  ],
  installWarning: [
    "The instance is installed, but its settings could not be applied. You can apply them again in Game settings.",
    "Сборка установлена, но настройки применить не удалось. Повторите применение в разделе «Настройки игры».",
    "Збірку встановлено, але налаштування застосувати не вдалося. Повторіть застосування в розділі «Налаштування гри».",
  ],
  useMine: [
    "Use my settings",
    "Использовать мои настройки",
    "Використовувати мої налаштування",
  ],
  choosePreset: ["Settings profile", "Профиль настроек", "Профіль налаштувань"],
  installHint: [
    "Applies the categories saved in this profile once, after installation. Other instance settings are preserved.",
    "После установки один раз применятся категории из выбранного профиля. Остальные настройки сборки сохранятся.",
    "Після встановлення один раз застосуються категорії з вибраного профілю. Решта налаштувань збірки збережеться.",
  ],
  chooseArchive: [
    "Choose modpack file",
    "Выбрать файл сборки",
    "Вибрати файл збірки",
  ],
  editText: [
    "Profile settings for Minecraft {{version}}. Changes are saved with the profile.",
    "Параметры профиля для Minecraft {{version}}. Изменения сохраняются вместе с профилем.",
    "Параметри профілю для Minecraft {{version}}. Зміни зберігаються разом із профілем.",
  ],
  done: ["Done", "Готово", "Готово"],
  keyBindings: ["Key bindings", "Назначение клавиш", "Призначення клавіш"],
  keyHint: [
    "Select a key to rebind it. Mod controls stay with the instance.",
    "Нажмите на клавишу для замены. Управление модов остаётся в сборке.",
    "Натисніть клавішу для заміни. Керування модів залишається у збірці.",
  ],
  conflicts: [
    "Some actions share a key. Check the highlighted bindings.",
    "Некоторым действиям назначена одна клавиша. Проверьте выделенные назначения.",
    "Деяким діям призначено одну клавішу. Перевірте виділені призначення.",
  ],
  bind: ["Rebind: {{name}}", "Назначить: {{name}}", "Призначити: {{name}}"],
  resetBinding: ["Reset: {{name}}", "Сбросить: {{name}}", "Скинути: {{name}}"],
  captureTitle: [
    "Key binding: {{name}}",
    "Клавиша: {{name}}",
    "Клавіша: {{name}}",
  ],
  capturePrompt: [
    "Press a key or click here with a mouse button",
    "Нажмите клавишу или щёлкните здесь кнопкой мыши",
    "Натисніть клавішу або клацніть тут кнопкою миші",
  ],
  captureEscape: [
    "Escape cancels the assignment",
    "Escape отменяет назначение",
    "Escape скасовує призначення",
  ],
  unsupportedKey: [
    "This key cannot be assigned. Choose another key.",
    "Эту клавишу назначить нельзя. Выберите другую.",
    "Цю клавішу призначити не можна. Виберіть іншу.",
  ],
  unbind: ["Unbind", "Не назначена", "Не призначено"],
  auto: ["Auto", "Авто", "Авто"],
  unlimited: ["Unlimited", "Без ограничения", "Без обмеження"],
  fast: ["Fast", "Быстрая", "Швидка"],
  fancy: ["Fancy", "Красивая", "Красива"],
  fabulous: ["Fabulous!", "Великолепная!", "Неймовірна!"],
  custom: ["Custom", "Своя", "Власна"],
  all: ["All", "Все", "Усі"],
  decreased: ["Decreased", "Меньше", "Менше"],
  minimal: ["Minimal", "Минимум", "Мінімум"],
  "category.graphics": ["Graphics", "Графика", "Графіка"],
  "summary.graphics": [
    "Quality, render distance and frame rate",
    "Качество, дальность и частота кадров",
    "Якість, відстань і частота кадрів",
  ],
  "category.fov": ["Field of view", "Поле зрения", "Поле зору"],
  "summary.fov": [
    "FOV and camera effects",
    "FOV и эффекты камеры",
    "FOV та ефекти камери",
  ],
  "category.controls": ["Controls", "Управление", "Керування"],
  "summary.controls": [
    "Keys, sprinting and sneaking",
    "Клавиши, бег и приседание",
    "Клавіші, біг і присідання",
  ],
  "category.mouse": ["Mouse", "Мышь", "Миша"],
  "summary.mouse": [
    "Sensitivity, input and scrolling",
    "Чувствительность, ввод и прокрутка",
    "Чутливість, введення й прокручування",
  ],
  "category.sound": ["Music & sounds", "Музыка и звуки", "Музика та звуки"],
  "summary.sound": [
    "Volume for every sound category",
    "Громкость каждой категории звуков",
    "Гучність кожної категорії звуків",
  ],
  "category.interface": [
    "Interface & language",
    "Интерфейс и язык",
    "Інтерфейс і мова",
  ],
  "summary.interface": [
    "GUI scale, language and chat",
    "Размер интерфейса, язык и чат",
    "Розмір інтерфейсу, мова та чат",
  ],
};
const options: Record<string, [string, string, string]> = {
  fov: ["Field of view", "Поле зрения", "Поле зору"],
  bobView: ["View bobbing", "Покачивание камеры", "Похитування камери"],
  fovEffectScale: ["FOV effects", "Изменение FOV", "Зміна FOV"],
  mouseSensitivity: ["Sensitivity", "Чувствительность", "Чутливість"],
  invertYMouse: ["Invert mouse", "Инверсия мыши", "Інверсія миші"],
  rawMouseInput: ["Raw input", "Прямой ввод", "Пряме введення"],
  mouseWheelSensitivity: [
    "Scroll sensitivity",
    "Чувствительность прокрутки",
    "Чутливість прокручування",
  ],
  discrete_mouse_scroll: [
    "Discrete scrolling",
    "Дискретная прокрутка",
    "Дискретне прокручування",
  ],
  touchscreen: [
    "Touchscreen mode",
    "Сенсорное управление",
    "Сенсорне керування",
  ],
  autoJump: ["Auto-jump", "Автопрыжок", "Автострибок"],
  toggleCrouch: [
    "Toggle sneak",
    "Приседание переключением",
    "Присідання перемиканням",
  ],
  toggleSprint: ["Toggle sprint", "Бег переключением", "Біг перемиканням"],
  renderDistance: [
    "Render distance (chunks)",
    "Дальность прорисовки (чанки)",
    "Відстань промальовування (чанки)",
  ],
  simulationDistance: [
    "Simulation distance (chunks)",
    "Дальность симуляции (чанки)",
    "Відстань симуляції (чанки)",
  ],
  maxFps: ["Maximum frame rate", "Ограничение FPS", "Обмеження FPS"],
  enableVsync: [
    "VSync",
    "Вертикальная синхронизация",
    "Вертикальна синхронізація",
  ],
  graphicsMode: ["Graphics quality", "Качество графики", "Якість графіки"],
  fancyGraphics: ["Fancy graphics", "Красивая графика", "Красива графіка"],
  graphicsPreset: ["Graphics preset", "Графический пресет", "Графічний пресет"],
  particles: ["Particles", "Частицы", "Частинки"],
  entityShadows: ["Entity shadows", "Тени сущностей", "Тіні сутностей"],
  entityDistanceScaling: [
    "Entity distance",
    "Дальность сущностей",
    "Відстань сутностей",
  ],
  gamma: ["Brightness", "Яркость", "Яскравість"],
  mipmapLevels: [
    "Mipmap levels",
    "Уровни детализации текстур",
    "Рівні деталізації текстур",
  ],
  biomeBlendRadius: [
    "Biome blend radius",
    "Смешивание биомов",
    "Змішування біомів",
  ],
  soundCategory_master: [
    "Master volume",
    "Общая громкость",
    "Загальна гучність",
  ],
  soundCategory_music: ["Music", "Музыка", "Музика"],
  soundCategory_record: [
    "Jukebox / note blocks",
    "Проигрыватели и нотные блоки",
    "Програвачі та нотні блоки",
  ],
  soundCategory_weather: ["Weather", "Погода", "Погода"],
  soundCategory_block: ["Blocks", "Блоки", "Блоки"],
  soundCategory_hostile: [
    "Hostile creatures",
    "Враждебные существа",
    "Ворожі істоти",
  ],
  soundCategory_neutral: [
    "Friendly creatures",
    "Мирные существа",
    "Мирні істоти",
  ],
  soundCategory_player: ["Players", "Игроки", "Гравці"],
  soundCategory_ambient: ["Ambient / environment", "Окружение", "Оточення"],
  soundCategory_voice: ["Voice / narrator", "Голос и диктор", "Голос і диктор"],
  guiScale: ["GUI scale", "Размер интерфейса", "Розмір інтерфейсу"],
  lang: ["Minecraft language", "Язык Minecraft", "Мова Minecraft"],
  forceUnicodeFont: ["Force Unicode font", "Шрифт Unicode", "Шрифт Unicode"],
  showSubtitles: ["Subtitles", "Субтитры", "Субтитри"],
  chatScale: ["Chat scale", "Масштаб чата", "Масштаб чату"],
  chatOpacity: ["Chat opacity", "Непрозрачность чата", "Непрозорість чату"],
  chatWidth: ["Chat width", "Ширина чата", "Ширина чату"],
  chatHeightFocused: [
    "Focused chat height",
    "Высота открытого чата",
    "Висота відкритого чату",
  ],
  chatHeightUnfocused: [
    "Unfocused chat height",
    "Высота закрытого чата",
    "Висота закритого чату",
  ],
};
const keys: Record<string, [string, string, string]> = {
  forward: ["Forward", "Вперёд", "Уперед"],
  left: ["Left", "Влево", "Ліворуч"],
  back: ["Back", "Назад", "Назад"],
  right: ["Right", "Вправо", "Праворуч"],
  jump: ["Jump", "Прыжок", "Стрибок"],
  sneak: ["Sneak", "Приседание", "Присідання"],
  sprint: ["Sprint", "Бег", "Біг"],
  inventory: ["Inventory", "Инвентарь", "Інвентар"],
  drop: ["Drop item", "Выбросить предмет", "Викинути предмет"],
  swapOffhand: ["Swap hands", "Сменить руку", "Змінити руку"],
  attack: ["Attack / destroy", "Атака / разрушение", "Атака / руйнування"],
  use: [
    "Use item / place block",
    "Использовать / поставить блок",
    "Використати / поставити блок",
  ],
  pickItem: ["Pick block", "Выбрать блок", "Вибрати блок"],
  chat: ["Open chat", "Открыть чат", "Відкрити чат"],
  command: ["Open command", "Ввести команду", "Увести команду"],
  playerlist: ["Player list", "Список игроков", "Список гравців"],
  togglePerspective: ["Change perspective", "Сменить вид", "Змінити вигляд"],
  screenshot: ["Screenshot", "Скриншот", "Знімок екрана"],
  fullscreen: ["Toggle fullscreen", "Полный экран", "Повний екран"],
};
for (let i = 1; i <= 9; i++)
  keys[`hotbar.${i}`] = [`Hotbar slot ${i}`, `Ячейка ${i}`, `Комірка ${i}`];
const all = {
  ...messages,
  ...Object.fromEntries(
    Object.entries(options).map(([key, value]) => [`option.${key}`, value]),
  ),
  ...Object.fromEntries(
    Object.entries(keys).map(([key, value]) => [`key.${key}`, value]),
  ),
};
const language = (index: number) =>
  Object.fromEntries(
    Object.entries(all).map(([key, value]) => [`@game.${key}`, value[index]]),
  );
const errors: Record<string, [string, string]> = {
  "В сборке нет options.txt. Запустите Minecraft, настройте игру и закройте её.":
    [
      "The instance has no options.txt. Launch Minecraft, configure it and close the game.",
      "У збірці немає options.txt. Запустіть Minecraft, налаштуйте гру та закрийте її.",
    ],
  "Файл настроек слишком большой": [
    "The settings file is too large",
    "Файл налаштувань завеликий",
  ],
  "Файл настроек должен быть в UTF-8": [
    "The settings file must use UTF-8",
    "Файл налаштувань має бути в UTF-8",
  ],
  "Неверный файл настроек": [
    "Invalid settings file",
    "Некоректний файл налаштувань",
  ],
  "Выберите хотя бы одну категорию настроек": [
    "Select at least one settings category",
    "Виберіть хоча б одну категорію налаштувань",
  ],
  "Можно сохранить не больше пяти профилей настроек": [
    "You can save up to five settings profiles",
    "Можна зберегти не більше п’яти профілів налаштувань",
  ],
  "Профили настроек поддерживают Minecraft Java": [
    "Settings profiles support Minecraft Java",
    "Профілі налаштувань підтримують Minecraft Java",
  ],
  "Файл options.txt пуст или повреждён": [
    "The options.txt file is empty or damaged",
    "Файл options.txt порожній або пошкоджений",
  ],
  "Профиль настроек не найден. Выберите другой профиль.": [
    "Settings profile not found. Choose another profile.",
    "Профіль налаштувань не знайдено. Виберіть інший профіль.",
  ],
  "Нет резервной копии настроек для восстановления": [
    "There is no settings backup to restore",
    "Немає резервної копії налаштувань для відновлення",
  ],
  "Часть настроек недоступна в этой версии Minecraft": [
    "Some settings are unavailable in this Minecraft version",
    "Частина налаштувань недоступна в цій версії Minecraft",
  ],
};
export const gameSettingsEnglish = {
  ...language(0),
  ...Object.fromEntries(
    Object.entries(errors).map(([key, values]) => [key, values[0]]),
  ),
};
export const gameSettingsRussian = {
  ...language(1),
  ...Object.fromEntries(Object.keys(errors).map((key) => [key, key])),
};
export const gameSettingsUkrainian = {
  ...language(2),
  ...Object.fromEntries(
    Object.entries(errors).map(([key, values]) => [key, values[1]]),
  ),
  "До пяти профилей настроек Minecraft: импорт из сборок, редакторы и выбор профиля при установке.":
    "До п’яти профілів налаштувань Minecraft: імпорт зі збірок, редактори та вибір профілю під час установлення.",
};
