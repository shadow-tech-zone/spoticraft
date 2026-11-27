/* Bloomee — Spotify-measured native Windows desktop (study doc §10 mapping).
   Win32 + Direct2D custom-drawn; MF/WASAPI playback; sources native C++. */
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <shellapi.h>

#include <algorithm>
#include <cmath>
#include <deque>
#include <random>

#include <shlwapi.h>

#include "api.h"
#include "common.h"
#include "net.h"
#include "player.h"
#include "state.h"
#include "ui.h"

HWND g_mainWnd = nullptr;
static HWND g_hwnd = nullptr;
static HWND g_edit = nullptr;
static Player g_player;
static NOTIFYICONDATAW g_tray{};

/* tray/menu messages */
constexpr UINT WM_APP_TRAY = WM_APP + 60;

/* ── zone ids ── */
enum Zone {
    Z_NONE = 0,
    Z_SIDEBAR_HOME, Z_SIDEBAR_RADIOTOP, Z_SIDEBAR_LIB, Z_SIDEBAR_NEWPL,
    Z_LIB_ROW = 100, Z_LIB_LIKED = 190,                 // 100..149 playlists, 190 liked-in-sidebar
    Z_SEARCH_INPUT = 200, Z_FILTER_ALL, Z_FILTER_SONG, Z_FILTER_ALBUM, Z_FILTER_PLAYLIST, Z_FILTER_ARTIST,
    Z_CHIP_SRC = 210, Z_CHIP_SRC2 = 211,
    Z_CARD = 300,                                      // 300+i (grid home/search)
    Z_ROW = 400,                                       // 400+i track rows
    Z_HERO_PLAY = 520, Z_HERO_LIKE, Z_HERO_MORE,
    Z_TRANSPORT_PLAY = 530, Z_TRANSPORT_PREV, Z_TRANSPORT_NEXT, Z_TRANSPORT_SHUFFLE, Z_TRANSPORT_REPEAT,
    Z_SEEKBAR = 540, Z_VOLBAR,
    Z_NP_HEART = 550, Z_NP_PIP, Z_NP_LYRICS, Z_NP_QUEUE, Z_NP_FULL, Z_NP_COVER, Z_NP_TITLE,
    Z_VOLUME_ICON = 557,
    Z_WIN_MIN = 560, Z_WIN_MAX, Z_WIN_CLOSE,
    Z_BACK = 570, Z_FORWARD, Z_LOGO,
    Z_RP_CLOSE = 580, Z_RP_TABQ = 581, Z_RP_TABL = 582, Z_RP_REMOVE = 590,  // 590+i
    Z_RP_ROW = 600,                                    // 600+i
    Z_MENU_ITEM = 700,                                 // 700+i
    Z_CTX_TARGET = 750,
    Z_SUGGEST = 1300,                                  // 1300+i suggestion rows
    Z_SETTINGS_SRC = 760, Z_SETTINGS_ABOUT,
    Z_LYRICS_SCROLL = 770,
    Z_PLAYING_BADGE = 780,
    Z_CHART_ROW = 800,                                 // 800+i charts page rows
    Z_ARTIST_CIRCLE = 850,
    Z_ACTION_SETTINGS = 900,
};

enum class PageKind { Home, Search, List, Artist, Liked, Charts, LocalPlaylist, LyricsFS, Settings };

struct View {
    PageKind kind = PageKind::Home;
    std::string id;       // stamped (album/playlist/artist/local)
    std::string title;    // detail header cache
    std::string query;
    std::string filter = "all";
    bool isAlbum = false; // List page: album vs playlist routing
};

/* LoadView ka result packet (worker -> UI thread) */
struct LoadedResult {
    bool ok = false; std::string err;
    std::vector<Section> sections; api::SearchOut search;
    Album album; Playlist playlist; Artist artist; std::vector<Track> tracks;
    std::vector<Playlist> charts;
};

struct AppState {
    std::string source = api::kSaavn;         // "jiosaavn" | "ytmusic"
    std::vector<View> history;
    int histPos = -1;
    View view;
    /* page data */
    bool loading = false;
    uint32_t loadGen = 0;
    std::vector<Section> sections;            // home/search all
    api::SearchOut search;
    Album album;
    Playlist playlist;
    Artist artist;
    std::vector<Track> listTracks;            // liked/charts/local/detail unified track list
    std::string error;
    std::vector<Section> homeCache;
    bool homeLoaded = false;
    std::vector<Playlist> chartsCache;
    D2D1_COLOR_F detailTint{0.07f, 0.07f, 0.07f, 1};
    std::string detailTintFor;
    /* scroll/hover */
    float scrollY = 0, scrollTarget = 0;
    int hoverZone = -1;
    POINT mouse{0, 0};
    bool mouseIn = false;
    /* playback */
    Track current;
    bool hasCurrent = false;
    std::vector<Track> queue;
    int queueIndex = -1;
    std::deque<Track> upNext;                 // "Play Next" manual
    bool paused = true;
    bool playing = false;                     // stream actually producing
    double displayPos = 0, displayDuration = 0;
    bool buffering = false;
    struct SeekUI { bool dragging = false; float frac = 0; } seek;
    struct VolUI { bool dragging = false; } vol;
    int eqTick = 0;
    /* lyrics */
    api::LyricsOut lyrics;
    bool lyricsLoaded = false, lyricsLoading = false;
    std::string lyricsForId;
    float lyricsScroll = 0, lyricsTarget = 0;
    bool lyricsUserScroll = false;
    /* right panel */
    bool rpOpen = false;
    bool rpLyrics = false;
    /* menu */
    bool menuOpen = false;
    struct MenuItem { std::string label; int action; bool danger = false; bool separator = false; bool checked = false; };
    std::vector<MenuItem> menuItems;
    DRect menuRect{};
    Track menuTrack;
    std::string menuTargetId;
    int menuForZone = 0;
    /* toast + dialogs */
    std::string toast;
    ULONGLONG toastUntil = 0;
    int dialogKind = 0;                       // 1=new/rename playlist, 2=confirm delete, 3=add to playlist
    std::string dialogTitle, dialogId, dialogInitial;
    /* misc */
    bool sidebarDrag = false;
    float sidebarW = 280;
    std::string pendingStreamId;   // stream resolve kis track ke liye
    /* search suggestions dropdown */
    std::vector<std::string> suggestions;
    std::string suggestFor;
    bool suggestOpen = false;
    int suggestGen = 0;
};

static AppState g;

/* forward */
static void DoPaint();
static void Navigate(const View& v, bool pushHistory = true);
static void PlayTrack(const Track& t, std::vector<Track> ctx, int index);
static void StartStream(const Track& t);
static void Toast(const std::string& s);
static void OpenMenu(std::vector<AppState::MenuItem> items, float x, float y, const Track& forTrack, int forZone, const std::string& targetId = "");

/* paint parts aage defined hain */
static void PaintTitleBar(const DRect& area);
static void PaintSidebar(const DRect& area);
static void PaintSourceChips(float x, float y);
static void PaintHomePage(const DRect& area);
static void PaintSearchPage(const DRect& area);
static void PaintDetailPage(const DRect& area);
static void PaintArtistPage(const DRect& area);
static void PaintChartsPage(const DRect& area);
static void PaintSettingsPage(const DRect& area);
static void PaintLyricsPanel(const DRect& area);
static int ActiveLyricLine(int64_t posMs);
static DRect g_searchRect{0, 0, 0, 0};
static float g_contentH = 0;

static D2D1_COLOR_F Darken(const D2D1_COLOR_F& c, float f) { return {c.r * f, c.g * f, c.b * f, c.a}; }

/* dominant-ish average color — async decode (study §5.2 hero rule) */
struct TintMsg { std::string url; std::vector<uint8_t> bytes; };
static void FetchTint(const std::string& url) {
    if (url.empty() || url == g.detailTintFor) return;
    g.detailTintFor = url;
    RunAsync([url]() {
        auto* msg = new TintMsg{url, {}};
        if (!net::GetBytes(url, msg->bytes) || msg->bytes.empty()) { delete msg; return; }
        PostMessageW(g_mainWnd, WM_APP + 70, (WPARAM)msg, 0);
    }, [] {});
}

/* layout constants (study §2) */
static const float kPad = 8;               /* grid gap */
static const float kPlayerH = 72;
static const float kRPW = 320;
static float LayoutSidebarW() { return g.sidebarW; }
static float LayoutRPW() { return g.rpOpen ? kRPW : 0; }

/* zones hum paint ke waqt banate hain; click inhi par resolve hota hai */
static std::vector<ClickZone> g_zones;
static int ZoneAt(float x, float y) {
    for (int i = (int)g_zones.size() - 1; i >= 0; i--)
        if (PtIn(g_zones[(size_t)i].rect, x, y)) return g_zones[(size_t)i].id;
    return Z_NONE;
}
static DRect ZoneRect(int id) {
    for (auto& z : g_zones) if (z.id == id) return z.rect;
    return {0, 0, 0, 0};
}
static void AddZone(const DRect& r, int id, float radius = 0) {
    if (W(r) <= 0 || H(r) <= 0) return;
    g_zones.push_back({r, id, radius});
}

/* har frame paint ke dauran banti exact click maps (zone index -> asal data) */
struct RowHit { Track track; std::vector<Track> ctx; };
static std::vector<RowHit> g_rowHits;      // zone = Z_ROW + index
static std::vector<MediaItem> g_cardHits;  // zone = 300 + index
static DRect g_zoneBand{0, 0, 0, 0};       // clip band — sirf is ke andar zones bante hain

/* ── helpers ── */
static void PaintCardText(const DRect& card, const MediaItem& item, bool circle) {
    float x = card.left + 12;
    float artSide = W(card) - 24;
    DRect art = R(card.left + 12, card.top + 12, card.left + 12 + artSide, card.top + 12 + artSide);
    ID2D1Bitmap* bmp = g_ui.GetImage(item.Artwork());
    if (bmp) {
        if (circle) { DRect clip = art; g_ui.DrawBitmap(bmp, art, &clip); }
        else g_ui.DrawBitmap(bmp, art);
    } else {
        g_ui.FillRounded(art, circle ? artSide / 2 : 4, color::elevatedHighlight);
        if (item.kind == MediaItem::Kind::Artist) g_ui.IconArtist(R(art.left + artSide * 0.25f, art.top + artSide * 0.25f, art.right - artSide * 0.25f, art.bottom - artSide * 0.25f), color::textSubdued);
    }
    g_ui.Text(item.Title(), R(x, art.bottom + 10, card.right - 12, art.bottom + 30), 14, TW::SemiBold);
    std::string sub = item.Subtitle();
    if (item.kind == MediaItem::Kind::Album && !item.album.year.empty()) sub = item.album.year + " • " + sub;
    g_ui.Text(sub, R(x, art.bottom + 32, card.right - 12, art.bottom + 50), 12, TW::Regular, color::textSubdued);
}

/* row heights by density (study §3) */
static const float kRowH = 48;
static std::string RowNum(int idx) { return std::to_string(idx + 1); }

static void PaintTrackRow(const DRect& row, const Track& t, int idx, bool showAlbum,
                          const std::vector<Track>* ctx = nullptr) {
    bool playing = g.hasCurrent && g.current.id == t.id;
    bool hovered = g.hoverZone == Z_ROW + idx;
    if (hovered) g_ui.FillRounded(row, 4, color::Alpha(color::white, 0.06f));
    if (playing) g_ui.FillRounded(row, 4, color::Alpha(color::white, 0.04f));
    /* # */
    if (playing && !g.paused) g_ui.IconEq(R(row.left + 8, row.top + 16, row.left + 28, row.top + 32), color::green, (float)g.eqTick / 6.0f);
    else g_ui.Text(RowNum(idx), R(row.left + 4, row.top + 13, row.left + 34, row.top + 35), 13, TW::Regular, playing ? color::green : color::textSubdued, true);
    /* cover 40 */
    DRect cov = R(row.left + 44, row.top + 4, row.left + 84, row.top + 44);
    ID2D1Bitmap* bmp = g_ui.GetImage(t.artwork);
    if (bmp) g_ui.DrawBitmap(bmp, cov);
    else g_ui.FillRounded(cov, 4, color::elevatedHighlight);
    /* hover overlay play */
    if (hovered) {
        g_ui.FillRect(cov, color::Alpha(color::black, 0.45f));
        g_ui.IconPlay(R(cov.left + 12, row.top + 16, cov.left + 28, row.top + 32), color::white);
    }
    float tx = row.left + 96;
    D2D1_COLOR_F tc = playing ? color::green : color::textBase;
    g_ui.Text(t.title, R(tx, row.top + 5, row.right - 220, row.top + 25), 14, TW::Regular, tc);
    float ax = tx;
    if (t.explicit_) { g_ui.IconExplicit(R(ax, row.top + 27, ax + 16, row.top + 43), color::textSubdued); ax += 21; }
    g_ui.Text(t.ArtistText(), R(ax, row.top + 27, row.right - 220, row.top + 45), 12, TW::Regular, color::textSubdued);
    if (showAlbum) {
        float mid = row.left + W(row) * 0.52f;
        g_ui.Text(t.albumTitle, R(mid, row.top + 14, row.right - 130, row.top + 36), 13, TW::Regular, color::textSubdued);
    }
    bool liked = Lib().IsLiked(t.id);
    if (liked || hovered) {
        DRect h = R(row.right - 96, row.top + 13, row.right - 70, row.top + 35);
        g_ui.IconHeart(h, liked ? color::green : color::textSubdued, liked);
    }
    g_ui.Text(FmtTime(t.durationMs), R(row.right - 62, row.top + 14, row.right - 34, row.top + 36), 13, TW::Regular, color::textSubdued, false, DWRITE_TEXT_ALIGNMENT_TRAILING);
    if (hovered) g_ui.IconMore(R(row.right - 30, row.top + 13, row.right - 6, row.top + 35), color::textSubdued);
    if (row.bottom > g_zoneBand.top && row.top < g_zoneBand.bottom) {
        int slot = (int)g_rowHits.size();
        g_rowHits.push_back({t, ctx ? *ctx : std::vector<Track>{t}});
        AddZone(row, Z_ROW + slot, 4);
    }
}

/* ── playback helpers ── */
static void SaveLastAndRecent() {
    std::string id = g.current.id;
    Lib().lastTrackJson = TrackToJ(g.current).dump();
    Lib().TouchRecent(g.current);  /* Save() likhta hai */
    Lib().Save();
}

static void StreamResolvedPlay(const Track& t, const std::string& url) {
    g.current = t;
    g.hasCurrent = true;
    g.buffering = false;
    g.playing = false;
    g.paused = false;
    g.displayDuration = t.durationMs > 0 ? t.durationMs / 1000.0 : 0;
    SaveLastAndRecent();
    g.lyricsLoaded = false;
    g.lyricsForId = t.id;
    g.lyrics = {};
    g_player.Play(url);
    g_ui.Redraw();
}

struct StreamResult {
    std::string forId;
    std::string url;
};
static void StartStream(const Track& t) {
    g.buffering = true;
    g.paused = false;
    g.pendingStreamId = t.id;
    LogLine("stream resolve: " + t.id);
    RunAsync([t]() {
        auto* res = new StreamResult{t.id, ""};
        std::vector<StreamInfo> streams;
        std::string err;
        if (api::Streams(t.id, streams, err) && !streams.empty()) res->url = streams[0].url;
        else LogLine("stream fail: " + err);
        PostMessageW(g_mainWnd, WM_APP + 71, (WPARAM)res, 0);
    }, [] {});
}

static void PlayTrack(const Track& t, std::vector<Track> ctx, int index) {
    /* queue mode (study: tracklist click → usi list ka context) */
    if (!ctx.empty() && index >= 0 && index < (int)ctx.size()) {
        g.queue = ctx;
        g.queueIndex = index;
    } else if (g.queue.empty()) {
        g.queue = {t};
        g.queueIndex = 0;
    }
    if (g.hasCurrent && g.current.id == t.id) {
        /* same track: play/pause toggle */
        bool np = !g.paused;
        g_player.SetPaused(np);
        g.paused = np;
        g_ui.Redraw();
        return;
    }
    StartStream(t);
    g.current = t;  /* optimistic title/cover */
    g.hasCurrent = true;
}

