/* Pure C++ DES-ECB decrypt — JioSaavn encrypted_media_url ke liye.
   music-api/src/des.js ka hamsar; FIPS vectors + JS-encrypted fixture
   se verified (tools/des_test.cpp). */
#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace des {

static const uint8_t IP[64] = {
  58,50,42,34,26,18,10,2, 60,52,44,36,28,20,12,4, 62,54,46,38,30,22,14,6,
  64,56,48,40,32,24,16,8, 57,49,41,33,25,17,9,1, 59,51,43,35,27,19,11,3,
  61,53,45,37,29,21,13,5, 63,55,47,39,31,23,15,7 };
static const uint8_t FP[64] = {
  40,8,48,16,56,24,64,32, 39,7,47,15,55,23,63,31, 38,6,46,14,54,22,62,30,
  37,5,45,13,53,21,61,29, 36,4,44,12,52,20,60,28, 35,3,43,11,51,19,59,27,
  34,2,42,10,50,18,58,26, 33,1,41,9,49,17,57,25 };
static const uint8_t ET[48] = {
  32,1,2,3,4,5, 4,5,6,7,8,9, 8,9,10,11,12,13, 12,13,14,15,16,17,
  16,17,18,19,20,21, 20,21,22,23,24,25, 24,25,26,27,28,29, 28,29,30,31,32,1 };
static const uint8_t PT[32] = {
  16,7,20,21,29,12,28,17, 1,15,23,26,5,18,31,10, 2,8,24,14,32,27,3,9,
  19,13,30,6,22,11,4,25 };
static const uint8_t PC1[56] = {
  57,49,41,33,25,17,9, 1,58,50,42,34,26,18, 10,2,59,51,43,35,27,19,
  11,3,60,52,44,36, 63,55,47,39,31,23,15, 7,62,54,46,38,30,22, 14,6,61,53,45,37,29,
  21,13,5,28,20,12,4 };
static const uint8_t PC2[48] = {
  14,17,11,24,1,5, 3,28,15,6,21,10, 23,19,12,4,26,8, 16,7,27,20,13,2,
  41,52,31,37,47,55, 30,40,51,45,33,48, 44,49,39,56,34,53, 46,42,50,36,29,32 };
static const uint8_t SHIFTS[16] = {1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1};
static const uint8_t SBOX[8][64] = {
  {14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8, 4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13},
  {15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5, 0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9},
  {10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1, 13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12},
  {7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9, 10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14},
  {2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6, 4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3},
  {12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8, 9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13},
  {4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6, 1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12},
  {13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2, 7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11},
};

inline uint64_t Permute(uint64_t v, const uint8_t* table, int n, int inBits) {
    uint64_t out = 0;
    for (int i = 0; i < n; i++) out = (out << 1) | ((v >> (inBits - table[i])) & 1ULL);
    return out;
}

inline void Subkeys(const uint8_t key[8], uint64_t out[16]) {
    uint64_t k = 0;
    for (int i = 0; i < 8; i++) k = (k << 8) | key[i];
    uint64_t k56 = Permute(k, PC1, 56, 64);
    uint32_t c = (uint32_t)((k56 >> 28) & 0xFFFFFFF);
    uint32_t d = (uint32_t)(k56 & 0xFFFFFFF);
    for (int i = 0; i < 16; i++) {
        int s = SHIFTS[i];
        c = ((c << s) | (c >> (28 - s))) & 0xFFFFFFF;
        d = ((d << s) | (d >> (28 - s))) & 0xFFFFFFF;
        uint64_t cd = ((uint64_t)c << 28) | d;
        out[i] = Permute(cd, PC2, 48, 56);
    }
}

inline uint32_t Feistel(uint32_t r, uint64_t k) {
    uint64_t x = Permute(r, ET, 48, 32) ^ k;
    uint32_t out = 0;
    for (int i = 0; i < 8; i++) {
        int chunk = (int)((x >> (42 - 6 * i)) & 0x3F);
        int row = ((chunk & 0x20) >> 4) | (chunk & 1);
        int col = (chunk >> 1) & 0xF;
        out = (out << 4) | SBOX[i][row * 16 + col];
    }
    return (uint32_t)Permute(out, PT, 32, 32);
}

inline void CryptBlock(const uint8_t in[8], uint8_t out[8], const uint64_t keys[16], bool decrypt) {
    uint64_t v = 0;
    for (int i = 0; i < 8; i++) v = (v << 8) | in[i];
    uint64_t ip = Permute(v, IP, 64, 64);
    uint32_t l = (uint32_t)(ip >> 32), r = (uint32_t)ip;
    for (int i = 0; i < 16; i++) {
        uint32_t next = l ^ Feistel(r, keys[decrypt ? 15 - i : i]);
        l = r; r = next;
    }
    uint64_t pre = ((uint64_t)r << 32) | l;
    uint64_t res = Permute(pre, FP, 64, 64);
    for (int i = 7; i >= 0; i--) { out[i] = (uint8_t)(res & 0xFF); res >>= 8; }
}

/** ECB decrypt + PKCS#7 unpad. */
inline std::vector<uint8_t> DecryptEcb(const uint8_t* data, size_t len, const char key[8]) {
    uint64_t keys[16];
    Subkeys((const uint8_t*)key, keys);
    std::vector<uint8_t> out;
    out.reserve(len);
    for (size_t off = 0; off + 8 <= len; off += 8) {
        uint8_t block[8];
        CryptBlock(data + off, block, keys, true);
        out.insert(out.end(), block, block + 8);
    }
    if (!out.empty()) {
        uint8_t pad = out.back();
        if (pad >= 1 && pad <= 8 && out.size() >= pad) out.resize(out.size() - pad);
    }
    return out;
}

inline int B64Val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

/** JioSaavn: base64 encrypted_media_url -> saaf stream URL. */
inline std::string DecryptSaavnUrl(const std::string& b64) {
    std::vector<uint8_t> raw;
    int acc = 0, bits = 0;
    for (char c : b64) {
        int v = B64Val(c);
        if (v < 0) continue;
        acc = (acc << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; raw.push_back((uint8_t)((acc >> bits) & 0xFF)); }
    }
    auto dec = DecryptEcb(raw.data(), raw.size(), "38346591");
    std::string s(dec.begin(), dec.end());
    size_t b = s.find_first_not_of(" \t\r\n");
    size_t e = s.find_last_not_of(" \t\r\n");
    return (b == std::string::npos) ? "" : s.substr(b, e - b + 1);
}

} // namespace des
