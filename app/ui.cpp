/* Renderer — Direct2D + DirectWrite, embedded Montserrat. */
#include "ui.h"
#include "fonts_data.h"
#include "net.h"

#include <shlwapi.h>

Renderer g_ui;

/* ── embedded-font plumbing (memory stream/loader/enumerator) ── */
namespace {

class MemFontStream : public IDWriteFontFileStream {
    LONG m_ref = 1;
    int m_idx;
public:
    explicit MemFontStream(int idx) : m_idx(idx) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (riid == IID_IUnknown || riid == __uuidof(IDWriteFontFileStream)) { *ppv = this; AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return (ULONG)r;
    }
    HRESULT STDMETHODCALLTYPE ReadFileFragment(const void** start, UINT64 offset, UINT64 size, void** ctx) override {
        const auto& f = g_embeddedFonts[m_idx];
        if (offset + size > f.size) return E_FAIL;
        *start = f.data + offset;
        *ctx = nullptr;
        return S_OK;
    }
    void STDMETHODCALLTYPE ReleaseFileFragment(void*) override {}
    HRESULT STDMETHODCALLTYPE GetFileSize(UINT64* size) override { *size = g_embeddedFonts[m_idx].size; return S_OK; }
    HRESULT STDMETHODCALLTYPE GetLastWriteTime(UINT64* t) override { *t = 0; return S_OK; }
};

class MemFontLoader : public IDWriteFontFileLoader {
    LONG m_ref = 1;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (riid == IID_IUnknown || riid == __uuidof(IDWriteFontFileLoader)) { *ppv = this; AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return (ULONG)r;
    }
    HRESULT STDMETHODCALLTYPE CreateStreamFromKey(const void* key, UINT32 keySize, IDWriteFontFileStream** stream) override {
        if (!key || keySize != sizeof(int)) return E_FAIL;
        *stream = new MemFontStream(*(const int*)key);
        return S_OK;
    }
};

class MemFontEnumerator : public IDWriteFontFileEnumerator {
    LONG m_ref = 1;
    IDWriteFactory* m_factory;
    int m_pos = -1;
public:
    explicit MemFontEnumerator(IDWriteFactory* f) : m_factory(f) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (riid == IID_IUnknown || riid == __uuidof(IDWriteFontFileEnumerator)) { *ppv = this; AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return (ULONG)r;
    }
    HRESULT STDMETHODCALLTYPE MoveNext(BOOL* hasCurrent) override {
        int count = (int)(sizeof(g_embeddedFonts) / sizeof(g_embeddedFonts[0]));
        m_pos++;
        *hasCurrent = m_pos < count;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetCurrentFontFile(IDWriteFontFile** file) override {
        return m_factory->CreateCustomFontFileReference(&m_pos, sizeof(int),
            reinterpret_cast<IDWriteFontFileLoader*>(g_embeddedLoader()), file);
    }
    static MemFontLoader* g_embeddedLoader();  /* neeche defined singleton ka access */
};

MemFontLoader* MemFontEnumerator::g_embeddedLoader() {
    static MemFontLoader* loader = new MemFontLoader();
    return loader;
}

class MemCollectionLoader : public IDWriteFontCollectionLoader {
    LONG m_ref = 1;
    IDWriteFactory* m_factory;
public:
    explicit MemCollectionLoader(IDWriteFactory* f) : m_factory(f) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (riid == IID_IUnknown || riid == __uuidof(IDWriteFontCollectionLoader)) { *ppv = this; AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return (ULONG)r;
    }
    HRESULT STDMETHODCALLTYPE CreateEnumeratorFromKey(IDWriteFactory* factory, const void*, UINT32, IDWriteFontFileEnumerator** e) override {
        *e = new MemFontEnumerator(factory);
        (void)m_factory;
        return S_OK;
    }
};

} // namespace

std::wstring AppDataPath(const wchar_t* name) { return AppDataDir() + L"\\" + name; }

bool Renderer::Init(HWND hwnd) {
    m_hwnd = hwnd;
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &m_d2d))) return false;
    if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), (IUnknown**)&m_dw))) return false;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                __uuidof(IWICImagingFactory), (void**)&m_wic))) return false;
    RECT rc;
    GetClientRect(hwnd, &rc);
    m_w = rc.right; m_h = rc.bottom;
    HRESULT hr = m_d2d->CreateHwndRenderTarget(
        D2D1::RenderTargetProperties(D2D1_RENDER_TARGET_TYPE_DEFAULT,
            D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_IGNORE)),
        D2D1::HwndRenderTargetProperties(hwnd, D2D1::SizeU(m_w, m_h)), &m_rt);
    if (FAILED(hr)) return false;
    m_rt->SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    m_rt->CreateSolidColorBrush(color::white, &m_brush);

    auto* loader = new MemCollectionLoader(m_dw);
    m_dw->RegisterFontCollectionLoader(loader);
    m_dw->RegisterFontFileLoader(MemFontEnumerator::g_embeddedLoader());
    if (FAILED(m_dw->CreateCustomFontCollection(loader, nullptr, 0, &m_embeddedFonts)))
        m_embeddedFonts = nullptr;
    if (m_embeddedFonts) {
        UINT32 idx = 0; BOOL exists = FALSE;
        m_embeddedFonts->FindFamilyName(L"Montserrat", &idx, &exists);
        if (!exists) { m_embeddedFonts->Release(); m_embeddedFonts = nullptr; }
    }
    return true;
}

