/* Bloomee native — shared helpers: strings, log, async job queue. */
#pragma once
#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <vector>

inline std::wstring Widen(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}
inline std::string Narrow(const std::wstring& w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, 0);
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
    return s;
}

inline std::string DecodeEntities(std::string s) {
    auto rep = [&](const std::string& from, const std::string& to) {
        size_t p = 0;
        while ((p = s.find(from, p)) != std::string::npos) { s.replace(p, from.size(), to); p += to.size(); }
    };
    rep("&quot;", "\""); rep("&apos;", "'"); rep("&#039;", "'"); rep("&#39;", "'");
    rep("&lt;", "<"); rep("&gt;", ">"); rep("&amp;", "&");
    return s;
}

inline std::string Trim(const std::string& s) {
    size_t b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return {};
    size_t e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

inline std::vector<std::string> Split(const std::string& s, const std::string& sep) {
    std::vector<std::string> out;
    size_t pos = 0;
    while (true) {
        size_t p = s.find(sep, pos);
        if (p == std::string::npos) { out.push_back(s.substr(pos)); break; }
        out.push_back(s.substr(pos, p - pos));
        pos = p + sep.size();
    }
    return out;
}

inline bool StartsWith(const std::string& s, const std::string& p) {
    return s.size() >= p.size() && s.compare(0, p.size(), p) == 0;
}

/** milliseconds -> "m:ss" */
inline std::string FmtTime(int64_t ms) {
    if (ms < 0) ms = 0;
    int64_t sec = ms / 1000;
    char buf[32];
    snprintf(buf, sizeof(buf), "%lld:%02lld", (long long)(sec / 60), (long long)(sec % 60));
    return buf;
}

inline std::string UrlEncode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : s) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~') out += (char)c;
        else { out += '%'; out += hex[c >> 4]; out += hex[c & 15]; }
    }
    return out;
}

/* ── log: %LOCALAPPDATA%\Bloomee\bloomee.log ── */
inline std::wstring AppDataDir() {
    wchar_t buf[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, buf))) {
        std::wstring dir = std::wstring(buf) + L"\\Bloomee";
        CreateDirectoryW(dir.c_str(), nullptr);
        return dir;
    }
    return L".";
}
inline void LogLine(const std::string& msg) {
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    std::wstring path = AppDataDir() + L"\\bloomee.log";
    FILE* f = _wfopen(path.c_str(), L"a");
    if (!f) return;
    SYSTEMTIME st; GetLocalTime(&st);
    fprintf(f, "%02d:%02d:%02d %s\n", st.wHour, st.wMinute, st.wSecond, msg.c_str());
    fclose(f);
}

/* ── async jobs: bg thread par kaam, completion UI thread par ── */
extern HWND g_mainWnd;
constexpr UINT WM_APP_JOB = WM_APP + 42;

struct JobQueue {
    std::mutex m;
    std::queue<std::function<void()>> done;
    std::atomic<int> workers{0};

    void Run(std::function<void()> work, std::function<void()> onDone) {
        workers++;
        std::thread([this, work = std::move(work), onDone = std::move(onDone)]() mutable {
            try { work(); } catch (...) {}
            {
                std::lock_guard<std::mutex> lock(m);
                done.push(std::move(onDone));
            }
            workers--;
            if (g_mainWnd) PostMessageW(g_mainWnd, WM_APP_JOB, 0, 0);
        }).detach();
    }
    void Drain() {
        while (true) {
            std::function<void()> fn;
            {
                std::lock_guard<std::mutex> lock(m);
                if (done.empty()) return;
                fn = std::move(done.front()); done.pop();
            }
            if (fn) fn();
        }
    }
};
inline JobQueue& Jobs() { static JobQueue q; return q; }
inline void RunAsync(std::function<void()> work, std::function<void()> onDone) {
    Jobs().Run(std::move(work), std::move(onDone));
}
