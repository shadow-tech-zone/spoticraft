/* Host test stub — sirf utne Win32 naam jitne common.h/model.h ko chahiye. */
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <string>

typedef void* HWND;
typedef unsigned int UINT;
typedef uintptr_t WPARAM;
typedef intptr_t LPARAM;
typedef long HRESULT;
typedef unsigned short WORD;
#define WM_APP 0x8000
#define CP_UTF8 65001
#define MAX_PATH 260
#define SUCCEEDED(x) ((x) >= 0)

struct SYSTEMTIME { WORD wYear=2024, wMonth=1, wDayOfWeek=0, wDay=1, wHour=10, wMinute=0, wSecond=0, wMilliseconds=0; };
inline void GetLocalTime(SYSTEMTIME*) {}
inline int MultiByteToWideChar(UINT, unsigned long, const char* s, int n, wchar_t* out, int cap) {
    int len = n < 0 ? (int)strlen(s) : n;
    int need = len;
    if (!out) return need;
    for (int i = 0; i < len && i < cap; i++) out[i] = (unsigned char)s[i];
    return need <= cap ? need : cap;
}
inline int WideCharToMultiByte(UINT, unsigned long, const wchar_t* s, int n, char* out, int cap, void*, void*) {
    int len = n < 0 ? (int)wcslen(s) : n;
    if (!out) return len;
    for (int i = 0; i < len && i < cap; i++) out[i] = (char)s[i];
    return len <= cap ? len : cap;
}
inline bool PostMessageW(HWND, UINT, WPARAM, LPARAM) { return true; }
inline FILE* _wfopen(const wchar_t* path, const wchar_t* mode) {
    char p[512], m[16];
    wcstombs(p, path, sizeof(p) - 1); p[sizeof(p) - 1] = 0;
    wcstombs(m, mode, sizeof(m) - 1); m[sizeof(m) - 1] = 0;
    /* sandbox mein log/library files na banein */
    if (strstr(p, "Bloomee")) return nullptr;
    return fopen(p, m);
}
inline int CreateDirectoryW(const wchar_t*, void*) { return 1; }