void Renderer::Shutdown() {
    for (auto& [k, f] : m_formats) f->Release();
    m_formats.clear();
    for (auto& [k, e] : m_images) if (e.bmp) e.bmp->Release();
    m_images.clear();
    if (m_embeddedFonts) m_embeddedFonts->Release();
    if (m_brush) m_brush->Release();
    if (m_rt) m_rt->Release();
    if (m_wic) m_wic->Release();
    if (m_dw) m_dw->Release();
    if (m_d2d) m_d2d->Release();
}

void Renderer::Resize(int w, int h) {
    m_w = w; m_h = h;
    if (m_rt) m_rt->Resize(D2D1::SizeU(w, h));
}
void Renderer::Begin() { m_rt->BeginDraw(); }
void Renderer::End() {
    if (m_rt->EndDraw() == (HRESULT)D2DERR_RECREATE_TARGET) {
        /* device loss — bitmaps invalid; agle frame par reload */
        for (auto& [k, e] : m_images) { if (e.bmp) { e.bmp->Release(); e.bmp = nullptr; } e.state = 0; }
    }
}
void Renderer::Redraw() { if (m_hwnd) InvalidateRect(m_hwnd, nullptr, FALSE); }

ID2D1SolidColorBrush* Renderer::Brush(const D2D1_COLOR_F& c) {
    m_brush->SetColor(c);
    return m_brush;
}
void Renderer::FillRect(const DRect& r, const D2D1_COLOR_F& c) { m_rt->FillRectangle(r, Brush(c)); }
void Renderer::FillRounded(const DRect& r, float radius, const D2D1_COLOR_F& c) {
    m_rt->FillRoundedRectangle(D2D1::RoundedRect(r, radius, radius), Brush(c));
}
void Renderer::StrokeRounded(const DRect& r, float radius, const D2D1_COLOR_F& c, float w) {
    m_rt->DrawRoundedRectangle(D2D1::RoundedRect(r, radius, radius), Brush(c), w);
}

