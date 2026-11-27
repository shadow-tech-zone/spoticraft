/* Music API implementation — music-api ke JS contracts ki 1-to-1 port. */
#include "api.h"
#include "des.h"
#include "net.h"

#include <regex>

namespace api {
namespace {

std::string Img500(std::string u) {
    for (const char* sz : {"150x150", "50x50"}) {
        size_t p = u.find(sz);
        if (p != std::string::npos) return u.replace(p, strlen(sz), "500x500");
    }
    return u;
}
std::string SrcOf(const std::string& id) { std::string s, l; return ParseId(id, s, l) ? s : ""; }
std::string LocalOf(const std::string& id) { std::string s, l; return ParseId(id, s, l) ? l : id; }

/* ════════════════ JioSaavn ════════════════ */

J SaavnCall(const std::string& call, const std::string& params, bool& ok,
            const std::string& ctx = "web6dot0") {
    std::string url = "https://www.jiosaavn.com/api.php?__call=" + call +
                      "&api_version=4&_format=json&_marker=0&ctx=" + ctx +
                      (params.empty() ? "" : "&" + params);
    std::string body;
    ok = net::Get(url, body);
    if (!ok) return J();
    try { return J::parse(body); } catch (...) { ok = false; return J(); }
}

std::vector<ArtistRef> SaavnArtists(const J& s) {
    std::vector<ArtistRef> out;
    const J* map = JNav(s, "more_info.artistMap.primary_artists");
    if (map && map->is_array() && !map->empty()) {
        for (auto& a : *map)
            out.push_back({Stamp(kSaavn, JStr(a, "id")), DecodeEntities(JStr(a, "name"))});
        return out;
    }
    auto ids = Split(JStr(s, "more_info.primary_artists_ids", JStr(s, "primary_artists_ids")), ",");
    auto names = Split(JStr(s, "primary_artists"), ",");
    for (size_t i = 0; i < names.size(); i++) {
        std::string n = Trim(names[i]);
        if (n.empty()) continue;
        out.push_back({i < ids.size() && !Trim(ids[i]).empty() ? Stamp(kSaavn, Trim(ids[i])) : "", n});
    }
    return out;
}

bool SaavnTrack(const J& s, Track& t) {
    if (!s.is_object() || JStr(s, "id").empty()) return false;
    t.id = Stamp(kSaavn, JStr(s, "id"));
    t.title = DecodeEntities(JStr(s, "title", JStr(s, "name")));
    t.artists = SaavnArtists(s);
    std::string albumId = JStr(s, "more_info.album_id", JStr(s, "album_id"));
    if (!albumId.empty()) {
        t.albumId = Stamp(kSaavn, albumId);
        t.albumTitle = DecodeEntities(JStr(s, "album", JStr(s, "more_info.album")));
    }
    t.durationMs = DurationToMs(JStr(s, "more_info.duration", JStr(s, "duration")));
    t.artwork = Img500(JStr(s, "image"));
    int64_t ex = JNum(s, "more_info.explicit_content");
    t.explicit_ = ex == 1 || JBool(s, "explicit");
    return true;
}
bool SaavnAlbum(const J& a, Album& out) {
    if (!a.is_object() || JStr(a, "id").empty()) return false;
    out.id = Stamp(kSaavn, JStr(a, "id"));
    out.title = DecodeEntities(JStr(a, "title", JStr(a, "name")));
    out.artists = SaavnArtists(a);
    if (out.artists.empty() && !JStr(a, "music").empty())
        out.artists.push_back({"", DecodeEntities(JStr(a, "music"))});
    out.year = JStr(a, "year");
    out.artwork = Img500(JStr(a, "image"));
    out.trackCount = (int)JNum(a, "more_info.song_count");
    return true;
}
bool SaavnPlaylist(const J& p, Playlist& out) {
    if (!p.is_object() || JStr(p, "id").empty()) return false;
    out.id = Stamp(kSaavn, JStr(p, "id"));
    out.title = DecodeEntities(JStr(p, "title", JStr(p, "name")));
    out.description = DecodeEntities(JStr(p, "description", JStr(p, "more_info.description")));
    out.artwork = Img500(JStr(p, "image"));
    out.trackCount = (int)JNum(p, "more_info.song_count");
    std::string fn = JStr(p, "more_info.firstname");
    out.author = !fn.empty() ? Trim(fn + " " + JStr(p, "more_info.lastname")) : JStr(p, "subtitle");
    return true;
}
bool SaavnArtist(const J& a, Artist& out) {
    if (!a.is_object() || JStr(a, "id").empty()) return false;
    out.id = Stamp(kSaavn, JStr(a, "id"));
    out.name = DecodeEntities(JStr(a, "name", JStr(a, "title")));
    out.artwork = Img500(JStr(a, "image"));
    out.subtitle = JStr(a, "subtitle");
    return true;
}

template <typename T, typename Fn>
std::vector<T> MapArr(const J* arr, Fn fn) {
    std::vector<T> out;
    if (arr && arr->is_array())
        for (auto& it : *arr) { T v; if (fn(it, v)) out.push_back(std::move(v)); }
    return out;
}

J SaavnLaunch(bool& ok) { return SaavnCall("webapi.getLaunchData", "", ok); }

bool SaavnHome(std::vector<Section>& out, std::string& err) {
    bool ok; J d = SaavnLaunch(ok);
    if (!ok) { err = "JioSaavn home load nahi hua"; return false; }
    auto push = [&](const char* title, std::vector<MediaItem> items) {
        if (!items.empty()) out.push_back({title, std::move(items)});
    };
    std::vector<MediaItem> trending;
    const J* nt = JNav(d, "new_trending");
    if (nt && nt->is_object()) {
        for (auto& [k, v] : nt->items())
            if (v.is_array())
                for (auto& s : v) { Track t; if (SaavnTrack(s, t)) trending.push_back({MediaItem::Kind::Track, t}); }
    } else if (nt && nt->is_array()) {
        for (auto& s : *nt) { Track t; if (SaavnTrack(s, t)) trending.push_back({MediaItem::Kind::Track, t}); }
    }
    push("Trending Now", std::move(trending));
    std::vector<MediaItem> albums;
    for (auto& a : MapArr<Album>(JNav(d, "new_albums"), SaavnAlbum)) albums.push_back({MediaItem::Kind::Album, {}, a});
    push("New Releases", std::move(albums));
    for (auto key : {"charts", "featured_playlists", "top_playlists"}) {
        std::vector<MediaItem> pls;
        for (auto& p : MapArr<Playlist>(JNav(d, key), SaavnPlaylist)) pls.push_back({MediaItem::Kind::Playlist, {}, {}, p});
        push(key == std::string("charts") ? "Charts" : key == std::string("featured_playlists") ? "Featured Playlists" : "Top Playlists",
             std::move(pls));
    }
    return true;
}

bool SaavnSearch(const std::string& q, const std::string& filter, int page, SearchOut& out, std::string& err) {
    std::string qq = UrlEncode(q);
    std::string p = std::to_string(std::max(1, page));
    bool ok = false;
    if (filter == "track") {
        J d = SaavnCall("search.getResults", "q=" + qq + "&p=" + p + "&n=20", ok);
        if (ok) out.tracks = MapArr<Track>(JNav(d, "results"), SaavnTrack);
    } else if (filter == "album") {
        J d = SaavnCall("search.getAlbumResults", "q=" + qq + "&p=" + p + "&n=20", ok);
        if (ok) out.albums = MapArr<Album>(JNav(d, "results"), SaavnAlbum);
    } else if (filter == "playlist") {
        J d = SaavnCall("search.getPlaylistResults", "q=" + qq + "&p=" + p + "&n=20", ok);
        if (ok) out.playlists = MapArr<Playlist>(JNav(d, "results"), SaavnPlaylist);
    } else if (filter == "artist") {
        J d = SaavnCall("search.getArtistResults", "q=" + qq + "&p=" + p + "&n=20", ok);
        if (ok) out.artists = MapArr<Artist>(JNav(d, "results"), SaavnArtist);
    } else {
        J d1 = SaavnCall("search.getResults", "q=" + qq + "&p=1&n=8", ok);
        if (ok) out.tracks = MapArr<Track>(JNav(d1, "results"), SaavnTrack);
        J d2 = SaavnCall("search.getAlbumResults", "q=" + qq + "&p=1&n=6", ok);
        if (ok) out.albums = MapArr<Album>(JNav(d2, "results"), SaavnAlbum);
        J d3 = SaavnCall("search.getPlaylistResults", "q=" + qq + "&p=1&n=6", ok);
        if (ok) out.playlists = MapArr<Playlist>(JNav(d3, "results"), SaavnPlaylist);
        J d4 = SaavnCall("search.getArtistResults", "q=" + qq + "&p=1&n=6", ok);
        if (ok) out.artists = MapArr<Artist>(JNav(d4, "results"), SaavnArtist);
    }
    if (out.tracks.empty() && out.albums.empty() && out.playlists.empty() && out.artists.empty() && !ok) {
        err = "JioSaavn search fail"; return false;
    }
    return true;
}

const J* SaavnSong(const std::string& id, J& holder, bool& ok) {
    holder = SaavnCall("song.getDetails", "pids=" + UrlEncode(id), ok);
    if (!ok) return nullptr;
    const J* songs = JNav(holder, "songs");
    if (!songs || !songs->is_array() || songs->empty()) { ok = false; return nullptr; }
    return &(*songs)[0];
}

bool SaavnStreams(const std::string& id, std::vector<StreamInfo>& out, std::string& err) {
    bool ok; J holder;
    const J* s = SaavnSong(id, holder, ok);
    if (!s) { err = "track nahi mila"; return false; }
    std::string enc = JStr(*s, "more_info.encrypted_media_url", JStr(*s, "encrypted_media_url"));
    if (enc.empty()) { err = "stream available nahi"; return false; }
    std::string base = des::DecryptSaavnUrl(enc);
    if (base.empty()) { err = "stream decrypt fail"; return false; }
    auto variant = [&](const char* quality, const std::string& url) {
        for (auto& v : out) if (v.url == url) return;
        out.push_back({quality, url, quality == std::string("320kbps") ? 320000 : quality == std::string("160kbps") ? 160000 : 96000});
    };
    std::regex re("_(96|160)\\.(mp4|m4a)");
    if (std::regex_search(base, re)) {
        variant("320kbps", std::regex_replace(base, re, "_320.$2"));
        variant("160kbps", std::regex_replace(base, re, "_160.$2"));
        variant("96kbps", std::regex_replace(base, re, "_96.$2"));
    } else variant("320kbps", base);
    std::string preview = JStr(*s, "more_info.media_preview_url", JStr(*s, "media_preview_url"));
    if (!preview.empty()) out.push_back({"preview", preview, 48000});
    return true;
}

/* ════════════════ YouTube Music ════════════════ */

const char* kYtKey = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

J YtCall(const std::string& endpoint, const J& body, bool& ok) {
    J full;
    full["context"]["client"] = {{"clientName", "WEB_REMIX"}, {"clientVersion", "1.20260222.01.00"},
                                 {"hl", "en"}, {"gl", "US"}};
    for (auto& [k, v] : body.items()) full[k] = v;
    std::string out;
    ok = net::PostJson("https://music.youtube.com/youtubei/v1/" + endpoint +
                           "?key=" + kYtKey + "&prettyPrint=false",
                       full.dump(), out,
                       "Origin: https://music.youtube.com\r\nReferer: https://music.youtube.com/\r\n"
                       "X-YouTube-Client-Name: 67\r\nX-YouTube-Client-Version: 1.20260222.01.00\r\n");
    if (!ok) return J();
    try { return J::parse(out); } catch (...) { ok = false; return J(); }
}

std::string RunsText(const J* runs) {
    std::string s;
    if (runs && runs->is_array()) for (auto& r : *runs) s += JStr(r, "text");
    return s;
}
std::string BestThumb(const J* thumbs) {
    if (!thumbs || !thumbs->is_array() || thumbs->empty()) return "";
    const J* best = nullptr;
    int bestW = -1;
    for (auto& t : *thumbs) {
        int w = (int)JNum(t, "width");
        if (w > bestW) { bestW = w; best = &t; }
    }
    std::string url = best ? JStr(*best, "url") : "";
    size_t p = url.find("=w");
    if (p != std::string::npos && url.find("-h", p) != std::string::npos) {
        size_t e = url.find_first_of("&?", p);
        url = url.substr(0, p) + "=w540-h540" + (e == std::string::npos ? "" : url.substr(e));
    }
    return url;
}
std::string ItemThumb(const J& r) {
    return BestThumb(JNav(r, "thumbnail.musicThumbnailRenderer.thumbnail.thumbnails"));
}
bool ItemExplicit(const J& r) {
    const J* badges = JNav(r, "badges");
    if (badges && badges->is_array())
        for (auto& b : *badges)
            if (JStr(b, "musicInlineBadgeRenderer.icon.iconType") == "MUSIC_EXPLICIT_BADGE") return true;
    return false;
}

bool YtListItem(const J& item, MediaItem& out) {
    const J* r = JNav(item, "musicResponsiveListItemRenderer");
    if (!r) return false;
    std::string title = JStr(*r, "flexColumns.0.musicResponsiveListItemFlexColumnRenderer.text.runs.0.text");
    const J* titleRun = JNav(*r, "flexColumns.0.musicResponsiveListItemFlexColumnRenderer.text.runs.0");
    const J* infoRuns = JNav(*r, "flexColumns.1.musicResponsiveListItemFlexColumnRenderer.text.runs");
    std::string thumb = ItemThumb(*r);
    std::string videoId = titleRun ? JStr(*titleRun, "navigationEndpoint.watchEndpoint.videoId") : "";
    if (!videoId.empty()) {
        Track t; t.id = Stamp(kYtm, videoId); t.title = DecodeEntities(title);
        std::string aName, aId, alName, alId, dur;
        if (infoRuns && infoRuns->is_array())
            for (auto& run : *infoRuns) {
                std::string bid = JStr(run, "navigationEndpoint.browseEndpoint.browseId");
                std::string text = JStr(run, "text");
                if (StartsWith(bid, "UC")) { aId = bid; aName = text; }
                else if (StartsWith(bid, "MPRE")) { alId = bid; alName = text; }
                else if (IsDurationText(text)) dur = text;
                else if (aName.empty() && !Trim(text).empty() && Trim(text) != "•") aName = text;
            }
        if (!aName.empty()) t.artists.push_back({aId.empty() ? "" : Stamp(kYtm, aId), DecodeEntities(aName)});
        if (!alName.empty()) { t.albumId = Stamp(kYtm, alId); t.albumTitle = DecodeEntities(alName); }
        t.durationMs = DurationToMs(dur);
        t.artwork = thumb;
        t.explicit_ = ItemExplicit(*r);
        out = {MediaItem::Kind::Track, t};
        return true;
    }
    std::string browseId = titleRun ? JStr(*titleRun, "navigationEndpoint.browseEndpoint.browseId") : "";
    if (browseId.empty()) browseId = JStr(*r, "navigationEndpoint.browseEndpoint.browseId");
    if (browseId.empty()) return false;
    std::string info = infoRuns ? RunsText(infoRuns) : "";
    if (StartsWith(browseId, "MPRE")) {
        Album a; a.id = Stamp(kYtm, browseId); a.title = DecodeEntities(title); a.artwork = thumb;
        auto parts = Split(info, " • ");
        for (auto& p : parts) {
            std::string pt = Trim(p);
            if (pt.size() == 4 && std::all_of(pt.begin(), pt.end(), ::isdigit)) a.year = pt;
        }
        if (infoRuns && infoRuns->is_array())
            for (auto& run : *infoRuns) {
                std::string bid = JStr(run, "navigationEndpoint.browseEndpoint.browseId");
                if (StartsWith(bid, "UC")) a.artists.push_back({Stamp(kYtm, bid), DecodeEntities(JStr(run, "text"))});
            }
        if (a.artists.empty()) {
            for (auto& p : parts) {
                std::string pt = Trim(p);
                if (!pt.empty() && pt != "Album" && pt != a.year) { a.artists.push_back({"", DecodeEntities(pt)}); break; }
            }
        }
        out = {MediaItem::Kind::Album, {}, a};
        return true;
    }
    if (StartsWith(browseId, "VL") || StartsWith(browseId, "PL") || StartsWith(browseId, "OLAK") || StartsWith(browseId, "RD")) {
        Playlist p; p.id = Stamp(kYtm, browseId); p.title = DecodeEntities(title); p.artwork = thumb;
        auto parts = Split(info, " • ");
        if (!parts.empty()) p.author = Trim(parts[0]) == "Playlist" ? "" : Trim(parts[0]);
        for (auto& part : parts) {
            std::string pt = Trim(part);
            if (pt.find("songs") != std::string::npos) {
                std::string num;
                for (char c : pt) if (isdigit((unsigned char)c)) num += c;
                if (!num.empty()) p.trackCount = std::stoi(num);
            }
        }
        out = {MediaItem::Kind::Playlist, {}, {}, p};
        return true;
    }
    if (StartsWith(browseId, "UC")) {
        Artist a; a.id = Stamp(kYtm, browseId); a.name = DecodeEntities(title); a.artwork = thumb;
        a.subtitle = info;
        size_t pos = a.subtitle.find("Artist • ");
        if (pos == 0) a.subtitle = a.subtitle.substr(9);
        else if (a.subtitle == "Artist") a.subtitle = "Artist";
        out = {MediaItem::Kind::Artist, {}, {}, {}, a};
        return true;
    }
    return false;
}

bool YtTwoRow(const J& item, MediaItem& out) {
    const J* r = JNav(item, "musicTwoRowItemRenderer");
    if (!r) return false;
    std::string title = RunsText(JNav(*r, "title.runs"));
    std::string subtitle = RunsText(JNav(*r, "subtitle.runs"));
    std::string browseId = JStr(*r, "navigationEndpoint.browseEndpoint.browseId");
    std::string videoId = JStr(*r, "navigationEndpoint.watchEndpoint.videoId");
    std::string thumb = BestThumb(JNav(*r, "thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails"));
    if (!videoId.empty()) {
        Track t; t.id = Stamp(kYtm, videoId); t.title = DecodeEntities(title); t.artwork = thumb;
        auto parts = Split(subtitle, " • ");
        if (!parts.empty() && !Trim(parts[0]).empty()) t.artists.push_back({"", DecodeEntities(Trim(parts[0]))});
        out = {MediaItem::Kind::Track, t};
        return true;
    }
    if (browseId.empty()) return false;
    if (StartsWith(browseId, "UC")) {
        Artist a; a.id = Stamp(kYtm, browseId); a.name = DecodeEntities(title); a.artwork = thumb; a.subtitle = subtitle;
        out = {MediaItem::Kind::Artist, {}, {}, {}, a};
        return true;
    }
    if (StartsWith(browseId, "MPRE")) {
        Album a; a.id = Stamp(kYtm, browseId); a.title = DecodeEntities(title); a.artwork = thumb;
        auto parts = Split(subtitle, " • ");
        for (auto& p : parts) {
            std::string pt = Trim(p);
            if (pt.size() == 4 && std::all_of(pt.begin(), pt.end(), ::isdigit)) a.year = pt;
            else if (!pt.empty() && pt != "Album" && a.artists.empty()) a.artists.push_back({"", DecodeEntities(pt)});
        }
        out = {MediaItem::Kind::Album, {}, a};
        return true;
    }
    Playlist p; p.id = Stamp(kYtm, browseId); p.title = DecodeEntities(title); p.artwork = thumb;
    auto parts = Split(subtitle, " • ");
    if (!parts.empty()) p.author = Trim(parts[0]);
    out = {MediaItem::Kind::Playlist, {}, {}, p};
    return true;
}

std::vector<MediaItem> ShelfItems(const J* shelf) {
    std::vector<MediaItem> out;
    const J* contents = shelf ? JNav(*shelf, "contents") : nullptr;
    if (contents && contents->is_array())
        for (auto& c : *contents) {
            MediaItem mi;
            if (YtListItem(c, mi) || YtTwoRow(c, mi)) out.push_back(std::move(mi));
        }
    return out;
}

bool YtHome(std::vector<Section>& out, std::string& err) {
    bool ok; J json = YtCall("browse", {{"browseId", "FEmusic_home"}}, ok);
    if (!ok) { err = "YouTube Music home load nahi hua"; return false; }
    const J* sections = JNav(json, "contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents");
    if (!sections || !sections->is_array()) { err = "home format samajh nahi aaya"; return false; }
    for (auto& s : *sections) {
        const J* carousel = JNav(s, "musicCarouselShelfRenderer");
        const J* shelf = JNav(s, "musicShelfRenderer");
        std::string title = carousel ? RunsText(JNav(*carousel, "header.musicCarouselShelfBasicHeaderRenderer.title.runs"))
                                     : RunsText(JNav(s, "musicShelfRenderer.title.runs"));
        auto items = ShelfItems(carousel ? carousel : shelf);
        if (!title.empty() && !items.empty()) out.push_back({title, std::move(items)});
    }
    return true;
}

bool YtSearch(const std::string& q, const std::string& filter, SearchOut& out, std::string& err) {
    bool ok; J json = YtCall("search", {{"query", q}}, ok);
    if (!ok) { err = "YouTube Music search fail"; return false; }
    const J* contents = JNav(json, "contents.tabbedSearchResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents");
    if (!contents || !contents->is_array()) return true;
    for (auto& section : *contents) {
        const J* shelf = JNav(section, "musicShelfRenderer");
        if (!shelf) continue;
        std::string shelfTitle = RunsText(JNav(*shelf, "title.runs"));
        std::string low;
        for (char c : shelfTitle) low += (char)tolower((unsigned char)c);
        auto items = ShelfItems(shelf);
        for (auto& i : items) {
            bool shelfMatch =
                (low.find("song") != std::string::npos && i.kind == MediaItem::Kind::Track) ||
                (low.find("album") != std::string::npos && i.kind == MediaItem::Kind::Album) ||
                (low.find("playlist") != std::string::npos && i.kind == MediaItem::Kind::Playlist) ||
                (low.find("artist") != std::string::npos && i.kind == MediaItem::Kind::Artist);
            bool noShelfKind = low.find("song") == std::string::npos && low.find("album") == std::string::npos &&
                               low.find("playlist") == std::string::npos && low.find("artist") == std::string::npos;
            if (!shelfMatch && !noShelfKind) continue;
            switch (i.kind) {
                case MediaItem::Kind::Track: out.tracks.push_back(i.track); break;
                case MediaItem::Kind::Album: out.albums.push_back(i.album); break;
                case MediaItem::Kind::Playlist: out.playlists.push_back(i.playlist); break;
                case MediaItem::Kind::Artist: out.artists.push_back(i.artist); break;
            }
        }
    }
    return true;
}

/* ── signature cipher ── */
std::string DecipherWithJs(const std::string& js, const std::string& sig, bool& ok) {
    ok = false;
    std::smatch fm;
    std::regex fnRe(R"(function\s*[A-Za-z0-9$_]*\s*\(a\)\{a=a\.split\(""\);([\s\S]{0,3000}?)return a\.join\(""\))");
    if (!std::regex_search(js, fm, fnRe)) return "";
    std::string body = fm[1].str();
    std::regex callRe(R"(([A-Za-z0-9$_]+)\.([A-Za-z0-9$_]+)\(a(?:,(\d+))?\))");
    struct Call { std::string fn; int arg; };
    std::vector<Call> calls;
    std::string objName;
    for (std::sregex_iterator it(body.begin(), body.end(), callRe), end; it != end; ++it) {
        if (objName.empty()) objName = (*it)[1].str();
        calls.push_back({(*it)[2].str(), (*it)[3].matched ? std::stoi((*it)[3].str()) : 0});
    }
    if (calls.empty() || objName.empty()) return "";
    std::string esc;
    for (char c : objName) { if (c == '$') esc += "\\$"; else esc += c; }
    std::smatch om;
    std::regex objRe("(?:var\\s+)?" + esc + R"(=\{([\s\S]{0,4000}?)\};)");
    if (!std::regex_search(js, om, objRe)) return "";
    std::string objBody = om[1].str();
    std::map<std::string, int> ops;  // 0 reverse, 1 splice, 2 swap
    std::regex entryRe(R"(([A-Za-z0-9$_]+):function\([^)]*\)\{([^}]*)\})");
    for (std::sregex_iterator it(objBody.begin(), objBody.end(), entryRe), end; it != end; ++it) {
        std::string b = (*it)[2].str();
        ops[(*it)[1].str()] = b.find("reverse") != std::string::npos ? 0 : b.find("splice") != std::string::npos ? 1 : 2;
    }
    std::vector<char> arr(sig.begin(), sig.end());
    for (auto& c : calls) {
        auto it = ops.find(c.fn);
        if (it == ops.end()) continue;
        if (it->second == 0) std::reverse(arr.begin(), arr.end());
        else if (it->second == 1) arr.erase(arr.begin(), arr.begin() + std::min<int>(c.arg, (int)arr.size()));
        else if (!arr.empty()) std::swap(arr[0], arr[c.arg % (int)arr.size()]);
    }
    ok = true;
    return std::string(arr.begin(), arr.end());
}

std::string g_baseJs;
int64_t g_baseJsAt = 0;
bool PlayerBaseJs(const std::string& videoId, std::string& out) {
    int64_t now = (int64_t)time(nullptr);
    if (!g_baseJs.empty() && now - g_baseJsAt < 6 * 3600) { out = g_baseJs; return true; }
    std::string embed;
    if (!net::Get("https://www.youtube.com/embed/" + videoId, embed)) return false;
    std::smatch m;
    if (!std::regex_search(embed, m, std::regex(R"re("jsUrl":"([^"]+)")re"))) return false;
    std::string url = m[1].str();
    if (!StartsWith(url, "http")) {
        std::string clean;
        for (size_t i = 0; i < url.size(); i++) {
            if (url[i] == '\\' && i + 1 < url.size() && url[i + 1] == '/') { clean += '/'; i++; }
            else clean += url[i];
        }
        url = "https://www.youtube.com" + clean;
    }
    if (!net::Get(url, out)) return false;
    g_baseJs = out; g_baseJsAt = now;
    return true;
}

bool YtStreams(const std::string& videoId, std::vector<StreamInfo>& out, std::string& err) {
    struct Client { const char* name; const char* ver; const char* ua; J extra; };
    std::vector<Client> clients = {
        {"IOS", "20.10.4", "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
         {{"deviceMake", "Apple"}, {"deviceModel", "iPhone16,2"}, {"osName", "iPhone"}, {"osVersion", "18.3.2.22D82"}}},
        {"ANDROID", "20.10.1", "com.google.android.youtube/20.10.1 (Linux; U; Android 14; en_US) gzip",
         {{"androidSdkVersion", 34}, {"osName", "Android"}, {"osVersion", "14"}}},
        {"TVHTML5", "7.20250205.16.00", "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36", J()},
    };
    std::string baseJs;
    for (auto& c : clients) {
        J client = {{"clientName", c.name}, {"clientVersion", c.ver}, {"userAgent", c.ua}, {"hl", "en"}, {"gl", "US"}};
        if (c.extra.is_object()) for (auto& [k, v] : c.extra.items()) client[k] = v;
        J body;
        body["context"]["client"] = client;
        body["videoId"] = videoId;
        body["playbackContext"]["contentPlaybackContext"] = {{"vis", 0}, {"splay", false},
            {"lactMilliseconds", "-1"}, {"signatureTimestamp", 20000}};
        body["racyCheckOk"] = true;
        body["contentCheckOk"] = true;
        std::string resp;
        if (!net::PostJson(std::string("https://www.youtube.com/youtubei/v1/player?key=") + kYtKey + "&prettyPrint=false",
                           body.dump(), resp, std::string("User-Agent: ") + c.ua + "\r\nOrigin: https://www.youtube.com\r\n"))
            continue;
        J json;
        try { json = J::parse(resp); } catch (...) { continue; }
        const J* sd = JNav(json, "streamingData");
        if (!sd) continue;
        std::vector<const J*> formats;
        for (auto key : {"formats", "adaptiveFormats"}) {
            const J* f = JNav(*sd, key);
            if (f && f->is_array()) for (auto& it : *f) formats.push_back(&it);
        }
        std::vector<StreamInfo> found;
        for (auto* f : formats) {
            std::string mime = JStr(*f, "mimeType");
            if (!StartsWith(mime, "audio/")) continue;
            std::string url = JStr(*f, "url");
            if (url.empty()) {
                std::string cipher = JStr(*f, "signatureCipher");
                if (!cipher.empty()) {
                    /* s, sp, url params (URL-encoded form) */
                    std::map<std::string, std::string> kv;
                    for (auto& pair : Split(cipher, "&")) {
                        size_t eq = pair.find('=');
                        if (eq != std::string::npos) {
                            auto dec = [](std::string s) {
                                std::string o;
                                for (size_t i = 0; i < s.size(); i++) {
                                    if (s[i] == '%' && i + 2 < s.size()) {
                                        o += (char)std::stoi(s.substr(i + 1, 2), nullptr, 16); i += 2;
                                    } else if (s[i] == '+') o += ' ';
                                    else o += s[i];
                                }
                                return o;
                            };
                            kv[dec(pair.substr(0, eq))] = dec(pair.substr(eq + 1));
                        }
                    }
                    if (kv.count("s") && kv.count("url")) {
                        if (baseJs.empty() && !PlayerBaseJs(videoId, baseJs)) continue;
                        bool okc = false;
                        std::string sig = DecipherWithJs(baseJs, kv["s"], okc);
                        if (okc) url = kv["url"] + "&" + (kv.count("sp") ? kv["sp"] : "sig") + "=" + UrlEncode(sig);
                    }
                }
            }
            if (!url.empty()) {
                int br = (int)JNum(*f, "bitrate");
                found.push_back({std::to_string((br + 500) / 1000) + "kbps", url, br});
            }
        }
        std::sort(found.begin(), found.end(), [](const StreamInfo& a, const StreamInfo& b) { return a.bitrate > b.bitrate; });
        if (!found.empty()) { out = found; return true; }
    }
    err = "playable stream nahi mila (player clients fail)";
    return false;
}

bool YtRadio(const std::string& videoId, std::vector<Track>& out, std::string& err) {
    bool ok; J json = YtCall("next", {{"videoId", videoId}, {"playlistId", "RDAMVM" + videoId}, {"isAudioOnly", true}}, ok);
    if (!ok) { err = "radio load fail"; return false; }
    const J* contents = JNav(json, "contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs.0.tabRenderer.content.musicQueueRenderer.content.playlistPanelRenderer.contents");
    if (!contents || !contents->is_array()) { err = "radio format"; return false; }
    for (auto& c : *contents) {
        const J* v = JNav(c, "playlistPanelVideoRenderer");
        if (!v) continue;
        std::string vid = JStr(*v, "videoId");
        if (vid.empty()) continue;
        Track t; t.id = Stamp(kYtm, vid);
        t.title = DecodeEntities(RunsText(JNav(*v, "title.runs")));
        std::string byline = RunsText(JNav(*v, "longBylineText.runs"));
        auto parts = Split(byline, " • ");
        if (!parts.empty() && !Trim(parts[0]).empty()) t.artists.push_back({"", DecodeEntities(Trim(parts[0]))});
        if (parts.size() > 1 && !Trim(parts[1]).empty()) t.albumTitle = DecodeEntities(Trim(parts[1]));
        t.durationMs = DurationToMs(RunsText(JNav(*v, "lengthText.runs")));
        t.artwork = BestThumb(JNav(*v, "thumbnail.thumbnails"));
        out.push_back(std::move(t));
    }
    return true;
}

const J* BrowseSections(const J& json) {
    const J* a = JNav(json, "contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents");
    if (a) return a;
    return JNav(json, "contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents");
}

bool YtAlbumDetails(const std::string& id, Album& out, std::string& err) {
    std::string browseId = StartsWith(id, "MPRE") ? id : "MPRE" + id;
    bool ok; J json = YtCall("browse", {{"browseId", browseId}}, ok);
    if (!ok) { err = "album load fail"; return false; }
    const J* header = JNav(json, "header.musicResponsiveHeaderRenderer");
    if (!header) header = JNav(json, "header.musicDetailHeaderRenderer");
    out.id = Stamp(kYtm, browseId);
    out.title = DecodeEntities(RunsText(header ? JNav(*header, "title.runs") : nullptr));
    const J* subRuns = header ? JNav(*header, "subtitle.runs") : nullptr;
    if (subRuns && subRuns->is_array())
        for (auto& r : *subRuns) {
            std::string bid = JStr(r, "navigationEndpoint.browseEndpoint.browseId");
            std::string text = JStr(r, "text");
            if (StartsWith(bid, "UC")) out.artists.push_back({Stamp(kYtm, bid), DecodeEntities(text)});
            else if (text.size() == 4 && std::all_of(text.begin(), text.end(), ::isdigit)) out.year = text;
            else if (out.artists.empty() && !Trim(text).empty() && Trim(text) != "•" && Trim(text) != "Album")
                out.artists.push_back({"", DecodeEntities(text)});
        }
    out.artwork = header ? BestThumb(JNav(*header, "thumbnail.musicThumbnailRenderer.thumbnail.thumbnails")) : "";
    const J* sections = BrowseSections(json);
    if (sections && sections->is_array())
        for (auto& s : *sections) {
            const J* shelf = JNav(s, "musicShelfRenderer");
            for (auto& mi : ShelfItems(shelf))
                if (mi.kind == MediaItem::Kind::Track) {
                    Track t = mi.track;
                    if (t.albumId.empty()) { t.albumId = out.id; t.albumTitle = out.title; }
                    out.tracks.push_back(std::move(t));
                }
        }
    out.trackCount = (int)out.tracks.size();
    return true;
}

bool YtPlaylistDetails(const std::string& id, Playlist& out, std::string& err) {
    std::string browseId = StartsWith(id, "VL") ? id : "VL" + id;
    bool ok; J json = YtCall("browse", {{"browseId", browseId}}, ok);
    if (!ok) { err = "playlist load fail"; return false; }
    const J* header = JNav(json, "header.musicResponsiveHeaderRenderer");
    if (!header) header = JNav(json, "header.musicDetailHeaderRenderer");
    out.id = Stamp(kYtm, browseId);
    out.title = DecodeEntities(RunsText(header ? JNav(*header, "title.runs") : nullptr));
    out.artwork = header ? BestThumb(JNav(*header, "thumbnail.musicThumbnailRenderer.thumbnail.thumbnails")) : "";
    const J* sections = BrowseSections(json);
    if (sections && sections->is_array())
        for (auto& s : *sections) {
            const J* shelf = JNav(s, "musicPlaylistShelfRenderer");
            if (!shelf) shelf = JNav(s, "musicShelfRenderer");
            for (auto& mi : ShelfItems(shelf))
                if (mi.kind == MediaItem::Kind::Track) out.tracks.push_back(mi.track);
        }
    out.trackCount = (int)out.tracks.size();
    return true;
}

bool YtArtistDetails(const std::string& id, Artist& out, std::string& err) {
    bool ok; J json = YtCall("browse", {{"browseId", id}}, ok);
    if (!ok) { err = "artist load fail"; return false; }
    const J* header = JNav(json, "header.musicImmersiveHeaderRenderer");
    if (!header) header = JNav(json, "header.musicResponsiveHeaderRenderer");
    out.id = Stamp(kYtm, id);
    out.name = DecodeEntities(RunsText(header ? JNav(*header, "title.runs") : nullptr));
    out.artwork = header ? BestThumb(JNav(*header, "thumbnail.musicThumbnailRenderer.thumbnail.thumbnails")) : "";
    out.bio = RunsText(header ? JNav(*header, "description.runs") : nullptr);
    if (out.bio.size() > 500) out.bio = out.bio.substr(0, 500);
    const J* a = JNav(json, "contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents");
    if (!a) a = JNav(json, "contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents");
    if (a && a->is_array())
        for (auto& s : *a) {
            if (JNav(s, "musicShelfRenderer"))
                for (auto& mi : ShelfItems(JNav(s, "musicShelfRenderer")))
                    if (mi.kind == MediaItem::Kind::Track && out.topTracks.size() < 10) out.topTracks.push_back(mi.track);
            if (JNav(s, "musicCarouselShelfRenderer"))
                for (auto& mi : ShelfItems(JNav(s, "musicCarouselShelfRenderer"))) {
                    if (mi.kind == MediaItem::Kind::Album) out.albums.push_back(mi.album);
                    else if (mi.kind == MediaItem::Kind::Playlist) {
                        Album al; al.id = mi.playlist.id; al.title = mi.playlist.title; al.artwork = mi.playlist.artwork;
                        out.albums.push_back(al);
                    }
                }
        }
    return true;
}

/* ════════════════ lyrics (LRCLIB) ════════════════ */

LyricsOut ParseLrc(const std::string& synced, const std::string& plain) {
    LyricsOut out;
    out.plain = plain;
    std::regex re(R"(^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$)");
    for (auto& line : Split(synced, "\n")) {
        std::smatch m;
        if (std::regex_match(line, m, re)) {
            int64_t ms = (int64_t)((std::stod(m[1].str()) * 60 + std::stod(m[2].str())) * 1000);
            out.lines.push_back({ms, m[3].str()});
        }
    }
    std::sort(out.lines.begin(), out.lines.end());
    out.synced = !out.lines.empty();
    return out;
}

bool LrclibLyrics(const Track& t, LyricsOut& out) {
    std::string artist = t.artists.empty() ? "" : t.artists[0].name;
    if (t.title.empty() || artist.empty()) return false;
    std::string url = "https://lrclib.net/api/get?track_name=" + UrlEncode(t.title) +
                      "&artist_name=" + UrlEncode(artist);
    if (!t.albumTitle.empty()) url += "&album_name=" + UrlEncode(t.albumTitle);
    if (t.durationMs) url += "&duration=" + std::to_string(t.durationMs / 1000);
    std::string body;
    if (net::Get(url, body)) {
        try {
            J d = J::parse(body);
            std::string synced = JStr(d, "syncedLyrics"), plain = JStr(d, "plainLyrics");
            if (!synced.empty() || !plain.empty()) { out = ParseLrc(synced, plain); return true; }
        } catch (...) {}
    }
    std::string url2 = "https://lrclib.net/api/search?track_name=" + UrlEncode(t.title) +
                       "&artist_name=" + UrlEncode(artist);
    if (net::Get(url2, body)) {
        try {
            J list = J::parse(body);
            if (list.is_array()) {
                const J* best = nullptr;
                for (auto& it : list) { if (!JStr(it, "syncedLyrics").empty()) { best = &it; break; } }
                if (!best && !list.empty()) best = &list[0];
                if (best) {
                    std::string synced = JStr(*best, "syncedLyrics"), plain = JStr(*best, "plainLyrics");
                    if (!synced.empty() || !plain.empty()) { out = ParseLrc(synced, plain); return true; }
                }
            }
        } catch (...) {}
    }
    return false;
}

} // namespace

/* ════════════════ facade ════════════════ */

bool Home(const std::string& src, std::vector<Section>& out, std::string& err) {
    return src == kYtm ? YtHome(out, err) : SaavnHome(out, err);
}

bool Search(const std::string& src, const std::string& q, const std::string& filter,
            int page, SearchOut& out, std::string& err) {
    if (src == kYtm) return YtSearch(q, filter, out, err);
    return SaavnSearch(q, filter, page, out, err);
}

bool Suggestions(const std::string& src, const std::string& q, std::vector<std::string>& out, std::string& err) {
    if (src == kYtm) {
        bool ok; J json = YtCall("music/get_search_suggestions", {{"input", q}}, ok);
        if (!ok) { err = "suggestions fail"; return false; }
        const J* contents = JNav(json, "contents.0.searchSuggestionsSectionRenderer.contents");
        if (contents && contents->is_array())
            for (auto& c : *contents) {
                std::string t = RunsText(JNav(c, "searchSuggestionRenderer.suggestion.runs"));
                if (!t.empty()) out.push_back(t);
            }
        if (out.size() > 10) out.resize(10);
        return true;
    }
    bool ok; J d = SaavnCall("autocomplete.get", "query=" + UrlEncode(q), ok);
    if (ok) {
        for (auto key : {"songs", "albums", "artists", "playlists"}) {
            const J* arr = JNav(d, std::string(key) + ".data");
            if (arr && arr->is_array())
                for (auto& it : *arr) {
                    std::string t = DecodeEntities(JStr(it, "title", JStr(it, "name")));
                    if (!t.empty() && std::find(out.begin(), out.end(), t) == out.end()) out.push_back(t);
                }
        }
        if (!out.empty()) { if (out.size() > 10) out.resize(10); return true; }
    }
    SearchOut so;
    if (SaavnSearch(q, "track", 1, so, err)) {
        for (auto& t : so.tracks) if (out.size() < 5) out.push_back(t.title);
        return true;
    }
    return false;
}

bool TrackDetails(const std::string& stampedId, Track& out, std::string& err) {
    std::string src = SrcOf(stampedId), local = LocalOf(stampedId);
    if (src == kYtm) {
        std::vector<Track> radio;
        if (!YtRadio(local, radio, err)) return false;
        for (auto& t : radio) if (t.id == stampedId) { out = t; return true; }
        if (!radio.empty()) { out = radio[0]; return true; }
        err = "track nahi mila"; return false;
    }
    bool ok; J holder;
    const J* s = SaavnSong(local, holder, ok);
    if (!s) { err = "track nahi mila"; return false; }
    if (!SaavnTrack(*s, out)) { err = "track parse fail"; return false; }
    return true;
}

bool Streams(const std::string& stampedId, std::vector<StreamInfo>& out, std::string& err) {
    std::string src = SrcOf(stampedId), local = LocalOf(stampedId);
    return src == kYtm ? YtStreams(local, out, err) : SaavnStreams(local, out, err);
}

bool AlbumDetails(const std::string& stampedId, Album& out, std::string& err) {
    std::string src = SrcOf(stampedId), local = LocalOf(stampedId);
    if (src == kYtm) return YtAlbumDetails(local, out, err);
    bool ok; J d = SaavnCall("content.getAlbumDetails", "albumid=" + UrlEncode(local), ok);
    if (!ok || JStr(d, "id").empty()) { err = "album nahi mila"; return false; }
    if (!SaavnAlbum(d, out)) { err = "album parse fail"; return false; }
    const J* songs = JNav(d, "songs");
    if (!songs || !songs->is_array()) songs = JNav(d, "list");
    out.tracks = MapArr<Track>(songs, SaavnTrack);
    out.trackCount = (int)out.tracks.size();
    return true;
}

bool PlaylistDetails(const std::string& stampedId, Playlist& out, std::string& err) {
    std::string src = SrcOf(stampedId), local = LocalOf(stampedId);
    if (src == kYtm) return YtPlaylistDetails(local, out, err);
    bool ok; J d = SaavnCall("playlist.getDetails", "listid=" + UrlEncode(local), ok);
    if (!ok || JStr(d, "id").empty()) { err = "playlist nahi mili"; return false; }
    if (!SaavnPlaylist(d, out)) { err = "playlist parse fail"; return false; }
    const J* songs = JNav(d, "songs");
    if (!songs || !songs->is_array()) songs = JNav(d, "list");
    out.tracks = MapArr<Track>(songs, SaavnTrack);
    out.trackCount = (int)out.tracks.size();
    return true;
}

bool ArtistDetails(const std::string& stampedId, Artist& out, std::string& err) {
    std::string src = SrcOf(stampedId), local = LocalOf(stampedId);
    if (src == kYtm) return YtArtistDetails(local, out, err);
    bool ok; J d = SaavnCall("artist.getArtistPageDetails",
                             "artistId=" + UrlEncode(local) + "&page=1&n_song=20&n_album=12", ok);
    if (!ok || (JStr(d, "id").empty() && JStr(d, "name").empty())) { err = "artist nahi mila"; return false; }
    Artist base;
    J tmp = d; tmp["id"] = JStr(d, "id", local);
    SaavnArtist(tmp, out);
    const J* ts = JNav(d, "topSongs.songs");
    if (!ts) ts = JNav(d, "topSongs");
    out.topTracks = MapArr<Track>(ts, SaavnTrack);
    const J* ta = JNav(d, "topAlbums.albums");
    if (!ta) ta = JNav(d, "topAlbums");
    out.albums = MapArr<Album>(ta, SaavnAlbum);
    std::string bio = JStr(d, "bio");
    if (!bio.empty()) {
        std::string clean;
        bool inTag = false;
        for (char c : bio) { if (c == '<') inTag = true; else if (c == '>') inTag = false; else if (!inTag) clean += c; }
        out.bio = clean.substr(0, 500);
    }
    return true;
}

bool Radio(const std::string& stampedId, int page, std::vector<Track>& out, std::string& err) {
    std::string src = SrcOf(stampedId), local = LocalOf(stampedId);
    if (src == kYtm) return YtRadio(local, out, err);
    bool ok; J st = SaavnCall("webradio.createEntityStation",
                               "entity_id=" + UrlEncode(local) + "&entity_type=queue", ok, "android");
    std::string station = ok ? JStr(st, "stationid") : "";
    if (station.empty()) { err = "radio station nahi bana"; return false; }
    J d = SaavnCall("webradio.getSong", "stationid=" + UrlEncode(station) + "&k=15&p=" + std::to_string(page), ok, "android");
    if (!ok) { err = "radio songs fail"; return false; }
    const J* songs = JNav(d, "songs");
    if (songs && songs->is_array()) out = MapArr<Track>(songs, SaavnTrack);
    else if (d.is_object())
        for (auto& [k, v] : d.items()) {
            const J* s = JNav(v, "song");
            Track t; if (s && SaavnTrack(*s, t)) out.push_back(std::move(t));
        }
    return true;
}

bool Charts(const std::string& src, std::vector<Playlist>& out, std::string& err) {
    if (src == kYtm) {
        std::vector<Section> sections;
        if (!YtHome(sections, err)) return false;
        for (auto& s : sections)
            for (auto& i : s.items)
                if (i.kind == MediaItem::Kind::Playlist) out.push_back(i.playlist);
        return true;
    }
    bool ok; J d = SaavnLaunch(ok);
    if (!ok) { err = "charts load fail"; return false; }
    out = MapArr<Playlist>(JNav(d, "charts"), SaavnPlaylist);
    return true;
}

bool ChartDetails(const std::string& stampedId, std::vector<Track>& out, std::string& err) {
    Playlist p;
    if (!PlaylistDetails(stampedId, p, err)) return false;
    out = p.tracks;
    return true;
}

bool LyricsForTrack(const Track& t, LyricsOut& out, std::string& err) {
    if (LrclibLyrics(t, out)) return true;
    if (SrcOf(t.id) == kSaavn) {
        bool ok; J d = SaavnCall("lyrics.getLyrics", "lyrics_id=" + UrlEncode(LocalOf(t.id)), ok);
        if (ok && !JStr(d, "lyrics").empty()) {
            std::string plain = JStr(d, "lyrics");
            std::string clean;
            size_t pos = 0;
            while (true) {
                size_t b = plain.find("<br", pos);
                if (b == std::string::npos) { clean += plain.substr(pos); break; }
                clean += plain.substr(pos, b - pos) + "\n";
                size_t e = plain.find('>', b);
                pos = e == std::string::npos ? plain.size() : e + 1;
            }
            out.plain = clean; out.synced = false; out.lines.clear();
            return true;
        }
    }
    err = "lyrics nahi mile";
    return false;
}

} // namespace api
