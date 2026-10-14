#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shobjidl.h>
#include <wchar.h>

// Only repair existing shortcuts owned by this product. Never create shortcuts
// here: installation choices and /NS remain the responsibility of NSIS.
static bool samePath(const wchar_t* left, const wchar_t* right) {
  wchar_t a[MAX_PATH], b[MAX_PATH];
  DWORD al = GetFullPathNameW(left, MAX_PATH, a, nullptr);
  DWORD bl = GetFullPathNameW(right, MAX_PATH, b, nullptr);
  return al && al < MAX_PATH && bl && bl < MAX_PATH && _wcsicmp(a, b) == 0;
}

static const wchar_t* fileName(const wchar_t* path) {
  const wchar_t* slash = wcsrchr(path, L'\\');
  return slash ? slash + 1 : path;
}

static bool productMatches(const wchar_t* path, const wchar_t* product) {
  DWORD unused = 0, size = GetFileVersionInfoSizeW(path, &unused);
  if (!size || size > 1024 * 1024) return false;
  void* info = HeapAlloc(GetProcessHeap(), 0, size);
  if (!info) return false;
  bool match = false;
  if (GetFileVersionInfoW(path, 0, size, info)) {
    struct Translation { WORD language, codepage; };
    Translation* translations = nullptr;
    UINT bytes = 0;
    if (VerQueryValueW(info, L"\\VarFileInfo\\Translation", reinterpret_cast<void**>(&translations), &bytes)) {
      for (UINT i = 0; i < bytes / sizeof(Translation); ++i) {
        wchar_t query[80];
        wsprintfW(query, L"\\StringFileInfo\\%04x%04x\\ProductName", translations[i].language, translations[i].codepage);
        wchar_t* name = nullptr;
        UINT length = 0;
        if (VerQueryValueW(info, query, reinterpret_cast<void**>(&name), &length) && length && wcscmp(name, product) == 0) {
          match = true;
          break;
        }
      }
    }
  }
  HeapFree(GetProcessHeap(), 0, info);
  return match;
}

static bool repairShortcut(const wchar_t* shortcut, const wchar_t* target, const wchar_t* product) {
  DWORD attributes = GetFileAttributesW(target);
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) return false;
  HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) return false;
  IShellLinkW* link = nullptr;
  IPersistFile* file = nullptr;
  bool repaired = false;
  if (SUCCEEDED(CoCreateInstance(__uuidof(ShellLink), nullptr, CLSCTX_INPROC_SERVER, __uuidof(IShellLinkW), reinterpret_cast<void**>(&link))) &&
      SUCCEEDED(link->QueryInterface(__uuidof(IPersistFile), reinterpret_cast<void**>(&file))) &&
      SUCCEEDED(file->Load(shortcut, STGM_READWRITE))) {
    wchar_t oldTarget[MAX_PATH] = {};
    if (SUCCEEDED(link->GetPath(oldTarget, MAX_PATH, nullptr, SLGP_RAWPATH)) && oldTarget[0] &&
        (samePath(oldTarget, target) ||
         (_wcsicmp(fileName(oldTarget), fileName(target)) == 0 && productMatches(oldTarget, product)))) {
      wchar_t oldFolder[MAX_PATH], newFolder[MAX_PATH], working[MAX_PATH] = {}, icon[MAX_PATH] = {};
      lstrcpynW(oldFolder, oldTarget, MAX_PATH);
      lstrcpynW(newFolder, target, MAX_PATH);
      wchar_t* oldSlash = wcsrchr(oldFolder, L'\\');
      wchar_t* newSlash = wcsrchr(newFolder, L'\\');
      if (oldSlash && newSlash) {
        *oldSlash = L'\0'; *newSlash = L'\0';
        HRESULT result = link->SetPath(target);
        if (SUCCEEDED(result) && SUCCEEDED(link->GetWorkingDirectory(working, MAX_PATH)) &&
            (!working[0] || samePath(working, oldFolder))) result = link->SetWorkingDirectory(newFolder);
        int iconIndex = 0;
        if (SUCCEEDED(result) && SUCCEEDED(link->GetIconLocation(icon, MAX_PATH, &iconIndex)) &&
            (!icon[0] || samePath(icon, oldTarget))) result = link->SetIconLocation(target, iconIndex);
        // Loading and editing the existing link preserves arguments, hotkeys,
        // descriptions, custom icons and custom working directories.
        repaired = SUCCEEDED(result) && SUCCEEDED(file->Save(shortcut, TRUE));
      }
    }
  }
  if (file) file->Release();
  if (link) link->Release();
  if (SUCCEEDED(init)) CoUninitialize();
  return repaired;
}

struct ShortcutStack { ShortcutStack* next; wchar_t text[1]; };
extern "C" __declspec(dllexport) void __cdecl RepairShortcut(HWND, int stringSize, wchar_t*, ShortcutStack** stack, void*) {
  ShortcutStack* args[3] = {};
  for (int i = 0; i < 3; ++i) {
    if (!stack || !*stack) {
      for (int j = 0; j < i; ++j) GlobalFree(args[j]);
      return;
    }
    args[i] = *stack;
    *stack = args[i]->next;
  }
  bool repaired = repairShortcut(args[0]->text, args[1]->text, args[2]->text);
  for (int i = 0; i < 3; ++i) GlobalFree(args[i]);
  ShortcutStack* result = static_cast<ShortcutStack*>(GlobalAlloc(GPTR, sizeof(ShortcutStack) + stringSize * sizeof(wchar_t)));
  if (result) {
    lstrcpyW(result->text, repaired ? L"1" : L"0");
    result->next = *stack;
    *stack = result;
  }
}