void Renderer::DrawBitmap(ID2D1Bitmap* bmp, const DRect& dest, const DRect* roundedClip, float opacity) {
    if (!bmp) return;
    if (!roundedClip) { m_rt->DrawBitmap(bmp, dest, opacity); return; }
    ID2D1Layer* layer = nullptr;
    ID2D1PathGeometry* geo = nullptr;
    if (FAILED(m_d2d->CreatePathGeometry(&geo))) { m_rt->DrawBitmap(bmp, dest, opacity); return; }
    ID2D1GeometrySink* sink = nullptr;
    geo->Open(&sink);
    float rx = roundedClip->left, ry = roundedClip->top, rr = roundedClip->right, rb = roundedClip->bottom;
    float rad = (rr - rx) / 2.0f;
    sink->BeginFigure(D2D1::Point2F(rx + rad, ry), D2D1_FIGURE_BEGIN_FILLED);
    sink->AddArc(D2D1::ArcSegment(D2D1::Point2F(rr, ry + rad), D2D1::SizeF(rad, rad), 90, D2D1_SWEEP_DIRECTION_CLOCKWISE, D2D1_ARC_SIZE_SMALL));
    sink->AddArc(D2D1::ArcSegment(D2D1::Point2F(rr - rad, rb), D2D1::SizeF(rad, rad), 90, D2D1_SWEEP_DIRECTION_CLOCKWISE, D2D1_ARC_SIZE_SMALL));
    sink->AddArc(D2D1::ArcSegment(D2D1::Point2F(rx, rb - rad), D2D1::SizeF(rad, rad), 90, D2D1_SWEEP_DIRECTION_CLOCKWISE, D2D1_ARC_SIZE_SMALL));
    sink->AddArc(D2D1::ArcSegment(D2D1::Point2F(rx + rad, ry), D2D1::SizeF(rad, rad), 90, D2D1_SWEEP_DIRECTION_CLOCKWISE, D2D1_ARC_SIZE_SMALL));
    sink->EndFigure(D2D1_FIGURE_END_CLOSED);
    sink->Close(); sink->Release();
    m_rt->CreateLayer(nullptr, &layer);
    if (layer) {
        m_rt->PushLayer(D2D1::LayerParameters(dest, geo), layer);
        m_rt->DrawBitmap(bmp, dest, opacity);
        m_rt->PopLayer();
        layer->Release();
    } else m_rt->DrawBitmap(bmp, dest, opacity);
    geo->Release();
}

ID2D1Bitmap* Renderer::BitmapFromMemory(const uint8_t* data, size_t size) {
    IStream* stream = SHCreateMemStream(data, (UINT)size);
    if (!stream) return nullptr;
    IWICBitmapDecoder* decoder = nullptr;
    ID2D1Bitmap* bmp = nullptr;
    if (SUCCEEDED(m_wic->CreateDecoderFromStream(stream, nullptr, WICDecodeMetadataCacheOnLoad, &decoder))) {
        IWICBitmapFrameDecode* frame = nullptr;
        if (SUCCEEDED(decoder->GetFrame(0, &frame))) {
            IWICFormatConverter* conv = nullptr;
            if (SUCCEEDED(m_wic->CreateFormatConverter(&conv))) {
                if (SUCCEEDED(conv->Initialize(frame, GUID_WICPixelFormat32bppPBGRA,
                                               WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom)))
                    m_rt->CreateBitmapFromWicBitmap(conv, nullptr, &bmp);
                conv->Release();
            }
            frame->Release();
        }
        decoder->Release();
    }
    stream->Release();
    return bmp;
}

IDWriteTextFormat* Renderer::Format(float size, TW weight, bool center, bool ellipsis) {
    uint32_t sz = (uint32_t)(size * 4);
    uint64_t key = ((uint64_t)sz << 32) | ((uint64_t)(int)weight << 8) | (center ? 2 : 0) | (ellipsis ? 1 : 0);
    auto it = m_formats.find(key);
    if (it != m_formats.end()) return it->second;
    IDWriteTextFormat* fmt = nullptr;
    HRESULT hr;
    if (m_embeddedFonts)
        hr = m_dw->CreateTextFormat(L"Montserrat", m_embeddedFonts, (DWRITE_FONT_WEIGHT)(int)weight,
                                    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, L"", &fmt);
    else
        hr = m_dw->CreateTextFormat(L"Montserrat", nullptr, (DWRITE_FONT_WEIGHT)(int)weight,
                                    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, L"", &fmt);
    if (FAILED(hr)) return nullptr;
    fmt->SetTextAlignment(center ? DWRITE_TEXT_ALIGNMENT_CENTER : DWRITE_TEXT_ALIGNMENT_LEADING);
    fmt->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
    fmt->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
    if (ellipsis) {
        DWRITE_TRIMMING trim{DWRITE_TRIMMING_GRANULARITY_CHARACTER, 0, 0};
        IDWriteInlineObject* dots = nullptr;
        if (SUCCEEDED(m_dw->CreateEllipsisTrimmingSign(fmt, &dots))) {
            fmt->SetTrimming(&trim, dots);
            dots->Release();
        }
    }
    m_formats[key] = fmt;
    return fmt;
}

