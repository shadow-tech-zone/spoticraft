/* UI primitives — Direct2D/DirectWrite/D2D custom controls.
   Study doc ke tokens/measures hi source of truth hain. */
#pragma once
#include <d2d1.h>
#include <dwrite.h>
#include <wincodec.h>

#include <string>
#include <unordered_map>
#include <vector>

#include "common.h"

/* Encore tokens (study §1) */
namespace color {
inline D2D1_COLOR_F C(float r, float g, float b, float a = 1.0f) { return {r, g, b, a}; }
inline D2D1_COLOR_F Hex(uint32_t rgb, float a = 1.0f) {
    return {((rgb >> 16) & 255) / 255.0f, ((rgb >> 8) & 255) / 255.0f, (rgb & 255) / 255.0f, a};
}
const D2D1_COLOR_F base = Hex(0x121212);
const D2D1_COLOR_F elevatedBase = Hex(0x1a1a1a);
const D2D1_COLOR_F elevatedHighlight = Hex(0x1f1f1f);
const D2D1_COLOR_F elevatedPress = Hex(0x191919);
const D2D1_COLOR_F subdued = Hex(0x2a2a2a);
const D2D1_COLOR_F sidebarBg = Hex(0x000000);
const D2D1_COLOR_F textBase = Hex(0xffffff);
const D2D1_COLOR_F textSubdued = Hex(0xb3b3b3);
const D2D1_COLOR_F textAnnouncement = Hex(0x1ed760);
const D2D1_COLOR_F green = Hex(0x1ed760);
const D2D1_COLOR_F greenHover = Hex(0x1fdf64);
const D2D1_COLOR_F greenPress = Hex(0x169c46);
const D2D1_COLOR_F black = Hex(0x000000);
const D2D1_COLOR_F sliderTrack = Hex(0x4d4d4d);
const D2D1_COLOR_F danger = Hex(0xeb6770);
const D2D1_COLOR_F white = Hex(0xffffff);
inline D2D1_COLOR_F Alpha(const D2D1_COLOR_F& c, float a) { auto r = c; r.a = a; return r; }
}  // namespace color

using DRect = D2D1_RECT_F;
inline DRect R(float l, float t, float r, float b) { return {l, t, r, b}; }
inline bool PtIn(const DRect& r, float x, float y) { return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }
inline float W(const DRect& r) { return r.right - r.left; }
inline float H(const DRect& r) { return r.bottom - r.top; }

struct ClickZone {
    DRect rect;
    int id;
    float radius = 0;
};

/* Text: Montserrat families (embedded), weights 400/600/700/800/900 */
enum class TW { Regular = 400, SemiBold = 600, Bold = 700, ExtraBold = 800, Black = 900 };

class Renderer {
public:
    bool Init(HWND hwnd);
    void Shutdown();
    void Resize(int w, int h);
    void Begin();
    void End();

    ID2D1RenderTarget* RT() { return m_rt; }
    int Wd() const { return m_w; }
    int Ht() const { return m_h; }

    void FillRect(const DRect& r, const D2D1_COLOR_F& c);
    void FillRounded(const DRect& r, float radius, const D2D1_COLOR_F& c);
    void StrokeRounded(const DRect& r, float radius, const D2D1_COLOR_F& c, float w = 1.0f);
    void DrawBitmap(ID2D1Bitmap* bmp, const DRect& dest, const DRect* roundedClip = nullptr, float opacity = 1.0f);
    ID2D1Bitmap* BitmapFromMemory(const uint8_t* data, size_t size);

    void Text(const std::string& s, const DRect& r, float size, TW weight = TW::Regular,
              const D2D1_COLOR_F& col = color::textBase, bool center = false,
              DWRITE_TEXT_ALIGNMENT align = DWRITE_TEXT_ALIGNMENT_LEADING,
              DWRITE_PARAGRAPH_ALIGNMENT valign = DWRITE_PARAGRAPH_ALIGNMENT_NEAR,
              bool ellipsis = true, float lineSpacing = 0);
    void TextMulti(const std::string& s, const DRect& r, float size, TW weight,
                   const D2D1_COLOR_F& col, float lineSpacing);
    float TextWidth(const std::string& s, float size, TW weight = TW::Regular);

