/* Host fixture tests: C++ parsers vs music-api fixtures.
   g++ -std=c++17 -I app/tools/hoststub -I app app/tools/api_test.cpp -o /tmp/api_test
   /tmp/api_test  (repo root se chalao: fixture paths relative) */
#include "../api.h"

#include <cstdio>
#include <fstream>
#include <sstream>

HWND g_mainWnd = nullptr;

namespace net {
static std::string ReadFile(const char* path) {
    std::ifstream f(path);
    if (!f) return "";
    std::stringstream ss; ss << f.rdbuf();
    return ss.str();
}
static std::string Route(const std::string& url) {
    if (url.find("search.getResults") != std::string::npos ||
        url.find("search.getAlbumResults") != std::string::npos ||
        url.find("search.getPlaylistResults") != std::string::npos ||
        url.find("search.getArtistResults") != std::string::npos)
        return ReadFile("music-api/test/fixtures/saavn-search.json");
    if (url.find("getLaunchData") != std::string::npos)
        return ReadFile("music-api/test/fixtures/saavn-launch.json");
    if (url.find("song.getDetails") != std::string::npos ||
        url.find("content.getAlbumDetails") != std::string::npos)
        return ReadFile("music-api/test/fixtures/saavn-song.json");
    if (url.find("youtubei") != std::string::npos)
        return ReadFile("music-api/test/fixtures/ytm-search.json");
    if (url.find("lrclib") != std::string::npos)
        return "";
    return "";
}
bool Get(const std::string& url, std::string& out, const std::string&) {
    out = Route(url);
    return !out.empty();
}
bool PostJson(const std::string&, const std::string&, std::string& out, const std::string&) {
    out = ReadFile("music-api/test/fixtures/ytm-search.json");
    return !out.empty();
}
bool GetBytes(const std::string&, std::vector<uint8_t>&) { return false; }
} // namespace net

static int fails = 0;
static void Check(bool ok, const std::string& name) {
    printf("%s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (!ok) fails++;
}

int main() {
    std::string err;
    /* JioSaavn search */
    api::SearchOut so;
    bool ok = api::Search(api::kSaavn, "test", "all", 1, so, err);
    Check(ok, "saavn search ok");
    Check(!so.tracks.empty(), "saavn tracks parsed");
    if (!so.tracks.empty()) {
        const Track& t = so.tracks[0];
        Check(t.id.rfind("jiosaavn::", 0) == 0, "saavn track id stamped: " + t.id);
        Check(!t.title.empty(), "saavn track title: " + t.title);
        Check(!t.artists.empty(), "saavn track artist");
        Check(!t.artwork.empty(), "saavn track artwork");
        printf("   sample: %s — %s (%lldms)\n", t.title.c_str(), t.ArtistText().c_str(), (long long)t.durationMs);
    }
    /* JioSaavn home */
    std::vector<Section> home;
    ok = api::Home(api::kSaavn, home, err);
    Check(ok, "saavn home ok");
    Check(!home.empty(), "saavn home sections: " + std::to_string(home.size()));
    /* JioSaavn streams (encrypted URL in fixture decrypts) */
    std::vector<StreamInfo> streams;
    ok = api::Streams("jiosaavn::TestSong1", streams, err);
    Check(ok && !streams.empty(), "saavn streams decrypt");
    if (!streams.empty()) {
        printf("   best stream: %s %s\n", streams[0].quality.c_str(), streams[0].url.c_str());
        Check(streams[0].url.find("_320") != std::string::npos ||
              streams[0].quality == "320kbps", "saavn best quality 320 hai");
    }
    /* YTM search parse */
    api::SearchOut yso;
    ok = api::Search(api::kYtm, "fixture", "all", 1, yso, err);
    Check(ok, "ytm search ok");
    Check(!yso.tracks.empty() || !yso.albums.empty(), "ytm results parsed");
    if (!yso.tracks.empty())
        printf("   ytm sample: %s — %s [%s]\n", yso.tracks[0].title.c_str(),
               yso.tracks[0].ArtistText().c_str(), yso.tracks[0].id.c_str());
    printf(fails ? "SOME FAILED\n" : "ALL PASS\n");
    return fails;
}