void Renderer::Text(const std::string& s, const DRect& r, float size, TW weight,
                    const D2D1_COLOR_F& col, bool center,
                    DWRITE_TEXT_ALIGNMENT align, DWRITE_PARAGRAPH_ALIGNMENT valign,
                    bool ellipsis, float lineSpacing) {
    if (s.empty()) return;
    /* center param purani calls ke liye: align explicit ho to wahi */
    bool ctr = center || align == DWRITE_TEXT_ALIGNMENT_CENTER;
    auto* fmt = Format(size, weight, ctr, ellipsis);
    if (!fmt) return;
    if (align != DWRITE_TEXT_ALIGNMENT_LEADING) fmt->SetTextAlignment(align);
    else fmt->SetTextAlignment(ctr ? DWRITE_TEXT_ALIGNMENT_CENTER : DWRITE_TEXT_ALIGNMENT_LEADING);
    fmt->SetParagraphAlignment(valign);
    if (lineSpacing > 0) fmt->SetLineSpacing(DWRITE_LINE_SPACING_METHOD_UNIFORM, lineSpacing, lineSpacing * 0.8f);
    std::wstring w = Widen(s);
    m_rt->DrawText(w.c_str(), (UINT32)w.size(), fmt, r, Brush(col));
}

void Renderer::TextMulti(const std::string& s, const DRect& r, float size, TW weight,
                         const D2D1_COLOR_F& col, float lineSpacing) {
    if (s.empty()) return;
    auto* fmt = Format(size, weight, false, false);
    if (!fmt) return;
    fmt->SetWordWrapping(DWRITE_WORD_WRAPPING_WRAP);
    fmt->SetLineSpacing(DWRITE_LINE_SPACING_METHOD_UNIFORM, lineSpacing, lineSpacing * 0.8f);
    std::wstring w = Widen(s);
    m_rt->DrawText(w.c_str(), (UINT32)w.size(), fmt, r, Brush(col));
    fmt->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
}

float Renderer::TextWidth(const std::string& s, float size, TW weight) {
    auto* fmt = Format(size, weight, false, false);
    if (!fmt) return 0;
    IDWriteTextLayout* layout = nullptr;
    std::wstring w = Widen(s);
    if (FAILED(m_dw->CreateTextLayout(w.c_str(), (UINT32)w.size(), fmt, 100000.0f, size * 2, &layout))) return 0;
    DWRITE_TEXT_METRICS tm{};
    layout->GetMetrics(&tm);
    layout->Release();
    return tm.width;
}

/* ── images ── */
void Renderer::PreloadImage(const std::string& url) {
    if (url.empty()) return;
    auto& e = m_images[url];
    if (e.state != 0) return;
    e.state = 1;
    std::string u = url;
    RunAsync([this, u] {
        std::vector<uint8_t> bytes;
        if (net::GetBytes(u, bytes) && !bytes.empty()) {
            auto& entry = m_images[u];
            entry.raw = new uint8_t[bytes.size()];
            memcpy((void*)entry.raw, bytes.data(), bytes.size());
            entry.rawSize = bytes.size();
        }
    }, [this, u] {
        auto it = m_images.find(u);
        if (it != m_images.end() && it->second.raw) it->second.state = 2;
        else if (it != m_images.end()) it->second.state = 3;
        Redraw();
    });
}

ID2D1Bitmap* Renderer::GetImage(const std::string& url) {
    if (url.empty()) return nullptr;
    auto it = m_images.find(url);
    if (it == m_images.end()) { PreloadImage(url); return nullptr; }
    auto& e = it->second;
    if (e.state == 2 && e.raw) {
        e.bmp = BitmapFromMemory(e.raw, e.rawSize);
        delete[] e.raw; e.raw = nullptr; e.rawSize = 0;
        e.state = e.bmp ? 4 : 3;
    }
    return e.state == 4 ? e.bmp : nullptr;
}