static void PlayNextTrack(bool autoAdvance) {
    (void)autoAdvance;
    if (!g.upNext.empty()) {
        Track t = g.upNext.front();
        g.upNext.pop_front();
        StartStream(t);
        g.current = t; g.hasCurrent = true;
        return;
    }
    if (g.queue.empty()) return;
    int n = (int)g.queue.size();
    if (g.queueIndex + 1 < n) {
        g.queueIndex++;
        const Track& t = g.queue[g.queueIndex];
        PlayTrack(t, g.queue, g.queueIndex);
    } else if (Lib().repeatAll) {
        g.queueIndex = 0;
        const Track& t = g.queue[0];
        PlayTrack(t, g.queue, 0);
    } else if (autoAdvance) {
        /* radio continuation */
        if (g.hasCurrent) {
            Track cur = g.current;
            RunAsync([cur]() {
                std::vector<Track> more;
                std::string err;
                if (api::Radio(cur.id, 1, more, err) && more.size() > 1) {
                    auto* res = new std::vector<Track>(more);
                    PostMessageW(g_mainWnd, WM_APP + 72, (WPARAM)res, 0);
                }
            }, [] {});
        }
    }
}

static void PlayPrevTrack() {
    if (g_player.Position() > 3.0) { g_player.Seek(0); return; }
    if (g.queueIndex > 0) {
        g.queueIndex--;
        PlayTrack(g.queue[g.queueIndex], g.queue, g.queueIndex);
    } else g_player.Seek(0);
}

static void ToggleShuffle() {
    auto& L = Lib();
    L.shuffle = !L.shuffle;
    L.Save();
    if (L.shuffle && g.queue.size() > 1 && g.queueIndex >= 0) {
        Track cur = g.queue[g.queueIndex];
        std::vector<Track> rest;
        for (size_t i = 0; i < g.queue.size(); i++) if ((int)i != g.queueIndex) rest.push_back(g.queue[i]);
        std::shuffle(rest.begin(), rest.end(), std::mt19937((unsigned)time(nullptr)));
        g.queue = {cur};
        g.queue.insert(g.queue.end(), rest.begin(), rest.end());
        g.queueIndex = 0;
    }
    g_ui.Redraw();
}

static void CycleRepeat() {
    auto& L = Lib();
    if (!L.repeatAll && !L.repeatOne) { L.repeatAll = true; }
    else if (L.repeatAll) { L.repeatAll = false; L.repeatOne = true; }
    else { L.repeatOne = false; }
    L.Save();
    g_ui.Redraw();
}

static void Toast(const std::string& s) {
    g.toast = s;
    g.toastUntil = GetTickCount64() + 2600;
    g_ui.Redraw();
}

/* ── data loading ── */
static void LoadView() {
    g.loading = true;
    g.error.clear();
    g.scrollY = 0; g.scrollTarget = 0;
    uint32_t gen = ++g.loadGen;
    View v = g.view;
    std::string src = g.source;
    /* local pages: library memory se sync load (worker thread race khatam) */
    if (v.kind == PageKind::Liked) {
        g.listTracks = Lib().liked; g.loading = false; g_ui.Redraw();
        return;
    }
    if (v.kind == PageKind::LocalPlaylist) {
        const auto* p = Lib().FindPlaylist(v.id);
        if (p) g.listTracks = p->tracks;
        else g.error = "playlist nahi mili";
        g.loading = false; g_ui.Redraw();
        return;
    }
    if (v.kind == PageKind::Home && g.homeLoaded) { g.loading = false; g.sections = g.homeCache; return; }
    if (v.kind == PageKind::Search && v.query.empty()) {
        g.loading = false; g.sections.clear(); g.search = {}; g_ui.Redraw();
        return;
    }
    RunAsync([v, src, gen]() {
        auto* r = new LoadedResult();
        switch (v.kind) {
            case PageKind::Home:
                r->ok = api::Home(src, r->sections, r->err); break;
            case PageKind::Search: {
                r->ok = api::Search(src, v.query, v.filter, 1, r->search, r->err);
                if (r->ok && v.filter == "all") {
                    r->sections.push_back({"Songs", {}});
                    for (auto& t : r->search.tracks) r->sections.back().items.push_back({MediaItem::Kind::Track, t});
                    if (!r->search.albums.empty()) { r->sections.push_back({"Albums", {}}); for (auto& a : r->search.albums) r->sections.back().items.push_back({MediaItem::Kind::Album, {}, a}); }
                    if (!r->search.playlists.empty()) { r->sections.push_back({"Playlists", {}}); for (auto& p : r->search.playlists) r->sections.back().items.push_back({MediaItem::Kind::Playlist, {}, {}, p}); }
                    if (!r->search.artists.empty()) { r->sections.push_back({"Artists", {}}); for (auto& a : r->search.artists) r->sections.back().items.push_back({MediaItem::Kind::Artist, {}, {}, {}, a}); }
                } else if (r->ok) {
                    if (v.filter == "track") { r->sections.push_back({"Songs", {}}); for (auto& t : r->search.tracks) r->sections.back().items.push_back({MediaItem::Kind::Track, t}); }
                    if (v.filter == "album") { r->sections.push_back({"Albums", {}}); for (auto& a : r->search.albums) r->sections.back().items.push_back({MediaItem::Kind::Album, {}, a}); }
                    if (v.filter == "playlist") { r->sections.push_back({"Playlists", {}}); for (auto& p : r->search.playlists) r->sections.back().items.push_back({MediaItem::Kind::Playlist, {}, {}, p}); }
                    if (v.filter == "artist") { r->sections.push_back({"Artists", {}}); for (auto& a : r->search.artists) r->sections.back().items.push_back({MediaItem::Kind::Artist, {}, {}, {}, a}); }
                }
                break;
            }
            case PageKind::List:
                if (v.isAlbum) {
                    r->ok = api::AlbumDetails(v.id, r->album, r->err);
                    if (r->ok) r->tracks = r->album.tracks;
                } else {
                    r->ok = api::PlaylistDetails(v.id, r->playlist, r->err);
                    if (r->ok) r->tracks = r->playlist.tracks;
                }
                break;
            case PageKind::Artist:
                r->ok = api::ArtistDetails(v.id, r->artist, r->err); break;
            case PageKind::Charts:
                r->ok = api::Charts(src, r->charts, r->err); break;
            case PageKind::Liked:
                r->tracks = Lib().liked; r->ok = true; break;
            case PageKind::LocalPlaylist: {
                const auto* p = Lib().FindPlaylist(v.id);
                if (p) { r->tracks = p->tracks; r->ok = true; }
                else { r->err = "playlist nahi mili"; }
                break;
            }
            default: r->ok = true; break;
        }
        PostMessageW(g_mainWnd, WM_APP + 73, (WPARAM)r, (LPARAM)gen);
    }, [] {});
    g_ui.Redraw();
}

static void ApplyLoaded(void* rp, uint32_t gen) {
    std::unique_ptr<LoadedResult> r((LoadedResult*)rp);
    if (gen != g.loadGen) return;
    g.loading = false;
    if (!r->ok) { g.error = r->err.empty() ? "Kuch load nahi ho saka. Internet check karo." : r->err; g_ui.Redraw(); return; }
    switch (g.view.kind) {
        case PageKind::Home:
            g.sections = r->sections; g.homeCache = r->sections; g.homeLoaded = true; break;
        case PageKind::Search:
            g.search = r->search; g.sections = r->sections; break;
        case PageKind::List:
            g.album = r->album; g.playlist = r->playlist; g.listTracks = r->tracks;
            if (g.view.isAlbum) FetchTint(r->album.artwork);
            else FetchTint(r->playlist.artwork);
            break;
        case PageKind::Artist:
            g.artist = r->artist; FetchTint(r->artist.artwork); break;
        case PageKind::Liked: case PageKind::LocalPlaylist:
            g.listTracks = r->tracks; break;
        case PageKind::Charts:
            g.chartsCache = r->charts; break;
        default: break;
    }
    g_ui.Redraw();
}

static void Navigate(const View& v, bool pushHistory) {
    KillTimer(g_hwnd, 8); /* edit debounce timer band */
    g.view = v;
    g.menuOpen = false;
    if (pushHistory) {
        /* forward stack kaato */
        if (g.histPos < (int)g.history.size() - 1) g.history.resize(g.histPos + 1);
        g.history.push_back(v);
        g.histPos = (int)g.history.size() - 1;
    }
    LoadView();
    g_ui.Redraw();
}

static void NavBack() {
    if (g.histPos > 0) {
        g.histPos--;
        g.view = g.history[g.histPos];
        LoadView();
        g_ui.Redraw();
    }
}
static void NavForward() {
    if (g.histPos < (int)g.history.size() - 1) {
        g.histPos++;
        g.view = g.history[g.histPos];
        LoadView();
        g_ui.Redraw();
    }
}

static View ViewForItem(const MediaItem& item) {
    View v;
    switch (item.kind) {
        case MediaItem::Kind::Album: v.kind = PageKind::List; v.id = item.album.id; v.title = item.album.title; v.isAlbum = true; break;
        case MediaItem::Kind::Playlist: v.kind = PageKind::List; v.id = item.playlist.id; v.title = item.playlist.title; break;
        case MediaItem::Kind::Artist: v.kind = PageKind::Artist; v.id = item.artist.id; v.title = item.artist.name; break;
        case MediaItem::Kind::Track: v.kind = g.view.kind; break;
    }
    return v;
}

/* lyrics loader */
static void LoadLyricsIfNeeded() {
    if (!g.hasCurrent || g.lyricsLoading) return;
    if (g.lyricsLoaded && g.lyricsForId == g.current.id) return;
    g.lyricsLoading = true;
    Track t = g.current;
    RunAsync([t]() {
        auto* out = new api::LyricsOut();
        std::string err;
        api::LyricsForTrack(t, *out, err);
        PostMessageW(g_mainWnd, WM_APP + 74, (WPARAM)out, 0);
    }, [] {});
}


