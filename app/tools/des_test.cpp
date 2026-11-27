/* Host-side DES test: g++ -std=c++17 -I app app/tools/des_test.cpp -o /tmp/des_test
   music-api ke JS encrypted fixture ko decrypt karke cross-verify karta hai. */
#include "../des.h"
#include <cstdio>
#include <cstring>

int main() {
    int fails = 0;
    /* FIPS vector: key 133457799BBCDFF1, pt 0123456789ABCDEF -> ct 85E813540F0AB405
       (decrypt side se ulta check) */
    {
        uint8_t key[8] = {0x13, 0x34, 0x57, 0x79, 0x9B, 0xBC, 0xDF, 0xF1};
        uint64_t keys[16];
        des::Subkeys(key, keys);
        uint8_t ct[8] = {0x85, 0xE8, 0x13, 0x54, 0x0F, 0x0A, 0xB4, 0x05};
        uint8_t pt[8];
        des::CryptBlock(ct, pt, keys, true);
        uint8_t want[8] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF};
        bool ok = memcmp(pt, want, 8) == 0;
        printf("FIPS decrypt vector: %s\n", ok ? "PASS" : "FAIL");
        if (!ok) fails++;
    }
    /* JS (music-api) se encrypted fixture -> asal URL nikalna chahiye */
    {
        std::string got = des::DecryptSaavnUrl(
            "ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyDcRFfAApeN7TVeXlASS4OBw7tS9a8Gtq");
        bool ok = got == "https://aac.saavncdn.com/695/9f8e7d6c_96.mp4";
        printf("saavn JS-fixture decrypt: %s (%s)\n", ok ? "PASS" : "FAIL", got.c_str());
        if (!ok) fails++;
    }
    printf(fails ? "SOME FAILED\n" : "ALL PASS\n");
    return fails;
}