/* ── icons (stroke/fill vector glyphs, Spotify style) ── */
namespace {
void Line(Renderer& u, float x1, float y1, float x2, float y2, float w, const D2D1_COLOR_F& c) {
    (void)u;
    ID2D1SolidColorBrush* b = nullptr;
    g_ui.RT()->CreateSolidColorBrush(c, &b);
    if (!b) return;
    ID2D1StrokeStyle* ss = nullptr;
    ID2D1Factory* f = nullptr;
    g_ui.RT()->GetFactory(&f);
    if (f) {
        f->CreateStrokeStyle(D2D1::StrokeStyleProperties(D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND), nullptr, 0, &ss);
        f->Release();
    }
    g_ui.RT()->DrawLine(D2D1::Point2F(x1, y1), D2D1::Point2F(x2, y2), b, w, ss);
    if (ss) ss->Release();
    b->Release();
}
void FillPath(Renderer& u, const std::vector<D2D1_POINT_2F>& pts, const D2D1_COLOR_F& c) {
    (void)u;
    ID2D1Factory* f = nullptr;
    g_ui.RT()->GetFactory(&f);
    if (!f || pts.empty()) return;
    ID2D1PathGeometry* geo = nullptr;
    f->CreatePathGeometry(&geo);
    ID2D1GeometrySink* sink = nullptr;
    geo->Open(&sink);
    sink->BeginFigure(pts[0], D2D1_FIGURE_BEGIN_FILLED);
    for (size_t i = 1; i < pts.size(); i++) sink->AddLine(pts[i]);
    sink->EndFigure(D2D1_FIGURE_END_CLOSED);
    sink->Close(); sink->Release();
    ID2D1SolidColorBrush* b = nullptr;
    g_ui.RT()->CreateSolidColorBrush(c, &b);
    if (b) { g_ui.RT()->FillGeometry(geo, b); b->Release(); }
    geo->Release();
    f->Release();
}
void EllipseFill(float cx, float cy, float rx, float ry, const D2D1_COLOR_F& c) {
    ID2D1SolidColorBrush* b = nullptr;
    g_ui.RT()->CreateSolidColorBrush(c, &b);
    if (b) { g_ui.RT()->FillEllipse(D2D1::Ellipse(D2D1::Point2F(cx, cy), rx, ry), b); b->Release(); }
}
void EllipseStroke(float cx, float cy, float rx, float ry, float w, const D2D1_COLOR_F& c) {
    ID2D1SolidColorBrush* b = nullptr;
    g_ui.RT()->CreateSolidColorBrush(c, &b);
    if (b) { g_ui.RT()->DrawEllipse(D2D1::Ellipse(D2D1::Point2F(cx, cy), rx, ry), b, w); b->Release(); }
}
} // namespace

