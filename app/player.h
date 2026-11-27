/* Playback: Media Foundation SourceReader -> PCM -> WASAPI shared.
   Events UI ko PostMessage se jate hain (thread-safe). */
#pragma once
#include <windows.h>

#include <atomic>
#include <cstdint>
#include <string>
#include <thread>

constexpr UINT WM_APP_PLAYER = WM_APP + 50;  // wp: 1=playing 2=ended 3=error

class Player {
public:
    void Init();
    void Shutdown();
    void Play(const std::string& url);
    void SetPaused(bool paused);
    bool IsPaused() const { return m_paused.load(); }
    bool IsPlaying() const { return m_playing.load(); }
    bool HasMedia() const { return m_hasMedia.load(); }
    /** join=true sirf shutdown par; warna reaper thread purana feed band karta hai
        (sync ReadSample network par atka ho to UI hang na ho). */
    void Stop(bool join = false);
    void Seek(double seconds);
    void SetVolume(float v01);
    double Position() const { return m_position.load(); }
    double Duration() const { return m_duration.load(); }

private:
    void LoadThread(std::string url, int gen);
    void FeedLoop(int gen);
    bool EnsureWasapi();
    void ReleaseAll();

    std::atomic<bool> m_playing{false}, m_paused{false}, m_hasMedia{false};
    std::atomic<double> m_position{0}, m_duration{0}, m_positionBase{0};
    std::atomic<int> m_gen{0};
    std::atomic<float> m_volume{0.75f};
    std::thread m_thread;
    void* m_reader = nullptr;       // IMFSourceReader*
    void* m_device = nullptr;       // IMMDevice*
    void* m_audioClient = nullptr;  // IAudioClient*
    void* m_render = nullptr;       // IAudioRenderClient*
    void* m_clock = nullptr;        // IAudioClock*
    uint32_t m_bufferFrames = 0;
    uint32_t m_sampleRate = 44100;
    int m_started = 0;              // MFStartup refcount guard
};
