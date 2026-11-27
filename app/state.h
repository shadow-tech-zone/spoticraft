/* Local library: %LOCALAPPDATA%\Bloomee\library.json
   liked songs, playlists, recents (max 50), settings. */
#pragma once
#include "model.h"

struct Library {
    std::vector<Track> liked;
    struct LocalPlaylist {
        std::string id, name;
        std::vector<Track> tracks;
    };
    std::vector<LocalPlaylist> playlists;
    std::vector<Track> recent;   // newest pehle
    std::string lastTrackJson;   // last played snapshot (restore)
    bool shuffle = false, repeatAll = false, repeatOne = false;
    float volume = 0.75f;

    bool IsLiked(const std::string& trackId) const;
    void ToggleLike(const Track& t);
    void TouchRecent(const Track& t);
    LocalPlaylist& NewPlaylist(const std::string& name);
    bool RenamePlaylist(const std::string& id, const std::string& name);
    bool DeletePlaylist(const std::string& id);
    bool AddToPlaylist(const std::string& pid, const Track& t);
    bool RemoveFromPlaylist(const std::string& pid, const std::string& trackId);
    LocalPlaylist* FindPlaylist(const std::string& id);
    const LocalPlaylist* FindPlaylist(const std::string& id) const;

    void Load();
    void Save() const;
};

inline Library& Lib() { static Library lib; return lib; }
J TrackToJ(const Track& t);
Track TrackFromJ(const J& j);