/* ════════════════ PAINT: right panel / player / fullscreen ════════════════ */
static void PaintRightPanel(const DRect& area) {
    g_ui.FillRounded(R(area.left, area.top, area.right - kPad, area.bottom), 8, color::elevatedBase);
    float x = area.left + 16;
    float w = W(area) - 32;
    /* tabs */
    DRect tq = R(x, area.top + 12, x + 74, area.top + 40);
    DRect tl = R(x + 80, area.top + 12, x + 154, area.top + 40);
    g_ui.FillRounded(tq, 14, !g.rpLyrics ? color::subdued : color::Alpha(color::white, 0.05f));
    g_ui.FillRounded(tl, 14, g.rpLyrics ? color::subdued : color::Alpha(color::white, 0.05f));
    g_ui.Text("Queue", tq, 12, TW::SemiBold, color::textBase, true, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
    g_ui.Text("Lyrics", tl, 12, TW::SemiBold, color::textBase, true, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
    AddZone(tq, Z_RP_TABQ, 14); AddZone(tl, Z_RP_TABL, 14);
    DRect close = R(area.right - 44, area.top + 12, area.right - 16, area.top + 40);
    g_ui.IconClose(R(close.left + 5, close.top + 5, close.right - 5, close.bottom - 5), color::textSubdued);
    AddZone(close, Z_RP_CLOSE, 14);
    DRect body = R(area.left, area.top + 52, area.right, area.bottom);
    if (g.rpLyrics) { PaintLyricsPanel(body); return; }
    /* queue list */
    float y = body.top + 4;
    auto sectionLabel = [&](const char* s) {
        g_ui.Text(s, R(x, y, x + w, y + 20), 13, TW::Bold, color::textSubdued);
        y += 26;
    };
    if (g.hasCurrent) {
        sectionLabel("Now playing");
        DRect row = R(x - 4, y, x + w + 4, y + 48);
        g_ui.FillRounded(row, 4, color::Alpha(color::white, 0.05f));
        DRect cov = R(x, y + 4, x + 40, y + 44);
        ID2D1Bitmap* bmp = g_ui.GetImage(g.current.artwork);
        if (bmp) g_ui.DrawBitmap(bmp, cov); else g_ui.FillRounded(cov, 4, color::elevatedHighlight);
        g_ui.Text(g.current.title, R(x + 50, y + 5, x + w, y + 24), 13, TW::Regular, color::green);
        g_ui.Text(g.current.ArtistText(), R(x + 50, y + 25, x + w, y + 42), 11, TW::Regular, color::textSubdued);
        g_ui.IconEq(R(x + w - 26, y + 16, x + w - 6, y + 32), color::green, (float)g.eqTick / 6.0f);
        AddZone(row, Z_RP_ROW - 1, 4);
        y += 56;
    }
    if (!g.upNext.empty()) {
        sectionLabel("Next in queue");
        int i = 0;
        for (auto& t : g.upNext) {
            DRect row = R(x - 4, y, x + w + 4, y + 48);
            if (g.hoverZone == Z_RP_ROW + 100 + i) g_ui.FillRounded(row, 4, color::Alpha(color::white, 0.06f));
            DRect cov = R(x, y + 4, x + 40, y + 44);
            ID2D1Bitmap* bmp = g_ui.GetImage(t.artwork);
            if (bmp) g_ui.DrawBitmap(bmp, cov); else g_ui.FillRounded(cov, 4, color::elevatedHighlight);
            g_ui.Text(t.title, R(x + 50, y + 5, x + w - 40, y + 24), 13, TW::Regular);
            g_ui.Text(t.ArtistText(), R(x + 50, y + 25, x + w - 40, y + 42), 11, TW::Regular, color::textSubdued);
            DRect x1 = R(x + w - 34, y + 13, x + w - 12, y + 35);
            if (g.hoverZone == Z_RP_REMOVE + i) g_ui.FillRounded(x1, 11, color::Alpha(color::white, 0.12f));
            g_ui.IconClose(R(x1.left + 5, x1.top + 5, x1.right - 5, x1.bottom - 5), color::textSubdued);
            AddZone(row, Z_RP_ROW + 100 + i, 4);
            AddZone(x1, Z_RP_REMOVE + i, 11);
            y += 52; i++;
            if (y > body.bottom - 60) return;
        }
        y += 8;
    }
    sectionLabel("Next up");
    if (g.queue.empty()) { g_ui.Text("Queue khaali hai.", R(x, y, x + w, y + 24), 12, TW::Regular, color::textSubdued); return; }
    int shown = 0;
    for (size_t i = (size_t)std::max(0, g.queueIndex + 1); i < g.queue.size(); i++) {
        const Track& t = g.queue[i];
        DRect row = R(x - 4, y, x + w + 4, y + 48);
        if (g.hoverZone == Z_RP_ROW + (int)i) g_ui.FillRounded(row, 4, color::Alpha(color::white, 0.06f));
        DRect cov = R(x, y + 4, x + 40, y + 44);
        ID2D1Bitmap* bmp = g_ui.GetImage(t.artwork);
        if (bmp) g_ui.DrawBitmap(bmp, cov); else g_ui.FillRounded(cov, 4, color::elevatedHighlight);
        g_ui.Text(t.title, R(x + 50, y + 5, x + w, y + 24), 13, TW::Regular);
        g_ui.Text(t.ArtistText(), R(x + 50, y + 25, x + w, y + 42), 11, TW::Regular, color::textSubdued);
        AddZone(row, Z_RP_ROW + (int)i, 4);
        y += 52; shown++;
        if (y > body.bottom - 60) break;
    }
    if (shown == 0) g_ui.Text("Aage kuch nahi — radio khud chale ga.", R(x, y, x + w, y + 24), 12, TW::Regular, color::textSubdued);
}

static void PaintSlider(const DRect& track, float frac, bool hoverOrDrag, int zone) {
    float h = 4;
    float midY = (track.top + track.bottom) / 2;
    DRect full = R(track.left, midY - h / 2, track.right, midY + h / 2);
    g_ui.FillRounded(full, 2, color::sliderTrack);
    float fx = track.left + W(track) * std::max(0.0f, std::min(1.0f, frac));
    if (fx > track.left) g_ui.FillRounded(R(track.left, midY - h / 2, fx, midY + h / 2), 2, hoverOrDrag ? color::green : color::white);
    if (hoverOrDrag) g_ui.FillRounded(R(fx - 6, midY - 6, fx + 6, midY + 6), 6, color::white);
}

static void PaintPlayerBar(const DRect& area) {
    g_ui.FillRect(area, color::black);
    float y = area.top;
    /* left */
    float lx = area.left + 12;
    if (g.hasCurrent) {
        DRect cov = R(lx, y + 8, lx + 56, y + 64);
        ID2D1Bitmap* bmp = g_ui.GetImage(g.current.artwork);
        if (bmp) g_ui.DrawBitmap(bmp, cov);
        else g_ui.FillRounded(cov, 4, color::elevatedHighlight);
        AddZone(cov, Z_NP_COVER, 4);
        g_ui.Text(g.current.title, R(lx + 68, y + 14, lx + 300, y + 34), 14, TW::Regular);
        g_ui.Text(g.current.ArtistText(), R(lx + 68, y + 36, lx + 300, y + 54), 11, TW::Regular, color::textSubdued);
        DRect heart = R(lx + 312, y + 22, lx + 340, y + 50);
        bool liked = Lib().IsLiked(g.current.id);
        g_ui.IconHeart(heart, (liked || g.hoverZone == Z_NP_HEART) ? (liked ? color::green : color::textBase) : color::textSubdued, liked);
        AddZone(heart, Z_NP_HEART, 14);
    }
    /* center */
    float cw = std::min(560.0f, W(area) * 0.4f);
    float cx = (area.left + area.right) / 2 - cw / 2;
    /* transport */
    float ty = y + 6;
    auto& L = Lib();
    DRect shuf = R(cx + cw / 2 - 108, ty + 6, cx + cw / 2 - 80, ty + 34);
    g_ui.IconShuffle(R(shuf.left + 3, shuf.top + 3, shuf.right - 3, shuf.bottom - 3), (g.hoverZone == Z_TRANSPORT_SHUFFLE || L.shuffle) ? color::textBase : color::textSubdued, L.shuffle);
    if (L.shuffle) g_ui.FillRounded(R(cx + cw / 2 - 97, ty + 34, cx + cw / 2 - 91, ty + 38), 2, color::green);
    AddZone(shuf, Z_TRANSPORT_SHUFFLE, 14);
    DRect prev = R(cx + cw / 2 - 72, ty + 4, cx + cw / 2 - 40, ty + 36);
    g_ui.IconPrev(R(prev.left + 5, prev.top + 5, prev.right - 5, prev.bottom - 5), g.hoverZone == Z_TRANSPORT_PREV ? color::textBase : color::textSubdued);
    AddZone(prev, Z_TRANSPORT_PREV, 16);
    DRect play = R(cx + cw / 2 - 28, ty, cx + cw / 2 + 28, ty + 40);
    float pr = (g.hoverZone == Z_TRANSPORT_PLAY) ? 21.0f : 20.0f;
    g_ui.FillRounded(R(cx + cw / 2 - pr, ty + 20 - pr, cx + cw / 2 + pr, ty + 20 + pr), pr, color::white);
    if (g.paused || !g.playing) g_ui.IconPlay(R(cx + cw / 2 - 11, ty + 9, cx + cw / 2 + 11, ty + 31), color::black);
    else g_ui.IconPause(R(cx + cw / 2 - 11, ty + 9, cx + cw / 2 + 11, ty + 31), color::black);
    AddZone(play, Z_TRANSPORT_PLAY, 20);
    DRect next = R(cx + cw / 2 + 40, ty + 4, cx + cw / 2 + 72, ty + 36);
    g_ui.IconNext(R(next.left + 5, next.top + 5, next.right - 5, next.bottom - 5), g.hoverZone == Z_TRANSPORT_NEXT ? color::textBase : color::textSubdued);
    AddZone(next, Z_TRANSPORT_NEXT, 16);
    DRect rep = R(cx + cw / 2 + 80, ty + 6, cx + cw / 2 + 108, ty + 34);
    int repMode = L.repeatOne ? 1 : 0;
    bool repOn = L.repeatAll || L.repeatOne;
    g_ui.IconRepeat(R(rep.left + 3, rep.top + 3, rep.right - 3, rep.bottom - 3), (g.hoverZone == Z_TRANSPORT_REPEAT || repOn) ? color::textBase : color::textSubdued, repMode, repOn);
    if (repOn) g_ui.FillRounded(R(cx + cw / 2 + 91, ty + 34, cx + cw / 2 + 97, ty + 38), 2, color::green);
    AddZone(rep, Z_TRANSPORT_REPEAT, 14);
    /* seek */
    float sy = y + 46;
    double frac = g.displayDuration > 0 ? g.displayPos / g.displayDuration : 0;
    if (g.seek.dragging) frac = g.seek.frac;
    g_ui.Text(FmtTime((int64_t)(g.displayPos * 1000)), R(cx - 44, sy - 6, cx - 6, sy + 14), 11, TW::Regular, color::textSubdued, false, DWRITE_TEXT_ALIGNMENT_TRAILING);
    g_ui.Text(FmtTime((int64_t)(g.displayDuration * 1000)), R(cx + cw + 6, sy - 6, cx + cw + 44, sy + 14), 11, TW::Regular, color::textSubdued);
    PaintSlider(R(cx, sy, cx + cw, sy + 12), (float)frac, g.seek.dragging || g.hoverZone == Z_SEEKBAR, Z_SEEKBAR);
    AddZone(R(cx - 4, sy - 6, cx + cw + 4, sy + 18), Z_SEEKBAR, 6);
    AddZone(R(cx - 44, sy - 6, cx, sy + 18), Z_SEEKBAR, 0);
    /* buffering hint */
    if (g.buffering) {
        g_ui.Text("Buffering...", R(cx + cw / 2 - 50, sy - 22, cx + cw / 2 + 50, sy - 4), 10, TW::Regular, color::textSubdued, true);
    }
    /* right */
    float rx = area.right - 16;
    DRect fs = R(rx - 28, y + 22, rx, y + 50);
    g_ui.IconFullscreen(R(fs.left + 5, fs.top + 5, fs.right - 5, fs.bottom - 5), g.hoverZone == Z_NP_FULL ? color::textBase : color::textSubdued);
    AddZone(fs, Z_NP_FULL, 14);
    rx -= 34;
    /* volume slider 96 */
    DRect vol = R(rx - 96, y + 26, rx, y + 46);
    PaintSlider(vol, Lib().volume, g.vol.dragging || g.hoverZone == Z_VOLBAR, Z_VOLBAR);
    AddZone(R(vol.left - 2, vol.top - 6, vol.right + 2, vol.bottom + 6), Z_VOLBAR, 6);
    rx -= 102;
    DRect vi = R(rx - 26, y + 22, rx, y + 50);
    g_ui.IconVolume(R(vi.left + 2, vi.top + 4, vi.right - 2, vi.bottom - 4), color::textSubdued, Lib().volume <= 0.001f);
    AddZone(vi, Z_VOLUME_ICON, 13);
    /* queue / lyrics / pip */
    DRect pip = R(rx - 60, y + 22, rx - 34, y + 50);
    g_ui.IconPictureInPicture(pip, g.hoverZone == Z_NP_PIP ? color::textBase : color::textSubdued);
    AddZone(pip, Z_NP_PIP, 13);
    DRect qi = R(rx - 96, y + 22, rx - 70, y + 50);
    g_ui.IconQueue(qi, (g.rpOpen && !g.rpLyrics) || g.hoverZone == Z_NP_QUEUE ? color::green : color::textSubdued, g.rpOpen && !g.rpLyrics);
    AddZone(qi, Z_NP_QUEUE, 13);
    DRect li = R(rx - 132, y + 22, rx - 106, y + 50);
    g_ui.IconLyrics(li, (g.rpOpen && g.rpLyrics) || g.hoverZone == Z_NP_LYRICS ? color::green : color::textSubdued, g.rpOpen && g.rpLyrics);
    AddZone(li, Z_NP_LYRICS, 13);
}

static void PaintLyricsFS(const DRect& area) {
    g_ui.FillRect(area, color::base);
    LoadLyricsIfNeeded();
    float pad = 40;
    float coverSide = std::min(H(area) - 140.0f, 380.0f);
    DRect cover = R(area.left + pad, area.top + 60, area.left + pad + coverSide, area.top + 60 + coverSide);
    if (g.hasCurrent) {
        ID2D1Bitmap* bmp = g_ui.GetImage(g.current.artwork);
        if (bmp) g_ui.DrawBitmap(bmp, cover); else g_ui.FillRounded(cover, 6, color::elevatedHighlight);
        g_ui.Text(g.current.title, R(area.left + pad, cover.bottom + 18, cover.right + 60, cover.bottom + 54), 24, TW::ExtraBold);
        g_ui.Text(g.current.ArtistText(), R(area.left + pad, cover.bottom + 56, cover.right + 60, cover.bottom + 80), 15, TW::Regular, color::textSubdued);
    }
    DRect lyr = R(area.left + pad + coverSide + 60, area.top + 40, area.right - pad, area.bottom - 30);
    if (!g.lyrics.synced) {
        g_ui.Text(g.lyrics.plain.empty() ? "Lyrics nahi mile." : g.lyrics.plain.substr(0, 400),
                  R(lyr.left, lyr.top + 40, lyr.right, lyr.top + 200), 15, TW::Regular, color::textSubdued);
        return;
    }
    int64_t posMs = (int64_t)(g.displayPos * 1000);
    int active = ActiveLyricLine(posMs);
    const float lineH = 36;
    float centerY = (lyr.top + lyr.bottom) / 2;
    if (!g.lyricsUserScroll && active >= 0) g.lyricsTarget = active * lineH;
    float base = centerY - g.lyricsScroll;
    int i = 0;
    for (auto& [ms, text] : g.lyrics.lines) {
        float ly = base + i * lineH;
        if (ly > lyr.top && ly < lyr.bottom) {
            bool on = i == active;
            g_ui.Text(text.empty() ? "..." : text, R(lyr.left, ly, lyr.right, ly + 34),
                      on ? 20.0f : 18.0f, on ? TW::ExtraBold : TW::SemiBold,
                      on ? color::white : color::Alpha(color::textSubdued, 0.75f));
            /* click zone: line seek */
            if (ly > lyr.top + 20) AddZone(R(lyr.left, ly, lyr.right, ly + lineH), 1200 + i, 0);
        }
        i++;
    }
}

/* ════════════════ PAINT: menu/dialog/toast overlays ════════════════ */
static const int Z_DLG_OK = 950, Z_DLG_CANCEL = 951, Z_DLG_ITEM = 960;

static void PaintMenu() {
    if (!g.menuOpen || g.menuItems.empty()) return;
    float wdt = 232;
    float h = 8;
    for (auto& mi : g.menuItems) h += mi.separator ? 9 : 36;
    float x = g.menuRect.left, y = g.menuRect.top;
    /* clamp in window */
    if (x + wdt > g_ui.Wd() - 8) x = g_ui.Wd() - wdt - 8;
    if (y + h > g_ui.Ht() - 8) y = g_ui.Ht() - h - 8;
    g.menuRect = R(x, y, x + wdt, y + h);
    g_ui.FillRounded(g.menuRect, 8, color::elevatedBase);
    g_ui.StrokeRounded(g.menuRect, 8, color::Alpha(color::white, 0.10f));
    float cy = y + 4;
    int i = 0;
    for (auto& mi : g.menuItems) {
        if (mi.separator) { g_ui.FillRect(R(x + 10, cy + 4, x + wdt - 10, cy + 5), color::Alpha(color::white, 0.10f)); cy += 9; i++; continue; }
        DRect row = R(x + 4, cy, x + wdt - 4, cy + 36);
        if (g.hoverZone == Z_MENU_ITEM + i) g_ui.FillRounded(row, 6, color::Alpha(color::white, 0.08f));
        D2D1_COLOR_F col = mi.danger ? color::danger : color::textBase;
        if (mi.checked) g_ui.IconCheck(R(row.left + 8, cy + 10, row.left + 24, cy + 26), color::green);
        g_ui.Text(mi.label, R(row.left + (mi.checked ? 32 : 12), cy + 9, row.right - 8, cy + 27), 13, TW::Regular, col);
        AddZone(row, Z_MENU_ITEM + i, 6);
        cy += 36;
        i++;
    }
}

static void PaintDialog() {
    if (!g.dialogKind) return;
    g_ui.FillRect(R(0, 0, (float)g_ui.Wd(), (float)g_ui.Ht()), color::Alpha(color::black, 0.6f));
    float dw = 420, dh = g.dialogKind == 3 ? 420.0f : 228.0f;
    float x = (g_ui.Wd() - dw) / 2, y = (g_ui.Ht() - dh) / 2;
    DRect panel = R(x, y, x + dw, y + dh);
    g_ui.FillRounded(panel, 12, color::elevatedBase);
    g_ui.Text(g.dialogTitle, R(x + 24, y + 20, x + dw - 24, y + 52), 19, TW::Bold);
    if (g.dialogKind == 3) {
        auto& pls = Lib().playlists;
        if (pls.empty()) {
            g_ui.Text("Pehle ek playlist banao (+ button, sidebar mein).", R(x + 24, y + 70, x + dw - 24, y + 100), 13, TW::Regular, color::textSubdued);
        }
        float cy = y + 66;
        int i = 0;
        for (auto& p : pls) {
            DRect row = R(x + 12, cy, x + dw - 12, cy + 46);
            if (g.hoverZone == Z_DLG_ITEM + i) g_ui.FillRounded(row, 6, color::Alpha(color::white, 0.07f));
            g_ui.IconQueue(R(row.left + 8, cy + 11, row.left + 34, cy + 35), color::textSubdued, false);
            g_ui.Text(p.name, R(row.left + 46, cy + 8, row.right - 10, cy + 28), 14, TW::Regular);
            g_ui.Text(std::to_string(p.tracks.size()) + " songs", R(row.left + 46, cy + 27, row.right - 10, cy + 42), 11, TW::Regular, color::textSubdued);
            AddZone(row, Z_DLG_ITEM + i, 6);
            cy += 48; i++;
            if (cy > y + dh - 70) break;
        }
        DRect cancel = R(x + dw - 116, y + dh - 56, x + dw - 20, y + dh - 18);
        g_ui.FillRounded(cancel, 19, color::elevatedHighlight);
        g_ui.Text("Band karo", cancel, 13, TW::SemiBold, color::textBase, true, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
        AddZone(cancel, Z_DLG_CANCEL, 19);
        return;
    }
    /* text field jagah EDIT control ko dialog paint ke baad rakha jata hai */
    DRect cancel = R(x + dw - 226, y + dh - 62, x + dw - 126, y + dh - 22);
    DRect ok = R(x + dw - 116, y + dh - 62, x + dw - 20, y + dh - 22);
    g_ui.FillRounded(cancel, 20, color::elevatedHighlight);
    g_ui.Text("Cancel", cancel, 13, TW::SemiBold, color::textBase, true, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
    AddZone(cancel, Z_DLG_CANCEL, 20);
    g_ui.FillRounded(ok, 20, g.dialogKind == 2 ? color::Hex(0xe81123) : color::green);
    g_ui.Text(g.dialogKind == 2 ? "Delete" : "Save", ok, 13, TW::SemiBold, g.dialogKind == 2 ? color::white : color::black, true, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
    AddZone(ok, Z_DLG_OK, 20);
    if (g.dialogKind == 2) {
        g_ui.Text("Yeh playlist hamesha ke liye delete ho jayegi.", R(x + 24, y + 66, x + dw - 24, y + 94), 13, TW::Regular, color::textSubdued);
    }
}

static void PaintSuggestions() {
    if (!g.suggestOpen || g.suggestions.empty() || g.dialogKind || g.view.kind == PageKind::LyricsFS) return;
    float x = g_searchRect.left, w = W(g_searchRect);
    float y = 48;
    float h = (float)g.suggestions.size() * 36 + 8;
    DRect panel = R(x, y, x + w, y + h);
    g_ui.FillRounded(panel, 8, color::elevatedBase);
    g_ui.StrokeRounded(panel, 8, color::Alpha(color::white, 0.10f));
    float cy = y + 4;
    int i = 0;
    for (auto& s : g.suggestions) {
        DRect row = R(x + 4, cy, x + w - 4, cy + 36);
        if (g.hoverZone == Z_SUGGEST + i) g_ui.FillRounded(row, 6, color::Alpha(color::white, 0.08f));
        g_ui.IconSearch(R(row.left + 10, cy + 9, row.left + 28, cy + 27), color::textSubdued);
        g_ui.Text(s, R(row.left + 38, cy + 9, row.right - 8, cy + 27), 13, TW::Regular);
        AddZone(row, Z_SUGGEST + i, 6);
        cy += 36;
        i++;
    }
}

static void PaintToast() {
    if (g.toast.empty() || GetTickCount64() > g.toastUntil) return;
    float w = g_ui.TextWidth(g.toast, 13, TW::SemiBold) + 36;
    float x = (g_ui.Wd() - w) / 2;
    float y = g_ui.Ht() - kPlayerH - 58;
    g_ui.FillRounded(R(x, y, x + w, y + 38), 8, color::elevatedHighlight);
    g_ui.Text(g.toast, R(x, y + 9, x + w, y + 30), 13, TW::SemiBold, color::textBase, true);
}

static void DoPaint() {
    g_zones.clear();
    g_rowHits.clear();
    g_cardHits.clear();
    g_ui.Begin();
    int Wd = g_ui.Wd(), Ht = g_ui.Ht();
    g_ui.FillRect(R(0, 0, (float)Wd, (float)Ht), color::base);
    float sbW = LayoutSidebarW();
    float rpW = LayoutRPW();
    DRect titleR = R(0, 0, (float)Wd, 48);
    DRect sideR = R(0, 48, sbW + kPad, (float)Ht - kPlayerH);
    DRect mainR = R(sbW + kPad + kPad, 48, (float)Wd - rpW - (rpW ? 0 : kPad) , (float)Ht - kPlayerH);
    DRect rpR = rpW ? R((float)Wd - rpW - kPad, 48, (float)Wd, (float)Ht - kPlayerH) : R(0, 0, 0, 0);
    DRect playerR = R(0, (float)Ht - kPlayerH, (float)Wd, (float)Ht);
    /* content panel bg */
    if (g.view.kind != PageKind::LyricsFS) {
        g_ui.FillRounded(R(mainR.left, 48, mainR.right, (float)Ht - kPlayerH), 8, color::base);
        g_ui.FillRect(R(mainR.left, 48, mainR.right, (float)Ht - kPlayerH), color::base);
    }
    /* scroll smooth (study: 60fps smooth) */
    g.scrollY += (g.scrollTarget - g.scrollY) * 0.32f;
    if (std::fabs(g.scrollTarget - g.scrollY) < 0.4f) g.scrollY = g.scrollTarget;
    g.lyricsScroll += (g.lyricsTarget - g.lyricsScroll) * 0.30f;
    if (std::fabs(g.lyricsTarget - g.lyricsScroll) < 0.4f) g.lyricsScroll = g.lyricsTarget;
    /* main content clip */
    bool fs = g.view.kind == PageKind::LyricsFS;
    ID2D1RenderTarget* rt = g_ui.RT();
    if (!fs) rt->PushAxisAlignedClip(R(mainR.left, 56, mainR.right, (float)Ht - kPlayerH), D2D1_ANTIALIAS_MODE_ALIASED);
    DRect content = R(mainR.left, 56, mainR.right, (float)Ht - kPlayerH);
    g_zoneBand = fs ? R(0, 48, (float)Wd, (float)Ht - kPlayerH) : content;
    switch (g.view.kind) {
        case PageKind::Home: PaintHomePage(content); break;
        case PageKind::Search: PaintSearchPage(content); break;
        case PageKind::List: case PageKind::Liked: case PageKind::LocalPlaylist: PaintDetailPage(content); break;
        case PageKind::Artist: PaintArtistPage(content); break;
        case PageKind::Charts: PaintChartsPage(content); break;
        case PageKind::Settings: PaintSettingsPage(content); break;
        case PageKind::LyricsFS: PaintLyricsFS(R(0, 48, (float)Wd, (float)Ht - kPlayerH)); break;
    }
    if (!fs) rt->PopAxisAlignedClip();
    /* scroll clamp with fresh height */
    float maxScroll = std::max(0.0f, g_contentH - (H(content)));
    if (g.scrollTarget > maxScroll) g.scrollTarget = maxScroll;
    if (g.scrollTarget < 0) g.scrollTarget = 0;
    PaintTitleBar(titleR);
    PaintSidebar(sideR);
    if (rpW) PaintRightPanel(rpR);
    PaintPlayerBar(playerR);
    PaintSuggestions();
    PaintDialog();
    PaintMenu();
    PaintToast();
    g_ui.End();
}

/* ════════════════ menus / actions ════════════════ */
enum MenuAction {
    MA_NONE = 0, MA_PLAY, MA_PLAY_NEXT, MA_ADD_QUEUE, MA_TOGGLE_LIKE, MA_ADD_TO_PL,
    MA_RADIO, MA_GO_ALBUM, MA_GO_ARTIST, MA_REMOVE_LOCAL, MA_REMOVE_QUEUE,
    MA_OPEN_LOCAL, MA_RENAME_LOCAL, MA_DELETE_LOCAL, MA_PLAY_LOCAL,
    MA_SOURCE_SAAVN = 100, MA_SOURCE_YTM, MA_OPEN_SETTINGS, MA_OPEN_LOGS, MA_EXIT_APP, MA_TOGGLE_RP_LYRICS = 110,
};

static void OpenMenu(std::vector<AppState::MenuItem> items, float x, float y, const Track& forTrack, int forZone, const std::string& targetId) {
    g.menuItems = std::move(items);
    g.menuRect = R(x, y, x + 232, y + 100);
    g.menuTrack = forTrack;
    g.menuForZone = forZone;
    g.menuTargetId = targetId;
    g.menuOpen = true;
    g_ui.Redraw();
}

static std::vector<AppState::MenuItem> TrackMenu(const Track& t) {
    std::vector<AppState::MenuItem> m;
    bool liked = Lib().IsLiked(t.id);
    m.push_back({"Play", MA_PLAY});
    m.push_back({"Play next", MA_PLAY_NEXT});
    m.push_back({"Add to queue", MA_ADD_QUEUE});
    m.push_back({"", 0, false, true});
    m.push_back({liked ? "Remove from Liked Songs" : "Add to Liked Songs", MA_TOGGLE_LIKE, false, false, liked});
    m.push_back({"Add to playlist", MA_ADD_TO_PL});
    if (g.view.kind == PageKind::LocalPlaylist) m.push_back({"Remove from this playlist", MA_REMOVE_LOCAL, true});
    m.push_back({"", 0, false, true});
    m.push_back({"Start radio", MA_RADIO});
    if (!t.albumId.empty()) m.push_back({"Go to album", MA_GO_ALBUM});
    if (!t.artists.empty() && !t.artists[0].id.empty()) m.push_back({"Go to artist", MA_GO_ARTIST});
    return m;
}

static void DoMenuAction(int action) {
    Track t = g.menuTrack;
    switch (action) {
        case MA_PLAY:
            if (g.view.kind == PageKind::List || g.view.kind == PageKind::Liked || g.view.kind == PageKind::LocalPlaylist)
                PlayTrack(t, g.listTracks, std::max(0, (int)(std::find_if(g.listTracks.begin(), g.listTracks.end(), [&](const Track& x) { return x.id == t.id; }) - g.listTracks.begin())));
            else PlayTrack(t, {t}, 0);
            break;
        case MA_PLAY_NEXT:
            g.upNext.push_front(t); Toast("Play next mein dala"); break;
        case MA_ADD_QUEUE:
            if (g.queue.empty()) { g.queue = {t}; g.queueIndex = g.hasCurrent ? 0 : -1; }
            else g.queue.push_back(t);
            Toast("Queue mein dala"); break;
        case MA_TOGGLE_LIKE: {
            Lib().ToggleLike(t);
            Toast(Lib().IsLiked(t.id) ? "Liked Songs mein dala" : "Liked se hataya");
            if (g.view.kind == PageKind::Liked) LoadView();
            break;
        }
        case MA_ADD_TO_PL:
            g.dialogKind = 3; g.dialogTitle = "Add to playlist"; g.dialogId = t.id; g.menuTrack = t;
            ShowWindow(g_edit, SW_HIDE);
            break;
        case MA_REMOVE_LOCAL:
            if (Lib().RemoveFromPlaylist(g.view.id, t.id)) { Toast("Playlist se hataya"); LoadView(); }
            break;
        case MA_RADIO: {
            std::string id = t.id;
            RunAsync([id]() {
                std::vector<Track> tracks; std::string err;
                if (api::Radio(id, 1, tracks, err) && !tracks.empty()) {
                    auto* res = new std::vector<Track>(tracks);
                    PostMessageW(g_mainWnd, WM_APP + 75, (WPARAM)res, 0);
                } else PostMessageW(g_mainWnd, WM_APP + 76, 0, 0);
            }, [] {});
            break;
        }
        case MA_GO_ALBUM: if (!t.albumId.empty()) { View v; v.kind = PageKind::List; v.id = t.albumId; v.title = t.albumTitle; v.isAlbum = true; Navigate(v); } break;
        case MA_GO_ARTIST: if (!t.artists.empty() && !t.artists[0].id.empty()) { View v; v.kind = PageKind::Artist; v.id = t.artists[0].id; v.title = t.artists[0].name; Navigate(v); } break;
        case MA_PLAY_LOCAL: {
            const auto* p = Lib().FindPlaylist(g.menuTargetId);
            if (p && !p->tracks.empty()) { View v; v.kind = PageKind::LocalPlaylist; v.id = p->id; v.title = p->name; Navigate(v); PlayTrack(p->tracks[0], p->tracks, 0); }
            break;
        }
        case MA_OPEN_LOCAL: { View v; v.kind = PageKind::LocalPlaylist; v.id = g.menuTargetId; Navigate(v); break; }
        case MA_RENAME_LOCAL:
            g.dialogKind = 1; g.dialogTitle = "Playlist ka naam badlo"; g.dialogId = g.menuTargetId;
            { const auto* p = Lib().FindPlaylist(g.menuTargetId); g.dialogInitial = p ? p->name : ""; }
            /* edit control dialog mode */
            SetWindowTextW(g_edit, Widen(g.dialogInitial).c_str());
            ShowWindow(g_edit, SW_SHOW);
            SetFocus(g_edit);
            SendMessageW(g_edit, EM_SETSEL, 0, -1);
            break;
        case MA_DELETE_LOCAL:
            g.dialogKind = 2; g.dialogTitle = "Playlist delete karein?"; g.dialogId = g.menuTargetId;
            ShowWindow(g_edit, SW_HIDE);
            break;
        case MA_SOURCE_SAAVN: case MA_SOURCE_YTM: {
            std::string ns = action == MA_SOURCE_SAAVN ? api::kSaavn : api::kYtm;
            if (ns != g.source) {
                g.source = ns; g.homeLoaded = false; g.chartsCache.clear();
                View v; v.kind = PageKind::Home;
                Navigate(v, false);
                Toast(ns == api::kSaavn ? "Source: JioSaavn" : "Source: YouTube Music");
            }
            break;
        }
        case MA_OPEN_SETTINGS: { View v; v.kind = PageKind::Settings; Navigate(v); break; }
        case MA_OPEN_LOGS: ShellExecuteW(nullptr, L"open", AppDataDir().c_str(), nullptr, nullptr, SW_SHOWNORMAL); break;
        case MA_EXIT_APP: DestroyWindow(g_hwnd); break;
        default: break;
    }
    g.menuOpen = false;
    g_ui.Redraw();
}

static void ShowSettingsMenu(float x, float y) {
    std::vector<AppState::MenuItem> m;
    m.push_back({"Source: JioSaavn", MA_SOURCE_SAAVN, false, false, g.source == api::kSaavn});
    m.push_back({"Source: YouTube Music", MA_SOURCE_YTM, false, false, g.source == api::kYtm});
    m.push_back({"", 0, false, true});
    m.push_back({"Settings", MA_OPEN_SETTINGS});
    m.push_back({"Logs kholo", MA_OPEN_LOGS});
    m.push_back({"", 0, false, true});
    m.push_back({"Exit", MA_EXIT_APP});
    OpenMenu(m, x, y, Track{}, 0);
}

/* item from zones: card click mapping — sections se item nikalo */
static void HandleZoneClick(int zone, float x, float y, bool rightClick) {
    (void)x; (void)y;
    if (g.dialogKind) {
        if (zone == Z_DLG_CANCEL) { g.dialogKind = 0; ShowWindow(g_edit, g.dialogKind == 1 ? SW_HIDE : SW_SHOW); if (g.view.kind != PageKind::LyricsFS) ShowWindow(g_edit, SW_SHOW); g_ui.Redraw(); }
        else if (zone == Z_DLG_OK) {
            if (g.dialogKind == 2) { if (Lib().DeletePlaylist(g.dialogId)) { Toast("Playlist delete ho gayi"); if (g.view.kind == PageKind::LocalPlaylist && g.view.id == g.dialogId) { View v; v.kind = PageKind::Home; Navigate(v); } } }
            else if (g.dialogKind == 1) {
                wchar_t buf[256]; GetWindowTextW(g_edit, buf, 256);
                std::string name = Trim(Narrow(buf));
                if (!name.empty() && !g.dialogId.empty()) Lib().RenamePlaylist(g.dialogId, name);
                else if (!name.empty()) { Lib().NewPlaylist(name); Toast("Playlist ban gayi: " + name); }
            }
            g.dialogKind = 0;
            ShowWindow(g_edit, SW_SHOW);
            g_ui.Redraw();
        } else if (zone >= Z_DLG_ITEM && g.dialogKind == 3) {
            int i = zone - Z_DLG_ITEM;
            auto& pls = Lib().playlists;
            if (i >= 0 && i < (int)pls.size()) {
                if (Lib().AddToPlaylist(pls[(size_t)i].id, g.menuTrack)) Toast("'" + pls[(size_t)i].name + "' mein dala");
                g.dialogKind = 0;
                ShowWindow(g_edit, SW_SHOW);
                g_ui.Redraw();
            }
        }
        return;
    }
    if (g.menuOpen) {
        if (zone >= Z_MENU_ITEM && zone < Z_MENU_ITEM + (int)g.menuItems.size()) {
            int action = g.menuItems[(size_t)(zone - Z_MENU_ITEM)].action;
            g.menuOpen = false;
            DoMenuAction(action);
            return;
        }
        g.menuOpen = false;
        g_ui.Redraw();
        return;
    }
    /* search suggestion pick */
    if (zone >= Z_SUGGEST && zone < Z_SUGGEST + (int)g.suggestions.size()) {
        std::string pick = g.suggestions[(size_t)(zone - Z_SUGGEST)];
        g.suggestions.clear();
        g.suggestOpen = false;
        SetWindowTextW(g_edit, Widen(pick).c_str());
        View v; v.kind = PageKind::Search; v.query = pick; v.filter = "all";
        Navigate(v);
        SetFocus(g_hwnd);
        return;
    }
    /* lyric line seek */
    if (g.view.kind == PageKind::LyricsFS && zone >= 1200 && zone < 1200 + 500) {
        int i = zone - 1200;
        if (i < (int)g.lyrics.lines.size()) g_player.Seek(g.lyrics.lines[(size_t)i].first / 1000.0);
        return;
    }
    if (zone >= Z_ROW && zone < Z_ROW + (int)g_rowHits.size()) {
        const RowHit& hit = g_rowHits[(size_t)(zone - Z_ROW)];
        Track tc = hit.track;
        if (rightClick) { OpenMenu(TrackMenu(tc), x, y, tc, zone); return; }
        int idx = 0;
        for (size_t i = 0; i < hit.ctx.size(); i++) if (hit.ctx[i].id == tc.id) { idx = (int)i; break; }
        PlayTrack(tc, hit.ctx, idx);
        return;
    }
    if (zone >= 300 && zone < 300 + (int)g_cardHits.size()) {
        const MediaItem& item = g_cardHits[(size_t)(zone - 300)];
        if (rightClick && item.kind == MediaItem::Kind::Track) { OpenMenu(TrackMenu(item.track), x, y, item.track, zone); return; }
        if (item.kind == MediaItem::Kind::Track) {
            std::vector<Track> ctx;
            for (auto& ci : g_cardHits) if (ci.kind == MediaItem::Kind::Track) ctx.push_back(ci.track);
            int idx = 0;
            for (size_t i = 0; i < ctx.size(); i++) if (ctx[i].id == item.track.id) { idx = (int)i; break; }
            PlayTrack(item.track, ctx, idx);
        } else Navigate(ViewForItem(item));
        return;
    }
    switch (zone) {
        case Z_BACK: NavBack(); break;
        case Z_FORWARD: NavForward(); break;
        case Z_LOGO: { View v; v.kind = PageKind::Home; Navigate(v); break; }
        case Z_SIDEBAR_HOME: { View v; v.kind = PageKind::Home; Navigate(v); break; }
        case Z_SIDEBAR_RADIOTOP: { View v; v.kind = PageKind::Charts; Navigate(v); break; }
        case Z_LIB_LIKED: { View v; v.kind = PageKind::Liked; Navigate(v); break; }
        case Z_SIDEBAR_NEWPL:
            g.dialogKind = 1; g.dialogTitle = "Nayi playlist"; g.dialogId = ""; g.dialogInitial = "";
            SetWindowTextW(g_edit, L"");
            ShowWindow(g_edit, SW_SHOW);
            SetFocus(g_edit);
            g_ui.Redraw();
            break;
        case Z_FILTER_ALL: case Z_FILTER_SONG: case Z_FILTER_ALBUM: case Z_FILTER_PLAYLIST: case Z_FILTER_ARTIST: {
            View v = g.view;
            v.kind = PageKind::Search;
            v.filter = zone == Z_FILTER_ALL ? "all" : zone == Z_FILTER_SONG ? "track" : zone == Z_FILTER_ALBUM ? "album" : zone == Z_FILTER_PLAYLIST ? "playlist" : "artist";
            Navigate(v, false);
            break;
        }
        case Z_CHIP_SRC: case Z_CHIP_SRC2: {
            std::string ns = zone == Z_CHIP_SRC ? api::kSaavn : api::kYtm;
            if (ns != g.source) {
                g.source = ns; g.homeLoaded = false; g.chartsCache.clear();
                View v = g.view;
                Navigate(v, false);
                Toast(ns == api::kSaavn ? "Source: JioSaavn" : "Source: YouTube Music");
            }
            break;
        }
        case Z_HERO_PLAY: {
            if (!g.listTracks.empty() && (g.view.kind == PageKind::List || g.view.kind == PageKind::Liked || g.view.kind == PageKind::LocalPlaylist))
                PlayTrack(g.listTracks[0], g.listTracks, 0);
            else if (g.view.kind == PageKind::Artist && !g.artist.topTracks.empty())
                PlayTrack(g.artist.topTracks[0], g.artist.topTracks, 0);
            break;
        }
        case Z_TRANSPORT_PLAY: {
            if (g.hasCurrent) {
                bool np = !g.paused;
                if (!g.playing && !g.buffering) { StartStream(g.current); }
                else { g_player.SetPaused(np); g.paused = np; }
                g_ui.Redraw();
            } else if (!Lib().recent.empty()) PlayTrack(Lib().recent[0], Lib().recent, 0);
            break;
        }
        case Z_TRANSPORT_NEXT: PlayNextTrack(false); break;
        case Z_TRANSPORT_PREV: PlayPrevTrack(); break;
        case Z_TRANSPORT_SHUFFLE: ToggleShuffle(); break;
        case Z_TRANSPORT_REPEAT: CycleRepeat(); break;
        case Z_NP_HEART:
            if (g.hasCurrent) { Lib().ToggleLike(g.current); Toast(Lib().IsLiked(g.current.id) ? "Liked" : "Like hataya"); g_ui.Redraw(); }
            break;
        case Z_VOLUME_ICON: {
            static float prevVol = 0.75f;
            auto& Lv = Lib();
            if (Lv.volume > 0.001f) { prevVol = Lv.volume; Lv.volume = 0; }
            else Lv.volume = prevVol;
            g_player.SetVolume(Lv.volume);
            Lv.Save();
            g_ui.Redraw();
            break;
        }
        case Z_NP_QUEUE:
            if (g.rpOpen && !g.rpLyrics) g.rpOpen = false; else { g.rpOpen = true; g.rpLyrics = false; }
            g_ui.Redraw(); break;
        case Z_NP_LYRICS:
            if (g.rpOpen && g.rpLyrics) g.rpOpen = false; else { g.rpOpen = true; g.rpLyrics = true; LoadLyricsIfNeeded(); }
            g_ui.Redraw(); break;
        case Z_NP_PIP: case Z_NP_FULL:
            if (g.view.kind == PageKind::LyricsFS) { NavBack(); }
            else if (g.hasCurrent) { View v; v.kind = PageKind::LyricsFS; Navigate(v); LoadLyricsIfNeeded(); }
            break;
        case Z_NP_COVER: case Z_NP_TITLE:
            if (g.hasCurrent) { View v; v.kind = PageKind::LyricsFS; Navigate(v); LoadLyricsIfNeeded(); }
            break;
        case Z_RP_CLOSE: g.rpOpen = false; g_ui.Redraw(); break;
        case Z_RP_TABQ: g.rpLyrics = false; g_ui.Redraw(); break;
        case Z_RP_TABL: g.rpLyrics = true; LoadLyricsIfNeeded(); g_ui.Redraw(); break;
        case Z_ACTION_SETTINGS: ShowSettingsMenu(g_ui.Wd() - 260.0f, 52); break;
        case Z_SETTINGS_ABOUT: ShellExecuteW(nullptr, L"open", AppDataDir().c_str(), nullptr, nullptr, SW_SHOWNORMAL); break;
        case Z_SETTINGS_SRC: break;
        case Z_WIN_MIN: ShowWindow(g_hwnd, SW_MINIMIZE); break;
        case Z_WIN_MAX: ShowWindow(g_hwnd, IsZoomed(g_hwnd) ? SW_RESTORE : SW_MAXIMIZE); break;
        case Z_WIN_CLOSE: DestroyWindow(g_hwnd); break;
        case Z_SEARCH_INPUT: SetFocus(g_edit); break;
        default:
            if (zone >= Z_LIB_ROW && zone < Z_LIB_ROW + 60) {
                int i = zone - Z_LIB_ROW;
                if (i >= 0 && i < (int)Lib().playlists.size()) {
                    View v; v.kind = PageKind::LocalPlaylist; v.id = Lib().playlists[(size_t)i].id; v.title = Lib().playlists[(size_t)i].name;
                    if (rightClick) {
                        std::vector<AppState::MenuItem> m;
                        m.push_back({"Play", MA_PLAY_LOCAL});
                        m.push_back({"Open", MA_OPEN_LOCAL});
                        m.push_back({"Rename", MA_RENAME_LOCAL});
                        m.push_back({"Delete playlist", MA_DELETE_LOCAL, true});
                        OpenMenu(m, x, y, Track{}, zone, v.id);
                    } else Navigate(v);
                }
            } else if (zone >= Z_RP_ROW) {
                int i = zone - Z_RP_ROW;
                if (i == -1 && g.hasCurrent) { /* now playing */ }
                else if (i >= 100) {
                    int q = i - 100;
                    if (q >= 0 && q < (int)g.upNext.size()) { Track t = g.upNext[(size_t)q]; if (rightClick) OpenMenu(TrackMenu(t), x, y, t, zone); else { g.upNext.erase(g.upNext.begin() + q); PlayTrack(t, g.queue, g.queueIndex); } }
                } else if (i >= 0 && i < (int)g.queue.size()) { PlayTrack(g.queue[(size_t)i], g.queue, i); }
            }
            if (zone >= Z_RP_REMOVE && zone < Z_RP_REMOVE + 40 && !rightClick) {
                int q = zone - Z_RP_REMOVE;
                if (q >= 0 && q < (int)g.upNext.size()) { g.upNext.erase(g.upNext.begin() + q); g_ui.Redraw(); }
            }
            break;
    }
    if (rightClick && zone >= Z_ROW && zone < Z_ROW + 300) { /* handled above */ }
}

/* right-click row handler (context) window-level se bulaya jata */
static void HandleRightClick(float x, float y) {
    int zone = ZoneAt(x, y);
    if (g.menuOpen) { g.menuOpen = false; g_ui.Redraw(); return; }
    if (zone >= Z_ROW && zone < Z_ROW + 300) { HandleZoneClick(zone, x, y, true); return; }
    if (zone >= 300 && zone < 540) { HandleZoneClick(zone, x, y, true); return; }
    if (zone >= Z_LIB_ROW && zone < Z_LIB_ROW + 60) { HandleZoneClick(zone, x, y, true); return; }
    if (zone >= Z_RP_ROW) { HandleZoneClick(zone, x, y, true); return; }
}

/* ════════════════ EDIT control / subclass ════════════════ */
static WNDPROC g_oldEdit = nullptr;

static void PositionEdit() {
    if (!g_edit) return;
    if (g.dialogKind == 1) {
        float dw = 420; float x = (g_ui.Wd() - dw) / 2; float y = (g_ui.Ht() - 228) / 2;
        SetWindowPos(g_edit, nullptr, (int)(x + 24), (int)(y + 66), (int)(dw - 48), 44, SWP_NOZORDER);
        return;
    }
    if (g.dialogKind) { ShowWindow(g_edit, SW_HIDE); return; }
    if (g.view.kind == PageKind::LyricsFS) { ShowWindow(g_edit, SW_HIDE); return; }
    ShowWindow(g_edit, SW_SHOW);
    SetWindowPos(g_edit, nullptr, (int)(g_searchRect.left + 36), (int)(g_searchRect.top + 2),
                 (int)(W(g_searchRect) - 44), 28, SWP_NOZORDER);
}

static LRESULT CALLBACK EditProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_SETFOCUS) { g.suggestOpen = true; g_ui.Redraw(); }
    if (msg == WM_KILLFOCUS) { g.suggestOpen = false; g_ui.Redraw(); }
    if (msg == WM_KEYDOWN) {
        if (wp == VK_RETURN) {
            if (g.dialogKind == 1) { HandleZoneClick(Z_DLG_OK, 0, 0, false); return 0; }
            wchar_t buf[512]; GetWindowTextW(hwnd, buf, 512);
            std::string q = Trim(Narrow(buf));
            View v; v.kind = PageKind::Search; v.query = q; v.filter = g.view.kind == PageKind::Search ? g.view.filter : "all";
            if (!q.empty()) Navigate(v);
            SetFocus(g_hwnd);
            return 0;
        }
        if (wp == VK_ESCAPE) {
            if (g.dialogKind) { g.dialogKind = 0; PositionEdit(); g_ui.Redraw(); }
            g.suggestions.clear(); g.suggestOpen = false;
            SetFocus(g_hwnd);
            return 0;
        }
    }
    if (msg == WM_CHAR && (wp == 1)) { /* Ctrl+A */ SendMessageW(hwnd, EM_SETSEL, 0, -1); return 0; }
    /* typing par debounce search */
    if (msg == WM_CHAR || msg == WM_KEYUP || msg == WM_PASTE) {
        if (!g.dialogKind) SetTimer(g_hwnd, 8, 350, nullptr);
    }
    return CallWindowProcW(g_oldEdit, hwnd, msg, wp, lp);
}

/* ════════════════ tint (hero average color) ════════════════ */
static IWICImagingFactory* g_wic = nullptr;
static void ApplyTintBytes(TintMsg* raw) {
    std::unique_ptr<TintMsg> hold(raw);
    /* detail badal gaya ho to purana tint mustarad */
    if (!hold || hold->url != g.detailTintFor) return;
    if (!g_wic || hold->bytes.empty()) return;
    IStream* stream = SHCreateMemStream(hold->bytes.data(), (UINT)hold->bytes.size());
    if (!stream) return;
    IWICBitmapDecoder* dec = nullptr;
    if (SUCCEEDED(g_wic->CreateDecoderFromStream(stream, nullptr, WICDecodeMetadataCacheOnLoad, &dec))) {
        IWICBitmapFrameDecode* frame = nullptr;
        if (SUCCEEDED(dec->GetFrame(0, &frame))) {
            IWICBitmapScaler* scaler = nullptr;
            if (SUCCEEDED(g_wic->CreateBitmapScaler(&scaler))) {
                IWICBitmapSource* src = frame;
                if (SUCCEEDED(scaler->Initialize(src, 1, 1, WICBitmapInterpolationModeFant))) {
                    BYTE px[4] = {};
                    if (SUCCEEDED(scaler->CopyPixels(nullptr, 4, 4, px))) {
                        /* BGRA (premultiplied ho sakta — taqreeban sahee) */
                        g.detailTint = {px[2] / 255.0f, px[1] / 255.0f, px[0] / 255.0f, 1};
                        /* boht light/dark fix */
                        float lum = g.detailTint.r * 0.3f + g.detailTint.g * 0.59f + g.detailTint.b * 0.11f;
                        if (lum > 0.45f) g.detailTint = Darken(g.detailTint, 0.55f);
                        else if (lum < 0.05f) g.detailTint = {0.10f, 0.10f, 0.10f, 1};
                        g_ui.Redraw();
                    }
                }
                scaler->Release();
            }
            frame->Release();
        }
        dec->Release();
    }
    stream->Release();
}

/* ════════════════ tray ════════════════ */
static void TrayAdd() {
    g_tray.cbSize = sizeof(g_tray);
    g_tray.hWnd = g_hwnd;
    g_tray.uID = 7;
    g_tray.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_tray.uCallbackMessage = WM_APP_TRAY;
    g_tray.hIcon = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(101));
    if (!g_tray.hIcon) g_tray.hIcon = LoadIconW(nullptr, MAKEINTRESOURCEW(32512));
    wcscpy_s(g_tray.szTip, L"Bloomee");
    Shell_NotifyIconW(NIM_ADD, &g_tray);
}
static void TrayMenuShow() {
    HMENU menu = CreatePopupMenu();
    AppendMenuW(menu, MF_STRING, 1, L"Open Bloomee");
    AppendMenuW(menu, MF_STRING, 2, g.paused ? L"Play" : L"Pause");
    AppendMenuW(menu, MF_STRING, 3, L"Next");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, 4, L"Exit");
    POINT pt; GetCursorPos(&pt);
    SetForegroundWindow(g_hwnd);
    TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, g_hwnd, nullptr);
    DestroyMenu(menu);
}

