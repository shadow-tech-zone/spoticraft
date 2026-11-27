/* WinHTTP wrapper — saari network yahin se (job threads par chalta hai). */
#pragma once
#include <string>
#include <vector>
#include <cstdint>

namespace net {

/** GET; kamyabi par true, out mein body (UTF-8). */
bool Get(const std::string& url, std::string& out, const std::string& extraHeaders = "");
/** POST JSON body. */
bool PostJson(const std::string& url, const std::string& body, std::string& out,
              const std::string& extraHeaders = "");
/** Binary (images). */
bool GetBytes(const std::string& url, std::vector<uint8_t>& out);

} // namespace net
