#pragma once
#include "windows.h"
#define CSIDL_LOCAL_APPDATA 0x1c
inline HRESULT SHGetFolderPathW(HWND, int, void*, unsigned long, wchar_t* buf) {
    wcscpy(buf, L".");
    return 0;
}