/* ════════════════ window proc ════════════════ */
static bool PointInZone(float x, float y, int id) { DRect r = ZoneRect(id); return r.right > r.left && PtIn(r, x, y); }

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_CREATE: {
            g_hwnd = hwnd;
            g_mainWnd = hwnd;
            if (!g_ui.Init(hwnd)) { MessageBoxW(hwnd, L"Direct2D init fail", L"Bloomee", MB_ICONERROR); return -1; }
            CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IWICImagingFactory), (void**)&g_wic);
            Lib().Load();
            g_player.Init();
            g_player.SetVolume(Lib().volume);
            /* last track restore (paused, study: restart par last song wapas, auto-play nahi) */
            if (!Lib().lastTrackJson.empty()) {
                try {
                    Track t = TrackFromJ(J::parse(Lib().lastTrackJson));
                    if (!t.id.empty()) {
                        g.current = t; g.hasCurrent = true; g.paused = true;
                        g.queue = {t}; g.queueIndex = 0;
                        g.displayDuration = t.durationMs / 1000.0;
                    }
                } catch (...) {}
            }
            /* edit control */
            g_edit = CreateWindowExW(0, L"EDIT", L"",
                WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL,
                0, 0, 100, 28, hwnd, (HMENU)1001, GetModuleHandleW(nullptr), nullptr);
            SendMessageW(g_edit, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELPARAM(6, 6));
            HFONT font = CreateFontW(-14, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, L"Montserrat");
            if (!font) font = CreateFontW(-14, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, L"Segoe UI");
            SendMessageW(g_edit, WM_SETFONT, (WPARAM)font, TRUE);
            g_oldEdit = (WNDPROC)SetWindowLongPtrW(g_edit, GWLP_WNDPROC, (LONG_PTR)EditProc);
            TrayAdd();
            SetTimer(hwnd, 1, 100, nullptr);   /* playback tick */
            SetTimer(hwnd, 3, 30000, nullptr); /* autosave-ish safety */
            View home; home.kind = PageKind::Home;
            g.view = home;
            g.history = {home};
            g.histPos = 0;
            LoadView();
            return 0;
        }
        case WM_PAINT: {
            PAINTSTRUCT ps; BeginPaint(hwnd, &ps); EndPaint(hwnd, &ps);
            DoPaint();
            PositionEdit();
            return 0;
        }
        case WM_SIZE: {
            g_ui.Resize(LOWORD(lp), HIWORD(lp));
            PositionEdit();
            /* maximized mein tray restore glyph */
            g_ui.Redraw();
            return 0;
        }
        case WM_GETMINMAXINFO: {
            auto* mmi = (MINMAXINFO*)lp;
            mmi->ptMinTrackSize = {940, 580};
            return 0;
        }
        case WM_ERASEBKGND: return 1;
        case WM_MOUSEMOVE: {
            float x = (float)GET_X_LPARAM(lp), y = (float)GET_Y_LPARAM(lp);
            g.mouse = {(LONG)x, (LONG)y};
            g.mouseIn = true;
            int z = ZoneAt(x, y);
            if (g.vol.dragging) {
                DRect vr = ZoneRect(Z_VOLBAR);
                float frac = vr.right > vr.left ? (x - vr.left) / W(vr) : 0;
                frac = std::max(0.0f, std::min(1.0f, frac));
                Lib().volume = frac;
                g_player.SetVolume(frac);
            }
            if (g.seek.dragging) {
                DRect sr = ZoneRect(Z_SEEKBAR);
                /* seek slider rect alag rakha: paint mein zone pos se */
                float frac = 0;
                static DRect lastSeekRect{0,0,0,0};
                (void)lastSeekRect;
                /* zone rect transport width ke barabar hai; andar progress hai — approximate full zone */
                frac = sr.right > sr.left ? (x - sr.left) / W(sr) : 0;
                g.seek.frac = std::max(0.0f, std::min(1.0f, frac));
            }
            if (g.sidebarDrag) {
                g.sidebarW = std::max(200.0f, std::min(360.0f, x - 8));
            }
            if (z != g.hoverZone) { g.hoverZone = z; g_ui.Redraw(); }
            TRACKMOUSEEVENT tme{sizeof(tme), TME_LEAVE, hwnd, 0};
            TrackMouseEvent(&tme);
            return 0;
        }
        case WM_MOUSELEAVE: g.mouseIn = false; g.hoverZone = -1; g_ui.Redraw(); return 0;
        case WM_MOUSEWHEEL: {
            POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
            ScreenToClient(hwnd, &pt);
            float delta = (float)GET_WHEEL_DELTA_WPARAM(wp) / 120.0f * 72.0f;
            if (g.view.kind == PageKind::LyricsFS || (g.rpOpen && g.rpLyrics)) {
                g.lyricsUserScroll = true;
                g.lyricsTarget = std::max(0.0f, g.lyricsTarget - delta);
            } else g.scrollTarget = std::max(0.0f, g.scrollTarget - delta);
            g_ui.Redraw();
            return 0;
        }
        case WM_LBUTTONDOWN: {
            float x = (float)GET_X_LPARAM(lp), y = (float)GET_Y_LPARAM(lp);
            SetFocus(hwnd);
            if (PointInZone(x, y, Z_SEEKBAR)) {
                DRect sr = ZoneRect(Z_SEEKBAR);
                g.seek.dragging = true;
                g.seek.frac = sr.right > sr.left ? std::max(0.0f, std::min(1.0f, (x - sr.left) / W(sr))) : 0;
                g.hoverZone = Z_SEEKBAR;
                SetCapture(hwnd);
                g_ui.Redraw();
                return 0;
            }
            if (PointInZone(x, y, Z_VOLBAR)) {
                DRect vr = ZoneRect(Z_VOLBAR);
                g.vol.dragging = true;
                float frac = vr.right > vr.left ? std::max(0.0f, std::min(1.0f, (x - vr.left) / W(vr))) : 0;
                Lib().volume = frac;
                g_player.SetVolume(frac);
                g.hoverZone = Z_VOLBAR;
                SetCapture(hwnd);
                g_ui.Redraw();
                return 0;
            }
            /* sidebar resize strip (sidebar/main divider 6px) */
            if (std::fabs(x - (LayoutSidebarW() + kPad + kPad)) < 5 && y > 48 && y < g_ui.Ht() - kPlayerH) {
                g.sidebarDrag = true;
                SetCapture(hwnd);
                return 0;
            }
            int z = ZoneAt(x, y);
            if (z != Z_NONE) HandleZoneClick(z, x, y, false);
            else if (g.menuOpen) { g.menuOpen = false; g_ui.Redraw(); }
            else if (g.dialogKind) { /* bahar click dialog band nahi */ }
            return 0;
        }
        case WM_LBUTTONUP: {
            if (g.seek.dragging) {
                g.seek.dragging = false;
                if (g.hasCurrent && g_player.HasMedia()) g_player.Seek(g.seek.frac * g.displayDuration);
                ReleaseCapture();
                g_ui.Redraw();
            }
            if (g.vol.dragging) { g.vol.dragging = false; Lib().Save(); ReleaseCapture(); g_ui.Redraw(); }
            if (g.sidebarDrag) { g.sidebarDrag = false; ReleaseCapture(); }
            /* lyrics user scroll auto-resume 4s baad */
            if (g.lyricsUserScroll) SetTimer(hwnd, 5, 4000, nullptr);
            return 0;
        }
        case WM_LBUTTONDBLCLK: {
            float x = (float)GET_X_LPARAM(lp), y = (float)GET_Y_LPARAM(lp);
            int z = ZoneAt(x, y);
            if (z >= Z_ROW && z < Z_ROW + 300) {
                /* dbl-click = play (single click bhi wahi — Spotify jesa) */
                HandleZoneClick(z, x, y, false);
            } else if (y < 48 && !PointInZone(x, y, Z_WIN_MIN) && !PointInZone(x, y, Z_WIN_MAX) && !PointInZone(x, y, Z_WIN_CLOSE) && !PointInZone(x, y, Z_SEARCH_INPUT)) {
                ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
            }
            return 0;
        }
        case WM_RBUTTONDOWN: {
            float x = (float)GET_X_LPARAM(lp), y = (float)GET_Y_LPARAM(lp);
            HandleRightClick(x, y);
            return 0;
        }
        case WM_CONTEXTMENU: return 0;
        case WM_KEYDOWN: {
            bool typing = GetFocus() == g_edit && !g.dialogKind;
            bool ctrl = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
            if (wp == VK_ESCAPE) {
                if (g.menuOpen) { g.menuOpen = false; g_ui.Redraw(); return 0; }
                if (g.dialogKind) { g.dialogKind = 0; PositionEdit(); g_ui.Redraw(); return 0; }
                if (g.view.kind == PageKind::LyricsFS) { NavBack(); return 0; }
            }
            if (ctrl && (wp == 'K' || wp == 'L')) { SetFocus(g_edit); SendMessageW(g_edit, EM_SETSEL, 0, -1); return 0; }
            if (ctrl && wp == 'F') { SetFocus(g_edit); SendMessageW(g_edit, EM_SETSEL, 0, -1); return 0; }
            if (typing) return 0;
            switch (wp) {
                case VK_SPACE:
                    if (g.hasCurrent) {
                        bool np = !g.paused;
                        if (!g.playing && !g.buffering) StartStream(g.current);
                        else { g_player.SetPaused(np); g.paused = np; }
                        g_ui.Redraw();
                    }
                    return 0;
                case VK_RIGHT:
                    if (ctrl) PlayNextTrack(false);
                    else if (g_player.HasMedia()) g_player.Seek(std::min(g_player.Duration(), g_player.Position() + 5));
                    return 0;
                case VK_LEFT:
                    if (ctrl) PlayPrevTrack();
                    else if (g_player.HasMedia()) g_player.Seek(std::max(0.0, g_player.Position() - 5));
                    return 0;
                case VK_UP: Lib().volume = std::min(1.0f, Lib().volume + 0.05f); g_player.SetVolume(Lib().volume); g_ui.Redraw(); return 0;
                case VK_DOWN: Lib().volume = std::max(0.0f, Lib().volume - 0.05f); g_player.SetVolume(Lib().volume); g_ui.Redraw(); return 0;
                case 'M': if (ctrl) { Lib().volume = Lib().volume > 0 ? 0.0f : 0.75f; g_player.SetVolume(Lib().volume); g_ui.Redraw(); } return 0;
                case 'L': if (ctrl) { SetFocus(g_edit); return 0; } break;
                default: break;
            }
            return 0;
        }
        case WM_TIMER: {
            if (wp == 1) {
                if (g_player.IsPlaying()) {
                    g.displayPos = g.seek.dragging ? g.seek.frac * g.displayDuration : g_player.Position();
                    double d = g_player.Duration();
                    if (d > 0) g.displayDuration = d;
                    g.eqTick++;
                    /* synced lyrics auto-follow */
                    if ((g.rpOpen && g.rpLyrics) || g.view.kind == PageKind::LyricsFS) LoadLyricsIfNeeded();
                    g_ui.Redraw();
                } else if (g.buffering || g.toastUntil > GetTickCount64()) {
                    g.eqTick++;
                    g_ui.Redraw();
                } else if (g.lyricsScroll != g.lyricsTarget || g.scrollY != g.scrollTarget) {
                    g_ui.Redraw();
                }
            } else if (wp == 3) {
                Lib().Save();
            } else if (wp == 5) {
                g.lyricsUserScroll = false;
                KillTimer(hwnd, 5);
            } else if (wp == 8) {
                KillTimer(hwnd, 8);
                if (!g.dialogKind && GetFocus() == g_edit) {
                    wchar_t buf[512]; GetWindowTextW(g_edit, buf, 512);
                    std::string q = Trim(Narrow(buf));
                    if (q.size() < 2) { g.suggestions.clear(); g.suggestFor.clear(); g_ui.Redraw(); }
                    else if (q != g.suggestFor) {
                        g.suggestFor = q;
                        int gen = ++g.suggestGen;
                        std::string src = g.source;
                        RunAsync([q, src, gen]() {
                            auto* out = new std::pair<int, std::vector<std::string>>();
                            out->first = gen;
                            std::string err;
                            api::Suggestions(src, q, out->second, err);
                            PostMessageW(g_mainWnd, WM_APP + 77, (WPARAM)out, 0);
                        }, [] {});
                    }
                }
            }
            return 0;
        }
        case WM_APP_JOB: Jobs().Drain(); return 0;
        case WM_APP_PLAYER: {
            if (wp == 1) { g.playing = true; g.paused = false; g.buffering = false; }
            else if (wp == 2) {
                g.playing = false; g.paused = true;
                if (Lib().repeatOne && g.hasCurrent) { g_player.Seek(0); StartStream(g.current); }
                else PlayNextTrack(true);
            } else if (wp == 3) {
                g.playing = false; g.buffering = false; g.paused = true;
                Toast("Stream nahi chala — doosra gaana try karo");
                LogLine("player error shown");
            }
            g_ui.Redraw();
            return 0;
        }
        case WM_APP + 70: ApplyTintBytes((TintMsg*)wp); return 0;
        case WM_APP + 71: {
            std::unique_ptr<StreamResult> res((StreamResult*)wp);
            if (res && !res->url.empty() && res->forId == g.pendingStreamId && g.hasCurrent &&
                g.current.id == res->forId) {
                StreamResolvedPlay(g.current, res->url);
            } else if (res && !res->url.empty()) {
                /* purana track ka result — ignore */
            } else {
                g.buffering = false; g.paused = true;
                Toast("Stream nahi mila");
            }
            return 0;
        }
        case WM_APP + 72: {
            auto* more = (std::vector<Track>*)wp;
            std::unique_ptr<std::vector<Track>> hold(more);
            if (more && more->size() > 1) {
                g.queue = *more;
                g.queueIndex = 0;
                PlayTrack(g.queue[0], g.queue, 0);
            }
            return 0;
        }
        case WM_APP + 73: ApplyLoaded((void*)wp, (uint32_t)lp); return 0;
        case WM_APP + 74: {
            auto* out = (api::LyricsOut*)wp;
            std::unique_ptr<api::LyricsOut> hold(out);
            g.lyricsLoading = false;
            if (out) { g.lyrics = *out; g.lyricsLoaded = true; g.lyricsScroll = g.lyricsTarget = 0; g.lyricsUserScroll = false; }
            g_ui.Redraw();
            return 0;
        }
        case WM_APP + 75: {
            auto* tracks = (std::vector<Track>*)wp;
            std::unique_ptr<std::vector<Track>> hold(tracks);
            if (tracks && !tracks->empty()) {
                g.queue = *tracks;
                g.queueIndex = 0;
                Toast("Radio shuru");
                PlayTrack(g.queue[0], g.queue, 0);
            } else Toast("Radio fail");
            return 0;
        }
        case WM_APP + 76: Toast("Radio nahi chala"); return 0;
        case WM_APP + 77: {
            std::unique_ptr<std::pair<int, std::vector<std::string>>> res((std::pair<int, std::vector<std::string>>*)wp);
            if (res && res->first == g.suggestGen) {
                g.suggestions = res->second;
                g.suggestOpen = GetFocus() == g_edit;
                g_ui.Redraw();
            }
            return 0;
        }
        case WM_APP_TRAY: {
            if (lp == WM_LBUTTONDBLCLK || lp == WM_LBUTTONUP) {
                ShowWindow(hwnd, SW_SHOW);
                SetForegroundWindow(hwnd);
            } else if (lp == WM_RBUTTONUP) TrayMenuShow();
            return 0;
        }
        case WM_COMMAND: {
            if (lp == 0 && HIWORD(wp) == 0 && LOWORD(wp) >= 1 && LOWORD(wp) <= 4) {
                /* tray menu (hwnd receiver) */
                switch (LOWORD(wp)) {
                    case 1: ShowWindow(hwnd, SW_SHOW); SetForegroundWindow(hwnd); break;
                    case 2: SendMessageW(hwnd, WM_KEYDOWN, VK_SPACE, 0); break;
                    case 3: PlayNextTrack(false); break;
                    case 4: DestroyWindow(hwnd); break;
                }
                return 0;
            }
            return 0;
        }
        case WM_CTLCOLOREDIT: {
            HDC dc = (HDC)wp;
            SetTextColor(dc, RGB(255, 255, 255));
            SetBkColor(dc, RGB(0x2a, 0x2a, 0x2a));
            static HBRUSH br = CreateSolidBrush(RGB(0x2a, 0x2a, 0x2a));
            return (LRESULT)br;
        }
        case WM_NCHITTEST: {
            LRESULT hit = DefWindowProcW(hwnd, msg, wp, lp);
            if (hit == HTCLIENT) {
                POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
                ScreenToClient(hwnd, &pt);
                /* resize edges */
                RECT rc; GetClientRect(hwnd, &rc);
                const int B = 6;
                bool l = pt.x < B, r = pt.x >= rc.right - B, t = pt.y < B, b = pt.y >= rc.bottom - B;
                if (t && l) return HTTOPLEFT;
                if (t && r) return HTTOPRIGHT;
                if (b && l) return HTBOTTOMLEFT;
                if (b && r) return HTBOTTOMRIGHT;
                if (l) return HTLEFT;
                if (r) return HTRIGHT;
                if (t) return HTTOP;
                if (b) return HTBOTTOM;
                /* titlebar drag (zones wali jagah chhod kar) */
                if (pt.y < 48 && pt.y >= 0) {
                    int z = ZoneAt((float)pt.x, (float)pt.y);
                    if (z == Z_NONE && !PtIn(g_searchRect, (float)pt.x, (float)pt.y)) return HTCAPTION;
                }
            }
            return hit;
        }
        case WM_DPICHANGED: {
            RECT* rc = (RECT*)lp;
            SetWindowPos(hwnd, nullptr, rc->left, rc->top, rc->right - rc->left, rc->bottom - rc->top, SWP_NOZORDER);
            g_ui.Resize(rc->right - rc->left, rc->bottom - rc->top);
            return 0;
        }
        case WM_CLOSE: DestroyWindow(hwnd); return 0;
        case WM_DESTROY: {
            KillTimer(hwnd, 1);
            KillTimer(hwnd, 3);
            Lib().Save();
            Shell_NotifyIconW(NIM_DELETE, &g_tray);
            g_player.Shutdown();
            g_ui.Shutdown();
            if (g_wic) g_wic->Release();
            PostQuitMessage(0);
            return 0;
        }
        default: break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, LPWSTR, int show) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    INITCOMMONCONTROLSEX icc{sizeof(icc), ICC_STANDARD_CLASSES};
    InitCommonControlsEx(&icc);
    /* ek hi instance */
    HANDLE mutex = CreateMutexW(nullptr, TRUE, L"BloomeeSingleInstance");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(L"BloomeeMainWindow", nullptr);
        if (existing) { ShowWindow(existing, SW_SHOW); SetForegroundWindow(existing); }
        return 0;
    }
    WNDCLASSW wc{};
    wc.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = inst;
    wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(101));
    if (!wc.hIcon) wc.hIcon = LoadIconW(nullptr, MAKEINTRESOURCEW(32512));
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"BloomeeMainWindow";
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(0, L"BloomeeMainWindow", L"Bloomee",
        WS_POPUP | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU,
        CW_USEDEFAULT, CW_USEDEFAULT, 1280, 820, nullptr, nullptr, inst, nullptr);
    if (!hwnd) return 1;
    /* rounded corners (Win11); constants har SDK mein na hon to numeric */
    {
        int cornerPref = 2; /* DWMWCP_ROUND */
        DwmSetWindowAttribute(hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &cornerPref, sizeof(cornerPref));
    }
    ShowWindow(hwnd, show);
    UpdateWindow(hwnd);
    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        if (msg.message == WM_KEYDOWN && msg.wParam == VK_TAB) { /* edit focus cycling simple */ }
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    if (mutex) { ReleaseMutex(mutex); CloseHandle(mutex); }
    CoUninitialize();
    return 0;
}


