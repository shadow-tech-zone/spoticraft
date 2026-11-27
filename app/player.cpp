/* MF SourceReader (AAC/MP3/HTTP) -> float32 PCM.
   MF apna async HTTP + buffering + resample khud karta hai (QA doc §3.5). */
#include "player.h"
#include "common.h"

#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>

#define COM_GUID(g) __uuidof(g)
static const GUID CLSID_MMDeviceEnumerator_ = COM_GUID(MMDeviceEnumerator);
static const GUID IID_IMMDeviceEnumerator_ = COM_GUID(IMMDeviceEnumerator);
static const GUID IID_IAudioClient_ = COM_GUID(IAudioClient);
static const GUID IID_IAudioRenderClient_ = COM_GUID(IAudioRenderClient);
static const GUID IID_IAudioClock_ = COM_GUID(IAudioClock);

template <typename T> static void Rel(T*& p) { if (p) { p->Release(); p = nullptr; } }

static bool ToMillis(const PROPVARIANT& v, double& ms) {
    if (v.vt != VT_I8) return false;
    ms = v.hVal.QuadPart / 10000.0;
    return true;
}

void Player::Init() {
    if (m_started) return;
    if (SUCCEEDED(MFStartup(MF_VERSION))) m_started = 1;
}

void Player::Shutdown() {
    Stop(true);
    ReleaseAll();
    if (m_started) { MFShutdown(); m_started = 0; }
}

void Player::ReleaseAll() {
    Rel((IMFSourceReader*&)m_reader);
    Rel((IAudioRenderClient*&)m_render);
    Rel((IAudioClock*&)m_clock);
    if (m_audioClient) { ((IAudioClient*)m_audioClient)->Stop(); Rel((IAudioClient*&)m_audioClient); }
    Rel((IMMDevice*&)m_device);
}

void Player::Stop(bool join) {
    m_gen++;
    if (m_thread.joinable()) {
        if (join) m_thread.join();
        else {
            /* purana thread gen mismatch par khud niklega; ReadSample atka
               ho to bhi UI aage badhe */
            std::thread old = std::move(m_thread);
            std::thread([o = std::move(old)]() mutable { o.join(); }).detach();
        }
    }
    m_playing = false; m_paused = false; m_hasMedia = false;
    m_position = 0; m_duration = 0; m_positionBase = 0;
}

void Player::Play(const std::string& url) {
    Stop();
    int gen = ++m_gen;
    m_thread = std::thread([this, url, gen] { LoadThread(url, gen); });
}

void Player::LoadThread(std::string url, int gen) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    IMFSourceReader* reader = nullptr;
    IMFAttributes* attrs = nullptr;
    MFCreateAttributes(&attrs, 1);
    if (attrs) attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
    HRESULT hr = MFCreateSourceReaderFromURL(Widen(url).c_str(), attrs, &reader);
    if (attrs) attrs->Release();
    if (FAILED(hr) || !reader) {
        LogLine("MF open fail: " + url.substr(0, 120));
        if (gen == m_gen.load()) PostMessageW(g_mainWnd, WM_APP_PLAYER, 3, 0);
        CoUninitialize();
        return;
    }
    /* PCM float output mangta (decoder + resampler MF khud lagayega) */
    IMFMediaType* type = nullptr;
    MFCreateMediaType(&type);
    type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
    hr = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, type);
    type->Release();
    if (FAILED(hr)) {
        LogLine("MF pcm type fail");
        reader->Release();
        PostMessageW(g_mainWnd, WM_APP_PLAYER, 3, 0);
        CoUninitialize();
        return;
    }
    /* duration */
    PROPVARIANT dur;
    PropVariantInit(&dur);
    if (SUCCEEDED(reader->GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE, MF_PD_DURATION, &dur))) {
        double ms; if (ToMillis(dur, ms)) m_duration = ms / 1000.0;
    }
    PropVariantClear(&dur);
    m_reader = reader;
    m_hasMedia = true;
    if (!EnsureWasapi()) {
        m_reader = nullptr;
        reader->Release();
        PostMessageW(g_mainWnd, WM_APP_PLAYER, 3, 0);
        CoUninitialize();
        return;
    }
    IAudioClient* ac = (IAudioClient*)m_audioClient;
    if (FAILED(ac->Start())) {
        m_reader = nullptr;
        reader->Release();
        PostMessageW(g_mainWnd, WM_APP_PLAYER, 3, 0);
        CoUninitialize();
        return;
    }
    m_playing = true; m_paused = false;
    PostMessageW(g_mainWnd, WM_APP_PLAYER, 1, 0);
    FeedLoop(gen);
    /* apna reader khud release; naya load chal raha ho to m_reader us ka hai */
    if (m_reader == reader) m_reader = nullptr;
    reader->Release();
}

