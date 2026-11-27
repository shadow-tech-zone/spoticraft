/* Unified model — music-api ke model ki C++ shakl.
   Har id stamped: "jiosaavn::<local>" / "ytmusic::<local>". */
#pragma once
#include "common.h"
#include "json.hpp"

#include <string>
#include <vector>

using J = nlohmann::json;

/* Dotted path navigation: "more_info.artistMap.primary_artists",
   numeric segment = array index. (Dart/JS getText semantics.) */
inline const J* JNav(const J& j, const std::string& path) {
    if (path.empty()) return &j;
    const J* cur = &j;
    size_t pos = 0;
    while (pos <= path.size()) {
        size_t dot = path.find('.', pos);
        std::string seg = path.substr(pos, dot == std::string::npos ? dot : dot - pos);
        if (seg.empty()) return nullptr;
        bool numeric = std::all_of(seg.begin(), seg.end(), ::isdigit);
        if (numeric && cur->is_array()) {
            size_t idx = (size_t)std::stoll(seg);
            if (idx >= cur->size()) return nullptr;
            cur = &(*cur)[idx];
        } else if (cur->is_object()) {
            auto it = cur->find(seg);
            if (it == cur->end()) return nullptr;
            cur = &(*it);
        } else return nullptr;
        if (dot == std::string::npos) break;
        pos = dot + 1;
    }
    return cur;
}
inline std::string JStr(const J& j, const std::string& path, const std::string& def = "") {
    const J* v = JNav(j, path);
    if (!v) return def;
    if (v->is_string()) return v->get<std::string>();
    if (v->is_number()) return std::to_string(v->get<double>() == (double)(int64_t)v->get<double>()
                              ? (int64_t)v->get<double>() : v->get<double>());
    return def;
}
inline int64_t JNum(const J& j, const std::string& path, int64_t def = 0) {
    const J* v = JNav(j, path);
    if (!v) return def;
    if (v->is_number()) return v->get<int64_t>();
    if (v->is_string()) { try { return std::stoll(v->get<std::string>()); } catch (...) { return def; } }
    return def;
}
inline bool JBool(const J& j, const std::string& path) {
    const J* v = JNav(j, path);
    return v && v->is_boolean() && v->get<bool>();
}

struct ArtistRef { std::string id, name; };

struct Track {
    std::string id;                 // stamped
    std::string title;
    std::vector<ArtistRef> artists;
    std::string albumId, albumTitle;
    int64_t durationMs = 0;
    std::string artwork;            // url
    bool explicit_ = false;
    std::string ArtistText() const {
        std::string s;
        for (size_t i = 0; i < artists.size(); i++) { if (i) s += ", "; s += artists[i].name; }
        return s;
    }
};

struct Album {
    std::string id, title;
    std::vector<ArtistRef> artists;
    std::string year, artwork;
    int trackCount = 0;
    std::vector<Track> tracks;
    std::string ArtistText() const {
        std::string s;
        for (size_t i = 0; i < artists.size(); i++) { if (i) s += ", "; s += artists[i].name; }
        return s;
    }
};

struct Playlist {
    std::string id, title, description, artwork, author;
    int trackCount = 0;
    std::vector<Track> tracks;
};

struct Artist {
    std::string id, name, artwork, subtitle, bio;
    std::vector<Track> topTracks;
    std::vector<Album> albums;
};

/* Home/search ki ek kataar (Section items mixed kinds) */
struct MediaItem {
    enum class Kind { Track, Album, Playlist, Artist } kind = Kind::Track;
    Track track; Album album; Playlist playlist; Artist artist;
    const std::string& Title() const {
        switch (kind) {
            case Kind::Track: return track.title;
            case Kind::Album: return album.title;
            case Kind::Playlist: return playlist.title;
            case Kind::Artist: return artist.name;
        }
        return track.title;
    }
    std::string Artwork() const {
        switch (kind) {
            case Kind::Track: return track.artwork;
            case Kind::Album: return album.artwork;
            case Kind::Playlist: return playlist.artwork;
            case Kind::Artist: return artist.artwork;
        }
        return {};
    }
    std::string Subtitle() const {
        switch (kind) {
            case Kind::Track: return track.ArtistText();
            case Kind::Album: return album.ArtistText();
            case Kind::Playlist: return playlist.author.empty() ? std::string("Playlist") : playlist.author;
            case Kind::Artist: return artist.subtitle.empty() ? std::string("Artist") : artist.subtitle;
        }
        return {};
    }
};

struct Section {
    std::string title;
    std::vector<MediaItem> items;
};

struct StreamInfo {
    std::string quality;
    std::string url;
    int bitrate = 0;
};

/* "3:25" ya seconds -> ms */
inline int64_t DurationToMs(const std::string& d) {
    if (d.empty()) return 0;
    bool plain = std::all_of(d.begin(), d.end(), [](char c) { return isdigit((unsigned char)c) || c == '.'; });
    if (plain && d.find(':') == std::string::npos) {
        try { return (int64_t)(std::stod(d) * 1000); } catch (...) { return 0; }
    }
    int64_t total = 0;
    for (auto& part : Split(d, ":")) {
        try { total = total * 60 + std::stoll(Trim(part)); } catch (...) { return 0; }
    }
    return total * 1000;
}
inline bool IsDurationText(const std::string& s) {
    std::string t = Trim(s);
    if (t.empty()) return false;
    int colons = 0;
    for (char c : t) { if (c == ':') colons++; else if (!isdigit((unsigned char)c)) return false; }
    return colons >= 1;
}