/* ════════════════ PAINT: chrome ════════════════ */

static void PaintTitleBar(const DRect& area) {
    g_ui.FillRect(area, color::sidebarBg);
    /* logo + name */
    DRect logo = R(area.left + 16, area.top + 12, area.left + 40, area.top + 36);
    g_ui.FillRounded(logo, 12, color::green);
    g_ui.IconPlay(R(logo.left + 5, logo.top + 5, logo.right - 5, logo.bottom - 5), color::black);
    g_ui.Text("Bloomee", R(area.left + 48, area.top + 13, area.left + 200, area.top + 35), 16, TW::Bold);
    AddZone(R(area.left + 8, area.top + 4, area.left + 210, area.top + 44), Z_LOGO, 0);
    /* back / forward */
    bool canB = g.histPos > 0, canF = g.histPos < (int)g.history.size() - 1;
    DRect bb = R(area.left + 220, area.top + 8, area.left + 252, area.top + 40);
    g_ui.FillRounded(bb, 16, color::elevatedBase);
    g_ui.IconBack(R(bb.left + 7, bb.top + 7, bb.right - 7, bb.bottom - 7), canB ? color::textBase : color::Alpha(color::textSubdued, 0.4f));
    AddZone(bb, Z_BACK, 16);
    DRect fb = R(area.left + 260, area.top + 8, area.left + 292, area.top + 40);
    g_ui.FillRounded(fb, 16, color::elevatedBase);
    g_ui.IconForward(R(fb.left + 7, fb.top + 7, fb.right - 7, fb.bottom - 7), canF ? color::textBase : color::Alpha(color::textSubdued, 0.4f));
    AddZone(fb, Z_FORWARD, 16);
    /* search box (edit ctrl overlay hota hai) */
    float sw = std::min(420.0f, W(area) * 0.32f);
    g_searchRect = R(area.left + 310, area.top + 8, area.left + 310 + sw, area.top + 40);
    g_ui.FillRounded(g_searchRect, 16, color::subdued);
    g_ui.IconSearch(R(g_searchRect.left + 8, area.top + 13, g_searchRect.left + 30, area.top + 35), color::textSubdued);
    AddZone(g_searchRect, Z_SEARCH_INPUT, 16);
    /* settings gear-ish (menu) */
    DRect st = R(area.right - 150, area.top + 10, area.right - 122, area.top + 38);
    g_ui.IconMore(st, g.hoverZone == Z_ACTION_SETTINGS ? color::textBase : color::textSubdued);
    AddZone(R(area.right - 156, area.top + 4, area.right - 116, area.top + 44), Z_ACTION_SETTINGS, 14);
    /* window controls (46x full height, study §8) */
    struct WCDef { int zone; };
    float cx = area.right;
    DRect closeR = R(cx - 46, area.top, cx, area.bottom);
    DRect maxR = R(cx - 92, area.top, cx - 46, area.bottom);
    DRect minR = R(cx - 138, area.top, cx - 92, area.bottom);
    if (g.hoverZone == Z_WIN_CLOSE) g_ui.FillRect(closeR, color::Hex(0xe81123));
    else if (g.hoverZone == Z_WIN_MAX) g_ui.FillRect(maxR, color::Alpha(color::white, 0.12f));
    else if (g.hoverZone == Z_WIN_MIN) g_ui.FillRect(minR, color::Alpha(color::white, 0.12f));
    D2D1_COLOR_F ic = color::textBase;
    g_ui.IconMin(minR, ic); g_ui.IconMax(maxR, ic);
    if (g.hoverZone == Z_WIN_CLOSE) g_ui.IconClose(closeR, color::white); else g_ui.IconClose(closeR, ic);
    AddZone(minR, Z_WIN_MIN); AddZone(maxR, Z_WIN_MAX); AddZone(closeR, Z_WIN_CLOSE);
}