    /* icons (vector paths) */
    void IconPlay(const DRect& r, const D2D1_COLOR_F& c);
    void IconPause(const DRect& r, const D2D1_COLOR_F& c);
    void IconPrev(const DRect& r, const D2D1_COLOR_F& c);
    void IconNext(const DRect& r, const D2D1_COLOR_F& c);
    void IconHeart(const DRect& r, const D2D1_COLOR_F& c, bool filled);
    void IconVolume(const DRect& r, const D2D1_COLOR_F& c, bool muted);
    void IconSearch(const DRect& r, const D2D1_COLOR_F& c);
    void IconHome(const DRect& r, const D2D1_COLOR_F& c, bool active);
    void IconLibrary(const DRect& r, const D2D1_COLOR_F& c);
    void IconPlus(const DRect& r, const D2D1_COLOR_F& c);
    void IconClose(const DRect& r, const D2D1_COLOR_F& c);
    void IconCheck(const DRect& r, const D2D1_COLOR_F& c);
    void IconBack(const DRect& r, const D2D1_COLOR_F& c);
    void IconForward(const DRect& r, const D2D1_COLOR_F& c);
    void IconExplicit(const DRect& r, const D2D1_COLOR_F& c);
    void IconEq(const DRect& r, const D2D1_COLOR_F& c, float phase);
    void IconShuffle(const DRect& r, const D2D1_COLOR_F& c, bool on);
    void IconRepeat(const DRect& r, const D2D1_COLOR_F& c, int mode, bool on);
    void IconFullscreen(const DRect& r, const D2D1_COLOR_F& c);
    void IconPictureInPicture(const DRect& r, const D2D1_COLOR_F& c);
    void IconQueue(const DRect& r, const D2D1_COLOR_F& c, bool active);
    void IconLyrics(const DRect& r, const D2D1_COLOR_F& c, bool active);
    void IconMore(const DRect& r, const D2D1_COLOR_F& c);
    void IconMin(const DRect& r, const D2D1_COLOR_F& c);
    void IconMax(const DRect& r, const D2D1_COLOR_F& c);
    void IconRestore(const DRect& r, const D2D1_COLOR_F& c);
    void IconArtist(const DRect& r, const D2D1_COLOR_F& c);
    void IconChart(const DRect& r, const D2D1_COLOR_F& c);
    void IconPlayingWave(const DRect& r, const D2D1_COLOR_F& c, float phase);

    /* image cache: url -> bitmap (async load; saari map access UI thread par) */
    ID2D1Bitmap* GetImage(const std::string& url);
    void PreloadImage(const std::string& url);
    void AcceptImage(const std::string& url, std::vector<uint8_t> bytes);
    void Invalidate() { Redraw(); }
    void Redraw();

private:
    IDWriteTextFormat* Format(float size, TW weight, bool center, bool ellipsis);
    ID2D1SolidColorBrush* Brush(const D2D1_COLOR_F& c);

    HWND m_hwnd = nullptr;
    ID2D1HwndRenderTarget* m_rt = nullptr;
    ID2D1Factory* m_d2d = nullptr;
    IDWriteFactory* m_dw = nullptr;
    IWICImagingFactory* m_wic = nullptr;
    ID2D1SolidColorBrush* m_brush = nullptr;
    std::unordered_map<uint64_t, IDWriteTextFormat*> m_formats;
    std::vector<IDWriteFontCollection*> m_dummy;
    IDWriteFontCollection* m_embeddedFonts = nullptr;
    int m_w = 0, m_h = 0;

    struct ImgEntry { int state = 0; ID2D1Bitmap* bmp = nullptr; std::vector<uint8_t> bytes; int retries = 0; };
    std::unordered_map<std::string, ImgEntry> m_images;
};

/* image bytes worker -> UI completion message */
constexpr UINT WM_APP_IMG = WM_APP + 43;
struct ImgMsg { std::string url; std::vector<uint8_t> bytes; bool ok = false; };

extern Renderer g_ui;
std::wstring AppDataPath(const wchar_t* name);
