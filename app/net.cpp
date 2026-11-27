#include "net.h"
#include "common.h"

#include <winhttp.h>

namespace net {
namespace {

const wchar_t* kUA = L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     L"(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

bool Request(const std::string& url, const char* verb, const std::string& body,
             const std::string& extraHeaders, std::vector<uint8_t>& out) {
    std::wstring wurl = Widen(url);
    URL_COMPONENTS uc{sizeof(uc)};
    wchar_t host[256] = {}, path[4096] = {};
    uc.lpszHostName = host; uc.dwHostNameLength = 255;
    uc.lpszUrlPath = path; uc.dwUrlPathLength = 4095;
    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &uc)) return false;

    HINTERNET session = WinHttpOpen(kUA, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return false;
    WinHttpSetTimeouts(session, 8000, 8000, 20000, 20000);

    HINTERNET conn = WinHttpConnect(session, host, uc.nPort, 0);
    HINTERNET req = nullptr;
    bool ok = false;
    if (conn) {
        DWORD flags = (uc.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
        req = WinHttpOpenRequest(conn, Widen(verb).c_str(), path, nullptr,
                                 WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    }
    if (req) {
        std::wstring headers = Widen(extraHeaders);
        if (verb[0] == 'P')
            headers += L"Content-Type: application/json\r\n";
        BOOL sent = WinHttpSendRequest(req, headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str(),
                                       headers.empty() ? 0 : (DWORD)-1,
                                       body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.data(),
                                       (DWORD)body.size(), (DWORD)body.size(), 0);
        if (sent && WinHttpReceiveResponse(req, nullptr)) {
            DWORD status = 0, sz = sizeof(status);
            WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                nullptr, &status, &sz, nullptr);
            if (status >= 200 && status < 300) {
                ok = true;
                DWORD avail = 0;
                while (WinHttpQueryDataAvailable(req, &avail) && avail > 0) {
                    std::vector<uint8_t> chunk(avail);
                    DWORD read = 0;
                    if (!WinHttpReadData(req, chunk.data(), avail, &read)) { ok = false; break; }
                    chunk.resize(read);
                    out.insert(out.end(), chunk.begin(), chunk.end());
                    if (read == 0) break;
                }
            } else {
                LogLine("HTTP " + std::to_string(status) + " " + url.substr(0, 120));
            }
        }
    }
    if (req) WinHttpCloseHandle(req);
    if (conn) WinHttpCloseHandle(conn);
    WinHttpCloseHandle(session);
    return ok;
}

} // namespace

bool Get(const std::string& url, std::string& out, const std::string& extraHeaders) {
    std::vector<uint8_t> bytes;
    if (!Request(url, "GET", "", extraHeaders, bytes)) return false;
    out.assign(bytes.begin(), bytes.end());
    return true;
}

bool PostJson(const std::string& url, const std::string& body, std::string& out,
              const std::string& extraHeaders) {
    std::vector<uint8_t> bytes;
    if (!Request(url, "POST", body, extraHeaders, bytes)) return false;
    out.assign(bytes.begin(), bytes.end());
    return true;
}

bool GetBytes(const std::string& url, std::vector<uint8_t>& out) {
    return Request(url, "GET", "", "", out);
}

} // namespace net