static void PaintSidebar(const DRect& area) {
    g_ui.FillRounded(R(area.left + kPad, area.top, area.right, area.bottom), 8, color::elevatedBase);
    float x = area.left + kPad + 12;
    float w = W(area) - kPad - 24;
    float y = area.top + 12;
    /* nav rows (study: 16px semibold, icon 24) */
    auto navRow = [&](const char* label, int zone, bool active, int iconKind) {
        DRect row = R(x, y, x + w, y + 36);
        if (g.hoverZone == zone) g_ui.FillRounded(row, 6, color::Alpha(color::white, 0.06f));
        DRect ir = R(x + 8, y + 6, x + 32, y + 30);
        if (iconKind == 0) g_ui.IconHome(ir, active ? color::textBase : color::textSubdued, active);
        else if (iconKind == 1) g_ui.IconEq(ir, active ? color::textBase : color::textSubdued, 0.5f);
        else g_ui.IconQueue(ir, active ? color::textBase : color::textSubdued, active);
        g_ui.Text(label, R(x + 44, y + 7, x + w, y + 29), 14, TW::SemiBold, active ? color::textBase : color::textSubdued);
        AddZone(row, zone, 6);
        y += 40;
    };
    navRow("Home", Z_SIDEBAR_HOME, g.view.kind == PageKind::Home, 0);
    navRow("Top Charts", Z_SIDEBAR_RADIOTOP, g.view.kind == PageKind::Charts, 2);
    /* library header */
    y += 10;
    g_ui.IconLibrary(R(x + 8, y + 2, x + 32, y + 26), color::textSubdued);
    g_ui.Text("Your Library", R(x + 44, y + 4, x + w - 40, y + 26), 14, TW::SemiBold, color::textSubdued);
    DRect plus = R(x + w - 32, y, x + w - 4, y + 28);
    if (g.hoverZone == Z_SIDEBAR_NEWPL) g_ui.FillRounded(plus, 14, color::Alpha(color::white, 0.1f));
    g_ui.IconPlus(R(plus.left + 4, plus.top + 4, plus.right - 4, plus.bottom - 4), color::textSubdued);
    AddZone(plus, Z_SIDEBAR_NEWPL, 14);
    y += 38;
    /* Liked */
    {
        DRect row = R(x, y, x + w, y + 56);
        bool active = g.view.kind == PageKind::Liked;
        if (g.hoverZone == Z_LIB_LIKED) g_ui.FillRounded(row, 6, color::Alpha(color::white, 0.06f));
        DRect tile = R(x + 4, y + 6, x + 48, y + 50);
        g_ui.FillRounded(tile, 4, color::Hex(0x5038d3));
        g_ui.IconHeart(R(tile.left + 12, tile.top + 12, tile.right - 12, tile.bottom - 12), color::white, true);
        g_ui.Text("Liked Songs", R(x + 60, y + 8, x + w, y + 30), 14, TW::Regular, active ? color::green : color::textBase);
        g_ui.Text(std::to_string(Lib().liked.size()) + " songs", R(x + 60, y + 30, x + w, y + 48), 12, TW::Regular, color::textSubdued);
        AddZone(row, Z_LIB_LIKED, 6);
        y += 58;
    }
    /* user playlists */
    int zi = 0;
    for (auto& p : Lib().playlists) {
        if (y > area.bottom - 60) break;
        DRect row = R(x, y, x + w, y + 56);
        bool active = g.view.kind == PageKind::LocalPlaylist && g.view.id == p.id;
        if (g.hoverZone == Z_LIB_ROW + zi) g_ui.FillRounded(row, 6, color::Alpha(color::white, 0.06f));
        DRect tile = R(x + 4, y + 6, x + 48, y + 50);
        ID2D1Bitmap* bmp = p.tracks.empty() ? nullptr : g_ui.GetImage(p.tracks[0].artwork);
        if (bmp) g_ui.DrawBitmap(bmp, tile);
        else g_ui.FillRounded(tile, 4, color::elevatedHighlight);
        g_ui.Text(p.name, R(x + 60, y + 8, x + w, y + 30), 14, TW::Regular, active ? color::green : color::textBase);
        g_ui.Text("Playlist • " + std::to_string(p.tracks.size()) + " songs", R(x + 60, y + 30, x + w, y + 48), 12, TW::Regular, color::textSubdued);
        AddZone(row, Z_LIB_ROW + zi, 6);
        y += 58;
        zi++;
        if (zi > 40) break;
    }
    (void)Z_SIDEBAR_LIB;
}

