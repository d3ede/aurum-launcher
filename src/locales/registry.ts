export const languages = [
  ["ru", "Русский", "Russian", "rus_Cyrl", "europe"],
  ["en", "English", "English", "eng_Latn", "europe"],
  ["uk", "Українська", "Ukrainian", "ukr_Cyrl", "europe"],
  ["es", "Español", "Spanish", "spa_Latn", "europe"],
  ["de", "Deutsch", "German", "deu_Latn", "europe"],
  ["fr", "Français", "French", "fra_Latn", "europe"],
  ["it", "Italiano", "Italian", "ita_Latn", "europe"],
  ["pt", "Português", "Portuguese", "por_Latn", "europe"],
  ["pl", "Polski", "Polish", "pol_Latn", "europe"],
  ["cs", "Čeština", "Czech", "ces_Latn", "europe"],
  ["sk", "Slovenčina", "Slovak", "slk_Latn", "europe"],
  ["hu", "Magyar", "Hungarian", "hun_Latn", "europe"],
  ["ro", "Română", "Romanian", "ron_Latn", "europe"],
  ["bg", "Български", "Bulgarian", "bul_Cyrl", "europe"],
  ["nl", "Nederlands", "Dutch", "nld_Latn", "europe"],
  ["sv", "Svenska", "Swedish", "swe_Latn", "europe"],
  ["nb", "Norsk bokmål", "Norwegian", "nob_Latn", "europe"],
  ["da", "Dansk", "Danish", "dan_Latn", "europe"],
  ["fi", "Suomi", "Finnish", "fin_Latn", "europe"],
  ["et", "Eesti", "Estonian", "est_Latn", "europe"],
  ["lv", "Latviešu", "Latvian", "lvs_Latn", "europe"],
  ["lt", "Lietuvių", "Lithuanian", "lit_Latn", "europe"],
  ["el", "Ελληνικά", "Greek", "ell_Grek", "europe"],
  ["tr", "Türkçe", "Turkish", "tur_Latn", "europe"],
  ["hr", "Hrvatski", "Croatian", "hrv_Latn", "europe"],
  ["sl", "Slovenščina", "Slovenian", "slv_Latn", "europe"],
  ["sr", "Српски", "Serbian", "srp_Cyrl", "europe"],
  ["ca", "Català", "Catalan", "cat_Latn", "europe"],
  ["is", "Íslenska", "Icelandic", "isl_Latn", "europe"],
  ["ga", "Gaeilge", "Irish", "gle_Latn", "europe"],
  ["kk", "Қазақша", "Kazakh", "kaz_Cyrl", "world"],
  ["ar", "العربية", "Arabic", "arb_Arab", "world"],
  ["he", "עברית", "Hebrew", "heb_Hebr", "world"],
  ["zh-Hans", "简体中文", "Chinese (Simplified)", "zho_Hans", "world"],
  ["zh-Hant", "繁體中文", "Chinese (Traditional)", "zho_Hant", "world"],
  ["ja", "日本語", "Japanese", "jpn_Jpan", "world"],
  ["ko", "한국어", "Korean", "kor_Hang", "world"],
  ["hi", "हिन्दी", "Hindi", "hin_Deva", "world"],
  ["id", "Bahasa Indonesia", "Indonesian", "ind_Latn", "world"],
  ["vi", "Tiếng Việt", "Vietnamese", "vie_Latn", "world"],
  ["th", "ไทย", "Thai", "tha_Thai", "world"],
].map(([code, nativeName, englishName, modelCode, region]) => ({
  code,
  nativeName,
  englishName,
  modelCode,
  region,
  direction: code === "ar" || code === "he" ? "rtl" : "ltr",
}));

export function resolveLanguage(
  preference: string,
  systemLanguages: readonly string[] = typeof navigator === "undefined"
    ? ["en"]
    : navigator.languages,
) {
  const candidates = preference === "system" ? systemLanguages : [preference];
  for (const tag of candidates) {
    const normal = tag.replace(/_/g, "-").toLowerCase();
    if (normal.startsWith("zh"))
      return /hant|tw|hk|mo/.test(normal) ? "zh-Hant" : "zh-Hans";
    const base = normal.split("-")[0];
    const code = base === "no" || base === "nn" ? "nb" : base;
    if (languages.some((l) => l.code === code)) return code;
  }
  return "en";
}