void Renderer::IconPlay(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.32f;
    FillPath(*this, {{cx - s * 0.7f, cy - s}, {cx - s * 0.7f, cy + s}, {cx + s * 0.9f, cy}}, c);
}
void Renderer::IconPause(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.30f;
    FillRect(R(cx - s, cy - s, cx - s * 0.28f, cy + s), c);
    FillRect(R(cx + s * 0.28f, cy - s, cx + s, cy + s), c);
}
void Renderer::IconPrev(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.30f;
    FillRect(R(cx - s, cy - s, cx - s * 0.62f, cy + s), c);
    FillPath(*this, {{cx + s, cy - s}, {cx + s, cy + s}, {cx - s * 0.35f, cy}}, c);
}
void Renderer::IconNext(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.30f;
    FillRect(R(cx + s * 0.62f, cy - s, cx + s, cy + s), c);
    FillPath(*this, {{cx - s, cy - s}, {cx - s, cy + s}, {cx + s * 0.35f, cy}}, c);
}
void Renderer::IconHeart(const DRect& r, const D2D1_COLOR_F& c, bool filled) {
    /* dil: do circles + neeche triangle-ish path */
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.36f;
    std::vector<D2D1_POINT_2F> heart = {
        {cx, cy + s * 1.05f}, {cx - s * 1.15f, cy - s * 0.05f}, {cx - s * 1.05f, cy - s * 0.75f},
        {cx - s * 0.45f, cy - s * 1.05f}, {cx, cy - s * 0.45f}, {cx + s * 0.45f, cy - s * 1.05f},
        {cx + s * 1.05f, cy - s * 0.75f}, {cx + s * 1.15f, cy - s * 0.05f}};
    if (filled) { FillPath(*this, heart, c); return; }
    /* outline: 2 arc-circles + V lines */
    EllipseStroke(cx - s * 0.55f, cy - s * 0.55f, s * 0.52f, s * 0.52f, 1.6f, c);
    EllipseStroke(cx + s * 0.55f, cy - s * 0.55f, s * 0.52f, s * 0.52f, 1.6f, c);
    Line(*this, cx - s * 1.05f, cy - s * 0.35f, cx, cy + s * 1.05f, 1.6f, c);
    Line(*this, cx + s * 1.05f, cy - s * 0.35f, cx, cy + s * 1.05f, 1.6f, c);
}
void Renderer::IconVolume(const DRect& r, const D2D1_COLOR_F& c, bool muted) {
    float cx = r.left + W(r) * 0.38f, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.30f;
    FillPath(*this, {{cx - s * 0.9f, cy - s * 0.35f}, {cx - s * 0.35f, cy - s * 0.35f},
                     {cx + s * 0.35f, cy - s * 0.95f}, {cx + s * 0.35f, cy + s * 0.95f},
                     {cx - s * 0.35f, cy + s * 0.35f}, {cx - s * 0.9f, cy + s * 0.35f}}, c);
    if (muted) {
        Line(*this, cx + s * 0.7f, cy - s * 0.5f, cx + s * 1.4f, cy + s * 0.5f, 1.8f, c);
        Line(*this, cx + s * 1.4f, cy - s * 0.5f, cx + s * 0.7f, cy + s * 0.5f, 1.8f, c);
    } else {
        Line(*this, cx + s * 0.75f, cy - s * 0.45f, cx + s * 1.05f, cy, 1.8f, c);
        Line(*this, cx + s * 1.05f, cy, cx + s * 0.75f, cy + s * 0.45f, 1.8f, c);
    }
}
void Renderer::IconSearch(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2 - 1, cy = (r.top + r.bottom) / 2 - 1;
    float rad = std::min(W(r), H(r)) * 0.30f;
    EllipseStroke(cx, cy, rad, rad, 1.8f, c);
    Line(*this, cx + rad * 0.72f, cy + rad * 0.72f, cx + rad * 1.35f, cy + rad * 1.35f, 1.8f, c);
}
void Renderer::IconHome(const DRect& r, const D2D1_COLOR_F& c, bool active) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.36f;
    if (active) {
        FillPath(*this, {{cx - s, cy - s * 0.1f}, {cx, cy - s}, {cx + s, cy - s * 0.1f},
                         {cx + s * 0.78f, cy - s * 0.1f}, {cx + s * 0.78f, cy + s}, {cx - s * 0.78f, cy + s},
                         {cx - s * 0.78f, cy - s * 0.1f}}, c);
    } else {
        Line(*this, cx - s, cy, cx, cy - s * 0.9f, 1.8f, c);
        Line(*this, cx, cy - s * 0.9f, cx + s, cy, 1.8f, c);
        Line(*this, cx - s * 0.72f, cy - s * 0.2f, cx - s * 0.72f, cy + s * 0.9f, 1.8f, c);
        Line(*this, cx + s * 0.72f, cy - s * 0.2f, cx + s * 0.72f, cy + s * 0.9f, 1.8f, c);
        Line(*this, cx - s * 0.72f, cy + s * 0.9f, cx + s * 0.72f, cy + s * 0.9f, 1.8f, c);
    }
}
void Renderer::IconLibrary(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.34f;
    Line(*this, cx - s * 0.8f, cy - s, cx - s * 0.8f, cy + s, 2.0f, c);
    Line(*this, cx - s * 0.25f, cy - s, cx - s * 0.25f, cy + s, 2.0f, c);
    Line(*this, cx + s * 0.75f, cy - s * 0.9f, cx + s * 0.25f, cy + s, 2.0f, c);
}
void Renderer::IconPlus(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.32f;
    Line(*this, cx - s, cy, cx + s, cy, 2.0f, c);
    Line(*this, cx, cy - s, cx, cy + s, 2.0f, c);
}
void Renderer::IconClose(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.28f;
    Line(*this, cx - s, cy - s, cx + s, cy + s, 1.6f, c);
    Line(*this, cx + s, cy - s, cx - s, cy + s, 1.6f, c);
}
void Renderer::IconCheck(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.34f;
    Line(*this, cx - s, cy, cx - s * 0.25f, cy + s * 0.7f, 2.2f, c);
    Line(*this, cx - s * 0.25f, cy + s * 0.7f, cx + s, cy - s * 0.7f, 2.2f, c);
}
void Renderer::IconBack(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.30f;
    Line(*this, cx + s * 0.5f, cy - s, cx - s * 0.5f, cy, 2.0f, c);
    Line(*this, cx - s * 0.5f, cy, cx + s * 0.5f, cy + s, 2.0f, c);
}
void Renderer::IconForward(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float s = std::min(W(r), H(r)) * 0.30f;
    Line(*this, cx - s * 0.5f, cy - s, cx + s * 0.5f, cy, 2.0f, c);
    Line(*this, cx + s * 0.5f, cy, cx - s * 0.5f, cy + s, 2.0f, c);
}
void Renderer::IconExplicit(const DRect& r, const D2D1_COLOR_F& c) {
    FillRect(r, c);
    Text("E", R(r.left, r.top - 1, r.right, r.bottom + 1), H(r) * 0.78f, TW::Bold, color::base, true);
}
void Renderer::IconEq(const DRect& r, const D2D1_COLOR_F& c, float phase) {
    float bw = W(r) / 5.0f;
    float base = r.bottom;
    for (int i = 0; i < 3; i++) {
        float hgt = H(r) * (0.35f + 0.6f * (0.5f + 0.5f * sinf(phase * (2.1f + i * 0.7f) + i * 1.9f)));
        FillRect(R(r.left + i * bw * 1.6f, base - hgt, r.left + i * bw * 1.6f + bw, base), c);
    }
}
void Renderer::IconShuffle(const DRect& r, const D2D1_COLOR_F& c, bool on) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float w2 = W(r) * 0.36f, h2 = H(r) * 0.26f;
    Line(*this, cx - w2, cy - h2, cx + w2 * 0.45f, cy + h2, 1.8f, c);
    Line(*this, cx - w2, cy + h2, cx + w2 * 0.45f, cy - h2, 1.8f, c);
    FillPath(*this, {{cx + w2 * 0.35f, cy - h2 * 1.7f}, {cx + w2, cy - h2 * 0.55f}, {cx + w2 * 0.35f, cy + h2 * 0.4f}}, c);
    FillPath(*this, {{cx + w2 * 0.35f, cy + h2 * 1.7f}, {cx + w2, cy + h2 * 0.55f}, {cx + w2 * 0.35f, cy - h2 * 0.4f}}, c);
    if (on) EllipseFill(cx, r.bottom - 2.5f, 2.0f, 2.0f, c);
}
void Renderer::IconRepeat(const DRect& r, const D2D1_COLOR_F& c, int mode, bool on) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    float w2 = W(r) * 0.38f, h2 = H(r) * 0.28f;
    Line(*this, cx - w2, cy - h2, cx + w2 * 0.5f, cy - h2, 1.8f, c);
    Line(*this, cx - w2 * 0.5f, cy + h2, cx + w2, cy + h2, 1.8f, c);
    Line(*this, cx - w2, cy - h2, cx - w2, cy + h2 * 0.2f, 1.8f, c);
    Line(*this, cx + w2, cy + h2, cx + w2, cy - h2 * 0.2f, 1.8f, c);
    FillPath(*this, {{cx + w2 * 0.35f, cy - h2 * 1.75f}, {cx + w2 * 1.05f, cy - h2}, {cx + w2 * 0.35f, cy - h2 * 0.25f}}, c);
    FillPath(*this, {{cx - w2 * 0.35f, cy + h2 * 1.75f}, {cx - w2 * 1.05f, cy + h2}, {cx - w2 * 0.35f, cy + h2 * 0.25f}}, c);
    if (mode == 1) Text("1", R(cx - 6, cy - 8, cx + 6, cy + 8), 9, TW::Bold, c, true);
    if (on) EllipseFill(cx, r.bottom - 2.5f, 2.0f, 2.0f, c);
}
void Renderer::IconFullscreen(const DRect& r, const D2D1_COLOR_F& c) {
    float s = std::min(W(r), H(r)) * 0.32f;
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    Line(*this, cx - s, cy - s * 0.4f, cx - s, cy - s, 1.8f, c);
    Line(*this, cx - s, cy - s, cx - s * 0.4f, cy - s, 1.8f, c);
    Line(*this, cx + s * 0.4f, cy - s, cx + s, cy - s, 1.8f, c);
    Line(*this, cx + s, cy - s, cx + s, cy - s * 0.4f, 1.8f, c);
    Line(*this, cx + s, cy + s * 0.4f, cx + s, cy + s, 1.8f, c);
    Line(*this, cx + s, cy + s, cx + s * 0.4f, cy + s, 1.8f, c);
    Line(*this, cx - s * 0.4f, cy + s, cx - s, cy + s, 1.8f, c);
    Line(*this, cx - s, cy + s, cx - s, cy + s * 0.4f, 1.8f, c);
}
void Renderer::IconPictureInPicture(const DRect& r, const D2D1_COLOR_F& c) {
    StrokeRounded(R(r.left + 3, r.top + 4, r.right - 3, r.bottom - 4), 2, c, 1.6f);
    FillRect(R(r.left + W(r) * 0.45f, r.top + H(r) * 0.5f, r.right - 6, r.bottom - 7), c);
}
void Renderer::IconQueue(const DRect& r, const D2D1_COLOR_F& c, bool active) {
    (void)active;
    float x = r.left + 4, x2 = r.right - 4;
    Line(*this, x + 4, r.top + 5, x2, r.top + 5, 1.8f, c);
    Line(*this, x + 4, (r.top + r.bottom) / 2, x2, (r.top + r.bottom) / 2, 1.8f, c);
    Line(*this, x + 4, r.bottom - 5, x2, r.bottom - 5, 1.8f, c);
    FillPath(*this, {{x - 2, r.top + 2.5f}, {x - 2, r.top + 7.5f}, {x + 2.5f, r.top + 5}}, c);
}
void Renderer::IconLyrics(const DRect& r, const D2D1_COLOR_F& c, bool active) {
    (void)active;
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    FillRounded(R(cx - 3, r.top + 3, cx + 3, cy + 2), 3, c);
    Line(*this, cx, cy + 2, cx, cy + 6, 1.8f, c);
    Line(*this, cx - 4, r.bottom - 3, cx + 4, r.bottom - 3, 1.8f, c);
    Line(*this, cx - 5, cy + 1, cx - 5, cy + 6, 1.4f, c);
    Line(*this, cx + 5, cy + 1, cx + 5, cy + 6, 1.4f, c);
}
void Renderer::IconMore(const DRect& r, const D2D1_COLOR_F& c) {
    float cy = (r.top + r.bottom) / 2, cx = (r.left + r.right) / 2;
    EllipseFill(cx - 7, cy, 2.0f, 2.0f, c);
    EllipseFill(cx, cy, 2.0f, 2.0f, c);
    EllipseFill(cx + 7, cy, 2.0f, 2.0f, c);
}
void Renderer::IconMin(const DRect& r, const D2D1_COLOR_F& c) {
    float cy = (r.top + r.bottom) / 2;
    Line(*this, r.left + W(r) * 0.32f, cy, r.right - W(r) * 0.32f, cy, 1.2f, c);
}
void Renderer::IconMax(const DRect& r, const D2D1_COLOR_F& c) {
    float s = std::min(W(r), H(r)) * 0.22f;
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    StrokeRounded(R(cx - s, cy - s, cx + s, cy + s), 1, c, 1.2f);
}
void Renderer::IconRestore(const DRect& r, const D2D1_COLOR_F& c) {
    float s = std::min(W(r), H(r)) * 0.22f;
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    StrokeRounded(R(cx - s, cy - s * 0.4f, cx + s * 0.4f, cy + s), 1, c, 1.2f);
    Line(*this, cx - s * 0.4f, cy - s * 0.4f, cx - s * 0.4f, cy - s, 1.2f, c);
    Line(*this, cx - s * 0.4f, cy - s, cx + s, cy - s, 1.2f, c);
    Line(*this, cx + s, cy - s, cx + s, cy + s * 0.4f, 1.2f, c);
}
void Renderer::IconArtist(const DRect& r, const D2D1_COLOR_F& c) {
    float cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    EllipseStroke(cx, cy - H(r) * 0.16f, W(r) * 0.16f, W(r) * 0.16f, 1.6f, c);
    Line(*this, cx - W(r) * 0.3f, r.bottom - 3, cx - W(r) * 0.28f, cy + H(r) * 0.22f, 1.6f, c);
    Line(*this, cx + W(r) * 0.3f, r.bottom - 3, cx + W(r) * 0.28f, cy + H(r) * 0.22f, 1.6f, c);
}
void Renderer::IconPlayingWave(const DRect& r, const D2D1_COLOR_F& c, float phase) {
    IconEq(r, c, phase);
}