bool Player::EnsureWasapi() {
    if (m_audioClient) return true;
    IMMDeviceEnumerator* en = nullptr;
    if (FAILED(CoCreateInstance(CLSID_MMDeviceEnumerator_, nullptr, CLSCTX_ALL,
                                IID_IMMDeviceEnumerator_, (void**)&en))) return false;
    IMMDevice* dev = nullptr;
    HRESULT hr = en->GetDefaultAudioEndpoint(eRender, eConsole, &dev);
    en->Release();
    if (FAILED(hr)) return false;
    IAudioClient* ac = nullptr;
    hr = dev->Activate(IID_IAudioClient_, CLSCTX_ALL, nullptr, (void**)&ac);
    if (FAILED(hr)) { dev->Release(); return false; }
    /* fix 44.1k float32 stereo mix format (simple + reliable) */
    WAVEFORMATEX wfx{};
    wfx.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    wfx.nChannels = 2;
    wfx.nSamplesPerSec = 44100;
    wfx.wBitsPerSample = 32;
    wfx.nBlockAlign = 8;
    wfx.nAvgBytesPerSec = 44100 * 8;
    hr = ac->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 10000000 /*1s*/, 0, &wfx, nullptr);
    if (FAILED(hr)) {
        /* device default mix format fallback */
        WAVEFORMATEX* mix = nullptr;
        if (FAILED(ac->GetMixFormat(&mix))) { ac->Release(); dev->Release(); return false; }
        hr = ac->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 10000000, 0, mix, nullptr);
        if (mix) { m_sampleRate = mix->nSamplesPerSec; CoTaskMemFree(mix); }
        if (FAILED(hr)) { ac->Release(); dev->Release(); return false; }
    }
    IAudioRenderClient* rc = nullptr;
    IAudioClock* clock = nullptr;
    ac->GetService(IID_IAudioRenderClient_, (void**)&rc);
    ac->GetService(IID_IAudioClock_, (void**)&clock);
    ac->GetBufferSize(&m_bufferFrames);
    m_device = dev; m_audioClient = ac; m_render = rc; m_clock = clock;
    return rc != nullptr;
}

void Player::FeedLoop(int gen) {
    IMFSourceReader* reader = (IMFSourceReader*)m_reader;
    IAudioRenderClient* rc = (IAudioRenderClient*)m_render;
    IAudioClock* clock = (IAudioClock*)m_clock;
    uint64_t freq = 1;
    if (clock) clock->GetFrequency(&freq);
    bool ended = false;
    while (gen == m_gen.load()) {
        if (m_paused.load()) { Sleep(25); continue; }
        UINT32 padding = 0;
        IAudioClient* ac = (IAudioClient*)m_audioClient;
        if (!ac || FAILED(ac->GetCurrentPadding(&padding))) break;
        UINT32 space = m_bufferFrames > padding ? m_bufferFrames - padding : 0;
        if (space < 1024) { Sleep(5); continue; }
        DWORD flags = 0;
        IMFSample* sample = nullptr;
        LONGLONG ts = 0;
        HRESULT hr = reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0,
                                        nullptr, &flags, &ts, &sample);
        if (FAILED(hr)) break;
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) { ended = true; break; }
        if (!sample) { Sleep(3); continue; }
        IMFMediaBuffer* buf = nullptr;
        if (SUCCEEDED(sample->ConvertToContiguousBuffer(&buf))) {
            BYTE* data = nullptr; DWORD cur = 0;
            if (SUCCEEDED(buf->Lock(&data, nullptr, &cur))) {
                UINT32 frames = cur / 8;  /* float32 stereo */
                /* jagah bane tak wait — sample truncate = audio drop */
                for (int w = 0; frames > space && w < 40 && gen == m_gen.load(); w++) {
                    UINT32 pad = 0;
                    if (FAILED(ac->GetCurrentPadding(&pad))) break;
                    space = m_bufferFrames > pad ? m_bufferFrames - pad : 0;
                    if (frames > space) Sleep(5);
                }
                if (frames > space) frames = space;
                BYTE* dest = nullptr;
                if (SUCCEEDED(rc->GetBuffer(frames, &dest))) {
                    float vol = m_volume.load();
                    const float* in = (const float*)data;
                    float* o = (float*)dest;
                    for (UINT32 i = 0; i < frames * 2; i++) o[i] = in[i] * vol;
                    rc->ReleaseBuffer(frames, 0);
                }
                buf->Unlock();
            }
            buf->Release();
        }
        sample->Release();
        /* position audio clock se (gapless/correct reporting) */
        if (clock && freq) {
            UINT64 played = 0;
            if (SUCCEEDED(clock->GetPosition(&played, nullptr)))
                m_position = m_positionBase.load() + (double)played / (double)freq;
        }
    }
    if (ended && gen == m_gen.load()) {
        /* buffer drain ka intezar */
        for (int i = 0; i < 200 && gen == m_gen.load(); i++) {
            UINT32 pad = 0;
            if (!m_audioClient ||
                FAILED(((IAudioClient*)m_audioClient)->GetCurrentPadding(&pad)) || pad == 0) break;
            Sleep(10);
        }
        m_playing = false;
        PostMessageW(g_mainWnd, WM_APP_PLAYER, 2, 0);
    }
    CoUninitialize();
}

void Player::SetPaused(bool paused) {
    m_paused = paused;
    if (m_audioClient) {
        if (paused) ((IAudioClient*)m_audioClient)->Stop();
        else ((IAudioClient*)m_audioClient)->Start();
    }
}

void Player::Seek(double seconds) {
    if (!m_reader) return;
    PROPVARIANT v;
    PropVariantInit(&v);
    v.vt = VT_I8;
    v.hVal.QuadPart = (LONGLONG)(seconds * 10000000.0);
    ((IMFSourceReader*)m_reader)->SetCurrentPosition(GUID_NULL, v);
    PropVariantClear(&v);
    m_position = seconds;
    m_positionBase = seconds;
    /* WASAPI stop/start se position stream fresh hota hai; tick UI fir
       m_position (seek base) ko follow karta hai. */
    if (m_audioClient && !m_paused.load()) {
        ((IAudioClient*)m_audioClient)->Stop();
        ((IAudioClient*)m_audioClient)->Reset();
        ((IAudioClient*)m_audioClient)->Start();
    }
}

void Player::SetVolume(float v01) { m_volume = v01 < 0 ? 0 : v01 > 1 ? 1 : v01; }
