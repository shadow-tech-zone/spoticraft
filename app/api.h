/* Music API — music-api (Node) contracts ka native C++ roop.
   Saare functions synchronous hain; hamesha job thread se bulao. */
#pragma once
#include "model.h"

namespace api {

inline const char* kSaavn = "jiosaavn";
inline const char* kYtm = "ytmusic";

inline std::string Stamp(const std::string& src, const std::string& local) { return src + "::" + local; }
inline bool ParseId(const std::string& id, std::string& src, std::string& local) {
    size_t p = id.find("::");
    if (p == std::string::npos) return false;
    src = id.substr(0, p);
    local = id.substr(p + 2);
    return true;
}

struct SearchOut {
    std::vector<Track> tracks;
    std::vector<Album> albums;
    std::vector<Playlist> playlists;
    std::vector<Artist> artists;
};

bool Home(const std::string& src, std::vector<Section>& out, std::string& err);
bool Search(const std::string& src, const std::string& q, const std::string& filter,
            int page, SearchOut& out, std::string& err);
bool Suggestions(const std::string& src, const std::string& q,
                 std::vector<std::string>& out, std::string& err);
bool TrackDetails(const std::string& stampedId, Track& out, std::string& err);
bool Streams(const std::string& stampedId, std::vector<StreamInfo>& out, std::string& err);
bool AlbumDetails(const std::string& stampedId, Album& out, std::string& err);
bool PlaylistDetails(const std::string& stampedId, Playlist& out, std::string& err);
bool ArtistDetails(const std::string& stampedId, Artist& out, std::string& err);
bool Radio(const std::string& stampedId, int page, std::vector<Track>& out, std::string& err);
bool Charts(const std::string& src, std::vector<Playlist>& out, std::string& err);
bool ChartDetails(const std::string& stampedId, std::vector<Track>& out, std::string& err);

struct LyricsOut {
    std::vector<std::pair<int64_t, std::string>> lines;  // synced
    std::string plain;
    bool synced = false;
};
bool LyricsForTrack(const Track& t, LyricsOut& out, std::string& err);

} // namespace api