/* source chips (settings + search page) */
static void PaintSourceChips(float x, float y) {
    struct Def { const char* label; const char* id; int zone; };
    Def defs[2] = {{"JioSaavn", api::kSaavn, Z_CHIP_SRC}, {"YouTube Music", api::kYtm, Z_CHIP_SRC2}};
    float cx = x;
    for (auto& d : defs) {
        float w = g_ui.TextWidth(d.label, 12, TW::SemiBold) + 26;
        DRect chip = R(cx, y, cx + w, y + 28);
        bool on = g.source == d.id;
        g_ui.FillRounded(chip, 14, on ? color::white : color::elevatedHighlight);
        g_ui.Text(d.label, chip, 12, TW::SemiBold, on ? color::black : color::textBase, true,
                  DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
        AddZone(chip, d.zone, 14);
        cx += w + 8;
    }
}

/* ════════════════ PAINT: pages ════════════════ */
static float PaintCardsRow(const std::vector<MediaItem>& items, float x, float y, float availW) {
    if (items.empty()) return y;
    float cardW = 168;
    int perRow = std::max(1, (int)((availW + 16) / (cardW + 16)));
    float usedW = perRow * cardW + (perRow - 1) * 16;
    (void)usedW;
    float cardH = cardW + 58;
    float cy = y;
    int idx = 0;
    for (size_t i = 0; i < items.size(); i++) {
        int col = idx % perRow;
        if (col == 0 && idx > 0) cy += cardH + 20;
        DRect card = R(x + col * (cardW + 16), cy, x + col * (cardW + 16) + cardW, cy + cardH);
        bool inBand = card.bottom > g_zoneBand.top && card.top < g_zoneBand.bottom;
        int zone = inBand ? 300 + (int)g_cardHits.size() : -1;
        if (inBand) g_cardHits.push_back(items[i]);
        bool hover = g.hoverZone == zone;
        g_ui.FillRounded(card, 6, hover ? color::elevatedPress : color::elevatedBase);
        bool circle = items[i].kind == MediaItem::Kind::Artist;
        PaintCardText(card, items[i], circle);
        /* green FAB bottom-right of cover (study: 48, translateY lift) */
        float artSide = cardW - 24;
        DRect cover = R(card.left + 12, card.top + 12, card.left + 12 + artSide, card.top + 12 + artSide);
        if (hover || (g.hasCurrent && items[i].kind == MediaItem::Kind::Track && g.current.id == items[i].track.id)) {
            float fab = (hover ? 48.0f : 40.0f);
            DRect fabR = R(cover.right - fab - 8, cover.bottom - fab - 8 + (hover ? 0 : 6), cover.right - 8, cover.bottom - 8 + (hover ? 0 : 6));
            g_ui.FillRounded(fabR, fab / 2, hover ? color::greenHover : color::green);
            if (g.hasCurrent && items[i].kind == MediaItem::Kind::Track && g.current.id == items[i].track.id && !g.paused)
                g_ui.IconPause(R(fabR.left + 12, fabR.top + 12, fabR.right - 12, fabR.bottom - 12), color::black);
            else
                g_ui.IconPlay(R(fabR.left + 12, fabR.top + 12, fabR.right - 12, fabR.bottom - 12), color::black);
        }
        if (inBand) AddZone(card, zone, 6);
        idx++;
    }
    return cy + cardH;
}

static float PaintSection(const Section& s, float x, float y, float availW) {
    if (s.items.empty()) return y;
    g_ui.Text(s.title, R(x, y, x + availW, y + 30), 20, TW::ExtraBold);
    y += 40;
    bool allTracks = true;
    for (auto& i : s.items) if (i.kind != MediaItem::Kind::Track) allTracks = false;
    if (allTracks && (g.view.kind == PageKind::Search || g.view.kind == PageKind::Home)) {
        std::vector<Track> ctx;
        for (auto& i : s.items) ctx.push_back(i.track);
        int idx = 0;
        for (auto& i : s.items) {
            DRect row = R(x, y, x + availW, y + kRowH);
            PaintTrackRow(row, i.track, idx, true, &ctx);
            y += kRowH;
            idx++;
            if (idx >= 100) break;
        }
        return y + 16;
    }
    float ny = PaintCardsRow(s.items, x, y, availW);
    return ny + 24;
}

static void PaintLoadingOrError(const DRect& area) {
    if (g.loading) {
        /* skeleton rows */
        float y = area.top + 24;
        for (int i = 0; i < 6 && y < area.bottom - 60; i++) {
            g_ui.FillRounded(R(area.left + 24, y, area.left + 72, y + 48), 4, color::elevatedHighlight);
            g_ui.FillRounded(R(area.left + 88, y + 8, area.left + 88 + 220 + (i % 3) * 60, y + 22), 6, color::elevatedHighlight);
            g_ui.FillRounded(R(area.left + 88, y + 28, area.left + 88 + 140 + (i % 2) * 40, y + 40), 6, color::elevatedBase);
            y += 64;
        }
        g_ui.Text("Loading...", R(area.left + 24, area.bottom - 40, area.right, area.bottom - 16), 13, TW::Regular, color::textSubdued);
        return;
    }
    if (!g.error.empty()) {
        float cy = (area.top + area.bottom) / 2;
        g_ui.Text("Kuch ghalat ho gaya", R(area.left, cy - 40, area.right, cy - 8), 20, TW::Bold, color::textBase, true);
        g_ui.Text(g.error, R(area.left + 60, cy, area.right - 60, cy + 60), 13, TW::Regular, color::textSubdued, true);
    }
}

static void PaintSearchPage(const DRect& area) {
    float x = area.left + 24;
    float availW = W(area) - 48;
    float y = area.top + 16 - g.scrollY;
    /* filter chips */
    struct F { const char* label; const char* id; int zone; };
    F fs[5] = {{"All", "all", Z_FILTER_ALL}, {"Songs", "track", Z_FILTER_SONG}, {"Albums", "album", Z_FILTER_ALBUM},
               {"Playlists", "playlist", Z_FILTER_PLAYLIST}, {"Artists", "artist", Z_FILTER_ARTIST}};
    float cx = x;
    float chipY = area.top + 12 - g.scrollY;
    for (auto& f : fs) {
        float w = g_ui.TextWidth(f.label, 12, TW::SemiBold) + 26;
        DRect chip = R(cx, chipY, cx + w, chipY + 28);
        bool on = g.view.filter == f.id;
        g_ui.FillRounded(chip, 14, on ? color::white : color::elevatedHighlight);
        g_ui.Text(f.label, chip, 12, TW::SemiBold, on ? color::black : color::textBase, true,
                  DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
        AddZone(chip, f.zone, 14);
        cx += w + 8;
    }
    PaintSourceChips(cx + 16, chipY);
    y = chipY + 44;
    if (g.view.query.empty()) {
        g_ui.Text("Search karo — gaane, album, artist...", R(x, y + 20, x + availW, y + 50), 15, TW::Regular, color::textSubdued);
        return;
    }
    if (g.loading || !g.error.empty()) { PaintLoadingOrError(R(area.left, y, area.right, area.bottom)); return; }
    if (g.view.filter == "track") {
        g_ui.Text("Songs", R(x, y, x + availW, y + 30), 20, TW::ExtraBold);
        y += 40;
        int idx = 0;
        for (auto& t : g.search.tracks) { PaintTrackRow(R(x, y, x + availW, y + kRowH), t, idx, true, &g.search.tracks); y += kRowH; idx++; }
    } else if (g.view.filter == "album" || g.view.filter == "playlist" || g.view.filter == "artist") {
        std::vector<MediaItem> items;
        if (g.view.filter == "album") for (auto& a : g.search.albums) items.push_back({MediaItem::Kind::Album, {}, a});
        if (g.view.filter == "playlist") for (auto& p : g.search.playlists) items.push_back({MediaItem::Kind::Playlist, {}, {}, p});
        if (g.view.filter == "artist") for (auto& a : g.search.artists) items.push_back({MediaItem::Kind::Artist, {}, {}, {}, a});
        y = PaintCardsRow(items, x, y, availW) + 8;
    } else {
        for (auto& s : g.sections) y = PaintSection(s, x, y, availW);
        if (g.sections.empty()) g_ui.Text("Koi result nahi mila", R(x, y, x + availW, y + 30), 15, TW::Regular, color::textSubdued);
    }
    g_contentH = y + g.scrollY - area.top + 24;
}

static void PaintHomePage(const DRect& area) {
    float x = area.left + 24;
    float availW = W(area) - 48;
    float y = area.top + 16 - g.scrollY;
    /* greeting (study: 32/800) */
    SYSTEMTIME st; GetLocalTime(&st);
    const char* greet = st.wHour < 12 ? "Good morning" : st.wHour < 17 ? "Good afternoon" : "Good evening";
    g_ui.Text(greet, R(x, y, x + availW, y + 40), 30, TW::ExtraBold);
    y += 56;
    PaintSourceChips(x, y);
    y += 44;
    if ((g.loading || !g.error.empty()) && g.sections.empty()) { PaintLoadingOrError(R(area.left, y, area.right, area.bottom)); return; }
    /* recently played quick cards (data ho to) */
    if (!Lib().recent.empty()) {
        g_ui.Text("Recently played", R(x, y, x + availW, y + 30), 20, TW::ExtraBold);
        y += 40;
        int idx = 0;
        for (auto& t : Lib().recent) {
            if (idx >= 5) break;
            PaintTrackRow(R(x, y, x + availW, y + kRowH), t, idx, true, &Lib().recent);
            y += kRowH; idx++;
        }
        y += 16;
    }
    for (auto& s : g.sections) y = PaintSection(s, x, y, availW);
    if (!g.loading && g.sections.empty() && g.error.empty())
        g_ui.Text("Sections load nahi huay — source switch karke dekho (upar chips).", R(x, y, x + availW, y + 30), 14, TW::Regular, color::textSubdued);
    g_contentH = y + g.scrollY - area.top + 24;
}

/* detail pages: album/playlist/chart + liked + local (ek hi tracklist template) */
static void PaintDetailPage(const DRect& area) {
    bool liked = g.view.kind == PageKind::Liked;
    bool local = g.view.kind == PageKind::LocalPlaylist;
    if (g.loading && !g.view.title.empty() && !liked && !local) {
        /* loading ke dauran pichle page ka title na dikhe */
        std::string artLoad;
        g_ui.FillRect(R(area.left, area.top, area.right, area.top + 232), color::Hex(0x1c1c1c));
        g_ui.Text(g.view.title, R(area.left + 24, area.top + 120, area.right - 24, area.top + 168), 34, TW::Black);
        g_ui.Text("Loading...", R(area.left + 24, area.top + 176, area.right - 24, area.top + 200), 13, TW::Regular, color::textSubdued);
        g_contentH = 320;
        return;
    }
    std::string title = liked ? "Liked Songs" : local ? (Lib().FindPlaylist(g.view.id) ? Lib().FindPlaylist(g.view.id)->name : std::string("Playlist"))
                          : !g.playlist.title.empty() ? g.playlist.title : g.album.title;
    std::string sub = liked ? "Your liked tracks" : local ? "Local playlist" : !g.playlist.title.empty() ? (!g.playlist.author.empty() ? g.playlist.author : std::string("Playlist")) : g.album.ArtistText();
    std::string art = liked ? "" : local ? (g.listTracks.empty() ? "" : g.listTracks[0].artwork) : !g.playlist.artwork.empty() ? g.playlist.artwork : g.album.artwork;
    if (liked && g.album.id.empty() && g.playlist.id.empty()) { /* hero tint default */ }
    float x = area.left + 24;
    float availW = W(area) - 48;
    float heroH = 232;
    /* hero gradient: tint -> base (Liked/local fixed tints) */
    D2D1_COLOR_F tint = liked ? color::Hex(0x342a86) : local ? color::Hex(0x274058) : g.detailTint;
    g_ui.FillRect(R(area.left, area.top, area.right, area.top + heroH), tint);
    g_ui.FillRect(R(area.left, area.top + heroH - 90, area.right, area.top + heroH), color::Alpha(color::base, 0.55f));
    g_ui.FillRect(R(area.left, area.top + heroH - 45, area.right, area.top + heroH), color::Alpha(color::base, 0.85f));
    float y = area.top + 20 - std::min(g.scrollY, heroH * 0.4f);
    DRect cover = R(x, y + 12, x + 184, y + 196);
    if (liked) {
        g_ui.FillRounded(cover, 4, color::Hex(0x5038d3));
        g_ui.IconHeart(R(cover.left + 62, cover.top + 62, cover.right - 62, cover.bottom - 62), color::white, true);
    } else {
        ID2D1Bitmap* bmp = g_ui.GetImage(art);
        if (bmp) g_ui.DrawBitmap(bmp, cover);
        else g_ui.FillRounded(cover, 4, color::elevatedHighlight);
    }
    float tx = x + 208;
    g_ui.Text(liked || local ? "Playlist" : (!g.playlist.title.empty() ? "Playlist" : "Album"),
              R(tx, y + 84, area.right - 24, y + 104), 12, TW::SemiBold);
    g_ui.Text(title, R(tx, y + 106, area.right - 24, y + 170), 40, TW::Black);
    std::string meta = sub;
    if (!liked && !local) {
        if (!g.album.year.empty()) meta = g.album.year + " • " + meta;
        meta += " • " + std::to_string(g.listTracks.size()) + " songs";
    } else meta += " • " + std::to_string(g.listTracks.size()) + " songs";
    g_ui.Text(meta, R(tx, y + 172, area.right - 24, y + 194), 13, TW::Regular, color::textSubdued);
    /* sticky condensed header (scroll > hero ka 64%) */
    if (g.scrollY > heroH * 0.64f) {
        g_ui.FillRect(R(area.left, area.top, area.right, area.top + 64), Darken(tint, 0.56f));
        ID2D1Bitmap* bmp = g_ui.GetImage(art);
        DRect sm = R(area.left + 16, area.top + 8, area.left + 56, area.top + 48);
        if (liked) { g_ui.FillRounded(sm, 4, color::Hex(0x5038d3)); }
        else if (bmp) g_ui.DrawBitmap(bmp, sm);
        else g_ui.FillRounded(sm, 4, color::elevatedHighlight);
        g_ui.Text(title, R(area.left + 68, area.top + 16, area.right - 130, area.top + 48), 20, TW::ExtraBold);
        DRect fab = R(area.right - 108, area.top + 8, area.right - 60, area.top + 56);
        g_ui.FillRounded(fab, 24, color::green);
        bool thisPlaying = g.hasCurrent && !g.listTracks.empty() && g.current.id == g.listTracks[0].id && !g.paused;
        if (thisPlaying) g_ui.IconPause(R(fab.left + 13, fab.top + 13, fab.right - 13, fab.bottom - 13), color::black);
        else g_ui.IconPlay(R(fab.left + 13, fab.top + 13, fab.right - 13, fab.bottom - 13), color::black);
        AddZone(fab, Z_HERO_PLAY, 24);
    }
    /* actions row */
    float ay = area.top + heroH + 16 - g.scrollY;
    DRect fab = R(x, ay, x + 56, ay + 56);
    g_ui.FillRounded(fab, 28, g.hoverZone == Z_HERO_PLAY ? color::greenHover : color::green);
    bool listPlaying = false;
    if (g.hasCurrent) for (auto& t : g.listTracks) (g.current.id == t.id) && (listPlaying = !g.paused);
    if (listPlaying) g_ui.IconPause(R(fab.left + 16, fab.top + 16, fab.right - 16, fab.bottom - 16), color::black);
    else g_ui.IconPlay(R(fab.left + 16, fab.top + 16, fab.right - 16, fab.bottom - 16), color::black);
    AddZone(fab, Z_HERO_PLAY, 28);
    DRect heart = R(x + 76, ay + 12, x + 108, ay + 44);
    bool collLiked = false;
    g_ui.IconHeart(heart, collLiked ? color::green : color::textSubdued, collLiked);
    /* collection like sirf visual toggle (tracks like asaan) */
    float rowsY = ay + 76;
    /* columns header */
    g_ui.Text("#", R(x + 4, rowsY, x + 34, rowsY + 20), 12, TW::Regular, color::textSubdued, true);
    g_ui.Text("Title", R(x + 96, rowsY, x + 300, rowsY + 20), 12, TW::Regular, color::textSubdued);
    g_ui.Text("Album", R(x + availW * 0.52f, rowsY, x + availW, rowsY + 20), 12, TW::Regular, color::textSubdued);
    g_ui.Text("Duration", R(x + availW - 96, rowsY, x + availW, rowsY + 20), 12, TW::Regular, color::textSubdued);
    rowsY += 26;
    g_ui.FillRect(R(x, rowsY - 4, x + availW, rowsY - 3), color::Alpha(color::white, 0.12f));
    if (g.loading || !g.error.empty()) { PaintLoadingOrError(R(area.left, rowsY + 8, area.right, area.bottom)); return; }
    if (g.listTracks.empty()) {
        g_ui.Text(local ? "Abhi koi gaana nahi — kisi track ke ••• menu se \"Add to playlist\" karo." : "Yahan koi track nahi mila.",
                  R(x, rowsY + 16, x + availW, rowsY + 44), 14, TW::Regular, color::textSubdued);
    }
    int idx = 0;
    for (auto& t : g.listTracks) {
        float ry = rowsY + idx * kRowH;
        if (ry > area.bottom + 60) break;
        PaintTrackRow(R(x, ry, x + availW, ry + kRowH), t, idx, true, &g.listTracks);
        idx++;
    }
    g_contentH = rowsY + (float)g.listTracks.size() * kRowH - area.top + 40;
}

static void PaintArtistPage(const DRect& area) {
    float x = area.left + 24;
    float availW = W(area) - 48;
    float heroH = 260;
    g_ui.FillRect(R(area.left, area.top, area.right, area.top + heroH), g.detailTint);
    g_ui.FillRect(R(area.left, area.top + heroH - 80, area.right, area.top + heroH), color::Alpha(color::base, 0.6f));
    float y = area.top + 24 - std::min(g.scrollY, heroH * 0.3f);
    DRect art = R(x, y, x + 168, y + 168);
    ID2D1Bitmap* bmp = g_ui.GetImage(g.artist.artwork);
    if (bmp) { DRect clip = art; g_ui.DrawBitmap(bmp, art, &clip); }
    else g_ui.FillRounded(art, 84, color::elevatedHighlight);
    g_ui.Text("Artist", R(x + 192, y + 58, area.right - 24, y + 78), 12, TW::SemiBold);
    g_ui.Text(g.artist.name, R(x + 192, y + 80, area.right - 24, y + 140), 38, TW::Black);
    g_ui.Text(g.artist.subtitle, R(x + 192, y + 142, area.right - 24, y + 164), 13, TW::Regular, color::textSubdued);
    if (g.loading || !g.error.empty()) { PaintLoadingOrError(R(area.left, area.top + heroH + 16, area.right, area.bottom)); return; }
    float cy = area.top + heroH + 20 - g.scrollY;
    DRect fab = R(x, cy, x + 56, cy + 56);
    g_ui.FillRounded(fab, 28, g.hoverZone == Z_HERO_PLAY ? color::greenHover : color::green);
    g_ui.IconPlay(R(fab.left + 16, fab.top + 16, fab.right - 16, fab.bottom - 16), color::black);
    AddZone(fab, Z_HERO_PLAY, 28);
    cy += 76;
    if (!g.artist.topTracks.empty()) {
        g_ui.Text("Popular", R(x, cy, x + availW, cy + 30), 20, TW::ExtraBold);
        cy += 40;
        int idx = 0;
        for (auto& t : g.artist.topTracks) { PaintTrackRow(R(x, cy, x + availW, cy + kRowH), t, idx, true, &g.artist.topTracks); cy += kRowH; idx++; }
        cy += 12;
    }
    if (!g.artist.albums.empty()) {
        g_ui.Text("Albums", R(x, cy, x + availW, cy + 30), 20, TW::ExtraBold);
        cy += 40;
        std::vector<MediaItem> items;
        for (auto& a : g.artist.albums) items.push_back({MediaItem::Kind::Album, {}, a});
        cy = PaintCardsRow(items, x, cy, availW) + 12;
    }
    if (!g.artist.bio.empty()) {
        g_ui.Text("About", R(x, cy, x + availW, cy + 30), 20, TW::ExtraBold);
        cy += 38;
        g_ui.TextMulti(g.artist.bio, R(x, cy, x + std::min(availW, 640.0f), cy + 120), 13, TW::Regular, color::textSubdued, 18);
        cy += 110;
    }
    g_contentH = cy - area.top + 40;
}

static void PaintChartsPage(const DRect& area) {
    float x = area.left + 24;
    float availW = W(area) - 48;
    float y = area.top + 16 - g.scrollY;
    g_ui.Text("Charts", R(x, y, x + availW, y + 36), 30, TW::ExtraBold);
    y += 52;
    PaintSourceChips(x, y);
    y += 44;
    if (g.loading || !g.error.empty()) { PaintLoadingOrError(R(area.left, y, area.right, area.bottom)); return; }
    std::vector<MediaItem> items;
    for (auto& p : g.chartsCache) items.push_back({MediaItem::Kind::Playlist, {}, {}, p});
    y = PaintCardsRow(items, x, y, availW);
    g_contentH = y - area.top + 40;
}

static void PaintSettingsPage(const DRect& area) {
    float x = area.left + 24;
    float availW = std::min(W(area) - 48, 720.0f);
    float y = area.top + 16 - g.scrollY;
    g_ui.Text("Settings", R(x, y, x + availW, y + 36), 30, TW::ExtraBold);
    y += 60;
    g_ui.Text("Music source", R(x, y, x + availW, y + 24), 15, TW::Bold);
    y += 30;
    PaintSourceChips(x, y);
    y += 48;
    g_ui.Text("JioSaavn = fast streams, YouTube Music = sab se bara catalog. Source badalne par home dobara load hota hai.",
              R(x, y, x + availW, y + 40), 13, TW::Regular, color::textSubdued);
    y += 60;
    g_ui.Text("Data", R(x, y, x + availW, y + 24), 15, TW::Bold);
    y += 30;
    g_ui.Text("Liked songs, playlists aur recents tumhare PC par rehte hain (%LOCALAPPDATA%\\Bloomee).",
              R(x, y, x + availW, y + 24), 13, TW::Regular, color::textSubdued);
    y += 44;
    DRect btn = R(x, y, x + 190, y + 36);
    g_ui.FillRounded(btn, 18, color::elevatedHighlight);
    g_ui.Text("Logs folder kholo", btn, 13, TW::SemiBold, color::textBase, true, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
    AddZone(btn, Z_SETTINGS_ABOUT, 18);
    g_contentH = 460;
}

/* synced lyrics line index (study: line-based, ±120ms lag compensation) */
static int ActiveLyricLine(int64_t posMs) {
    int idx = -1;
    for (size_t i = 0; i < g.lyrics.lines.size(); i++)
        if (g.lyrics.lines[i].first <= posMs + 120) idx = (int)i; else break;
    return idx;
}

static void PaintLyricsPanel(const DRect& area) {
    LoadLyricsIfNeeded();
    g_ui.FillRect(area, color::elevatedBase);
    float y = area.top + 52;
    if (!g.hasCurrent) { g_ui.Text("Kuch chalao, lyrics yahan aayenge.", R(area.left + 16, y, area.right - 16, y + 40), 13, TW::Regular, color::textSubdued); return; }
    if (g.lyricsLoading) { g_ui.Text("Lyrics dhoondh rahe hain...", R(area.left + 16, y, area.right - 16, y + 40), 13, TW::Regular, color::textSubdued); return; }
    if (!g.lyricsLoaded || (g.lyrics.lines.empty() && g.lyrics.plain.empty())) {
        g_ui.Text("Is gaane ke lyrics nahi mile.", R(area.left + 16, y, area.right - 16, y + 40), 13, TW::Regular, color::textSubdued);
        return;
    }
    if (!g.lyrics.synced) {
        float ly = area.top + 56 - (g.lyricsScroll);
        for (auto& line : Split(g.lyrics.plain, "\n")) {
            if (ly > area.top + 48 && ly < area.bottom - 10)
                g_ui.Text(line, R(area.left + 16, ly, area.right - 16, ly + 20), 13, TW::SemiBold);
            ly += 22;
        }
        return;
    }
    int64_t posMs = (int64_t)(g.displayPos * 1000);
    int active = ActiveLyricLine(posMs);
    const float lineH = 30;
    float centerY = (area.top + area.bottom) / 2;
    if (!g.lyricsUserScroll && active >= 0) {
        g.lyricsTarget = active * lineH;
    }
    float base = centerY - g.lyricsScroll;
    int i = 0;
    for (auto& [ms, text] : g.lyrics.lines) {
        float ly = base + i * lineH;
        if (ly > area.top + 44 && ly < area.bottom - 16) {
            bool on = i == active;
            float dist = std::fabs(ly - centerY);
            float alpha = std::max(0.35f, 1.0f - dist / 260.0f);
            g_ui.Text(text.empty() ? "..." : text, R(area.left + 16, ly, area.right - 16, ly + 28),
                      on ? 15.0f : 13.5f, on ? TW::ExtraBold : TW::SemiBold,
                      on ? color::white : color::Alpha(color::white, alpha));
        }
        i++;
    }
    /* click-to-seek zones overlay: active line index mapping paint se click mein */
    (void)active;
}
