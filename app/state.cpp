#include "state.h"
#include "common.h"

J TrackToJ(const Track& t) {
    J j;
    j["id"] = t.id; j["title"] = t.title;
    J artists = J::array();
    for (auto& a : t.artists) artists.push_back({{"id", a.id}, {"name", a.name}});
    j["artists"] = artists;
    j["albumId"] = t.albumId; j["albumTitle"] = t.albumTitle;
    j["durationMs"] = t.durationMs; j["artwork"] = t.artwork;
    j["explicit"] = t.explicit_;
    return j;
}
Track TrackFromJ(const J& j) {
    Track t;
    if (!j.is_object()) return t;
    t.id = JStr(j, "id"); t.title = JStr(j, "title");
    const J* arr = JNav(j, "artists");
    if (arr && arr->is_array())
        for (auto& a : *arr) t.artists.push_back({JStr(a, "id"), JStr(a, "name")});
    t.albumId = JStr(j, "albumId"); t.albumTitle = JStr(j, "albumTitle");
    t.durationMs = JNum(j, "durationMs"); t.artwork = JStr(j, "artwork");
    t.explicit_ = JBool(j, "explicit");
    return t;
}

static std::wstring LibPath() { return AppDataDir() + L"\\library.json"; }

bool Library::IsLiked(const std::string& trackId) const {
    for (auto& t : liked) if (t.id == trackId) return true;
    return false;
}
void Library::ToggleLike(const Track& t) {
    if (IsLiked(t.id)) {
        liked.erase(std::remove_if(liked.begin(), liked.end(),
                                     [&](const Track& x) { return x.id == t.id; }), liked.end());
    } else liked.insert(liked.begin(), t);
    Save();
}
void Library::TouchRecent(const Track& t) {
    recent.erase(std::remove_if(recent.begin(), recent.end(),
                                 [&](const Track& x) { return x.id == t.id; }), recent.end());
    recent.insert(recent.begin(), t);
    if (recent.size() > 50) recent.resize(50);
    Save();
}
Library::LocalPlaylist& Library::NewPlaylist(const std::string& name) {
    LocalPlaylist p;
    p.id = "local::pl" + std::to_string((int64_t)time(nullptr));
    p.name = name;
    playlists.push_back(std::move(p));
    Save();
    return playlists.back();
}
Library::LocalPlaylist* Library::FindPlaylist(const std::string& id) {
    for (auto& p : playlists) if (p.id == id) return &p;
    return nullptr;
}
const Library::LocalPlaylist* Library::FindPlaylist(const std::string& id) const {
    for (auto& p : playlists) if (p.id == id) return &p;
    return nullptr;
}
bool Library::RenamePlaylist(const std::string& id, const std::string& name) {
    auto* p = FindPlaylist(id);
    if (!p) return false;
    p->name = name; Save();
    return true;
}
bool Library::DeletePlaylist(const std::string& id) {
    size_t before = playlists.size();
    playlists.erase(std::remove_if(playlists.begin(), playlists.end(),
                                    [&](const LocalPlaylist& x) { return x.id == id; }), playlists.end());
    if (playlists.size() == before) return false;
    Save();
    return true;
}
bool Library::AddToPlaylist(const std::string& pid, const Track& t) {
    auto* p = FindPlaylist(pid);
    if (!p) return false;
    for (auto& x : p->tracks) if (x.id == t.id) return true;
    p->tracks.push_back(t);
    Save();
    return true;
}
bool Library::RemoveFromPlaylist(const std::string& pid, const std::string& trackId) {
    auto* p = FindPlaylist(pid);
    if (!p) return false;
    p->tracks.erase(std::remove_if(p->tracks.begin(), p->tracks.end(),
                                    [&](const Track& x) { return x.id == trackId; }), p->tracks.end());
    Save();
    return true;
}

void Library::Load() {
    FILE* f = _wfopen(LibPath().c_str(), L"rb");
    if (!f) return;
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0 || size > 16 * 1024 * 1024) { fclose(f); return; }
    std::string buf((size_t)size, 0);
    fread(buf.data(), 1, (size_t)size, f);
    fclose(f);
    try {
        J d = J::parse(buf);
        auto tracks = [&](const char* key) {
            std::vector<Track> out;
            const J* arr = JNav(d, key);
            if (arr && arr->is_array()) for (auto& it : *arr) out.push_back(TrackFromJ(it));
            return out;
        };
        liked = tracks("liked");
        recent = tracks("recent");
        const J* pls = JNav(d, "playlists");
        if (pls && pls->is_array())
            for (auto& p : *pls) {
                LocalPlaylist lp;
                lp.id = JStr(p, "id"); lp.name = JStr(p, "name");
                const J* tr = JNav(p, "tracks");
                if (tr && tr->is_array()) for (auto& it : *tr) lp.tracks.push_back(TrackFromJ(it));
                if (!lp.name.empty()) playlists.push_back(std::move(lp));
            }
        shuffle = JBool(d, "shuffle");
        repeatAll = JBool(d, "repeatAll");
        repeatOne = JBool(d, "repeatOne");
        const J* v = JNav(d, "volume");
        if (v && v->is_number()) { volume = v->get<float>(); if (volume < 0) volume = 0; if (volume > 1) volume = 1; }
        const J* lt = JNav(d, "lastTrack");
        if (lt && lt->is_object()) lastTrackJson = lt->dump();
    } catch (...) { LogLine("library.json parse fail — fresh start"); }
}

void Library::Save() const {
    J d;
    auto arr = [](const std::vector<Track>& v) {
        J a = J::array();
        for (auto& t : v) a.push_back(TrackToJ(t));
        return a;
    };
    d["liked"] = arr(liked);
    d["recent"] = arr(recent);
    J pls = J::array();
    for (auto& p : playlists) {
        J pj; pj["id"] = p.id; pj["name"] = p.name; pj["tracks"] = arr(p.tracks);
        pls.push_back(pj);
    }
    d["playlists"] = pls;
    d["shuffle"] = shuffle; d["repeatAll"] = repeatAll; d["repeatOne"] = repeatOne;
    d["volume"] = volume;
    if (!lastTrackJson.empty()) { try { d["lastTrack"] = J::parse(lastTrackJson); } catch (...) {} }
    FILE* f = _wfopen(LibPath().c_str(), L"wb");
    if (!f) return;
    std::string s = d.dump();
    fwrite(s.data(), 1, s.size(), f);
    fclose(f);
}
