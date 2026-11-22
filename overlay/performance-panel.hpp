// SPDX-License-Identifier: MIT
// Included in the localization add-on. Keep samples separate per swap chain.
struct PerformanceSamples {
    std::array<double, 240> intervals{};
    size_t count = 0, cursor = 0;
    LARGE_INTEGER frequency{}, previous{}, last_refresh{};
    UINT present_count = 0;
    LONGLONG present_time = 0;
    int mode = 0, corner = 1, settings_frame = -100;
    bool home_open = false;
    double fps = 0, low = 0, presented_fps = 0, queue_ms = -1, reflex_ms = -1;
    uint64_t reflex_frame = 0;
    IDXGIAdapter3 *adapter = nullptr;
    UINT64 used = 0, budget = 0;
    bool probed_adapter = false;
    void *physical_gpu = nullptr;
    uint64_t physical_used = 0, physical_total = 0;
    ~PerformanceSamples() { if (adapter) adapter->Release(); }
};
constexpr uint8_t performance_key[16] = {0x56,0x77,0x0c,0x59,0x15,0x0a,0x47,0x82,0x88,0x32,0xca,0xdc,0x19,0x16,0x20,0x74};
PerformanceSamples *performance_state(reshade::api::effect_runtime *runtime) {
    uint64_t handle = 0;
    runtime->get_private_data(performance_key, &handle);
    if (handle) return reinterpret_cast<PerformanceSamples *>(static_cast<uintptr_t>(handle));
    auto *s = new PerformanceSamples;
    QueryPerformanceFrequency(&s->frequency);
    reshade::get_config_value(nullptr, "DLSS5Swapper.HUD", "Mode", s->mode);
    reshade::get_config_value(nullptr, "DLSS5Swapper.HUD", "Corner", s->corner);
    s->mode = std::clamp(s->mode, 0, 2);
    s->corner = std::clamp(s->corner, 0, 3);
    runtime->set_private_data(performance_key, reinterpret_cast<uintptr_t>(s));
    return s;
}
void release_performance(reshade::api::effect_runtime *runtime) {
    uint64_t handle = 0;
    runtime->get_private_data(performance_key, &handle);
    runtime->set_private_data(performance_key, 0);
    delete reinterpret_cast<PerformanceSamples *>(static_cast<uintptr_t>(handle));
}

// Use the rendering device's LUID on hybrid systems. CurrentUsage and Budget
// describe the process in the local segment, not total physical GPU usage.
IDXGIAdapter3 *performance_adapter(reshade::api::device *dev) {
    LUID luid{};
    if (!dev->get_property(reshade::api::device_properties::adapter_luid, &luid)) return nullptr;
    using CreateFactory = HRESULT (WINAPI *)(REFIID, void **);
    static HMODULE dxgi = LoadLibraryExW(L"dxgi.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    static auto create = dxgi ? reinterpret_cast<CreateFactory>(GetProcAddress(dxgi,"CreateDXGIFactory1")) : nullptr;
    IDXGIFactory4 *factory = nullptr;
    IDXGIAdapter3 *adapter = nullptr;
    if (create && SUCCEEDED(create(__uuidof(IDXGIFactory4), reinterpret_cast<void **>(&factory)))) {
        factory->EnumAdapterByLuid(luid, __uuidof(IDXGIAdapter3), reinterpret_cast<void **>(&adapter));
        factory->Release();
    }
    return adapter;
}

// NV_LATENCY_RESULT_PARAMS v1, with the reserved bytes required by NVAPI.
struct ReflexFrame {
    uint64_t id, input, sim_start, sim_end, submit_start, submit_end, present_start, present_end,
             driver_start, driver_end, queue_start, queue_end, gpu_start, gpu_end;
    uint32_t active_us, frame_us;
    uint8_t reserved[120];
};
struct ReflexReports { uint32_t version, padding; ReflexFrame frames[64]; uint8_t reserved[32]; };
static_assert(sizeof(ReflexReports) == 15400);
using GetReflexLatency = int (__cdecl *)(IUnknown *, ReflexReports *);
using NvQuery = void *(__cdecl *)(uint32_t);
NvQuery load_nv_query() {
#ifdef _WIN64
    const wchar_t *name = L"nvapi64.dll";
#else
    const wchar_t *name = L"nvapi.dll";
#endif
    HMODULE nvapi = LoadLibraryExW(name, nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!nvapi) return nullptr;
    auto query = reinterpret_cast<NvQuery>(GetProcAddress(nvapi, "nvapi_QueryInterface"));
    using Init = int (__cdecl *)();
    auto init = query ? reinterpret_cast<Init>(query(0x0150e828)) : nullptr;
    return init && init() == 0 ? query : nullptr;
}
// NV_GPU_MEMORY_INFO_EX_V1 from NVIDIA's public NVAPI. Match the device
// LUID so a hybrid system never displays memory from another adapter.
struct NvMemoryInfo {
    uint32_t version, padding;
    uint64_t dedicated, available, system, shared, current_available, evicted, evictions, promoted, promotions;
};
static_assert(sizeof(NvMemoryInfo) == 80);
void *physical_gpu_for(reshade::api::device *device, NvQuery query) {
    LUID target{};
    if (!query || !device->get_property(reshade::api::device_properties::adapter_luid, &target)) return nullptr;
    using Enumerate = int (__cdecl *)(void **, uint32_t *);
    using AdapterId = int (__cdecl *)(void *, void *);
    auto enumerate = reinterpret_cast<Enumerate>(query(0xe5ac921f));
    auto adapter_id = reinterpret_cast<AdapterId>(query(0x0ff07fde));
    void *handles[64]{};
    uint32_t count = 0;
    if (!enumerate || !adapter_id || enumerate(handles, &count) != 0 || count > 64) return nullptr;
    for (uint32_t i = 0; i < count; ++i) {
        LUID id{};
        if (adapter_id(handles[i], &id) == 0 && id.LowPart == target.LowPart && id.HighPart == target.HighPart) return handles[i];
    }
    return nullptr;
}
void refresh_performance(reshade::api::effect_runtime *runtime, PerformanceSamples &s, LARGE_INTEGER now) {
    s.last_refresh = now;
    if (s.count) {
        auto sorted = s.intervals;
        std::sort(sorted.begin(), sorted.begin() + s.count);
        s.fps = 1000.0 * s.count / std::accumulate(sorted.begin(), sorted.begin() + s.count, 0.0);
        const size_t tail = (s.count + 99) / 100;
        s.low = s.count < 100 ? 0 : 1000.0 * tail / std::accumulate(sorted.begin() + s.count - tail, sorted.begin() + s.count, 0.0);
    }
    auto *device = runtime->get_device();
    static auto query = load_nv_query();
    if (!s.probed_adapter) {
        s.adapter = performance_adapter(device);
        s.physical_gpu = physical_gpu_for(device, query);
        s.probed_adapter = true;
    }
    using GetMemoryInfo = int (__cdecl *)(void *, NvMemoryInfo *);
    static auto read_memory = query ? reinterpret_cast<GetMemoryInfo>(query(0xc0599498)) : nullptr;
    NvMemoryInfo physical{};
    physical.version = sizeof(physical) | (1u << 16);
    s.physical_used = s.physical_total = 0;
    if (s.physical_gpu && read_memory && read_memory(s.physical_gpu, &physical) == 0 && physical.dedicated &&
        physical.available && physical.current_available <= physical.dedicated) {
        s.physical_used = physical.dedicated - physical.current_available;
        s.physical_total = physical.dedicated;
    }
    DXGI_QUERY_VIDEO_MEMORY_INFO memory{};
    if (s.adapter && SUCCEEDED(s.adapter->QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &memory))) {
        s.used = memory.CurrentUsage; s.budget = memory.Budget;
    } else { s.used = s.budget = 0; }
    s.reflex_ms = s.queue_ms = -1;
    s.presented_fps = 0;
    const auto api = device->get_api();
    if (api != reshade::api::device_api::d3d11 && api != reshade::api::device_api::d3d12) return;
    static auto latency = query ? reinterpret_cast<GetReflexLatency>(query(0x1a587f9c)) : nullptr;
    ReflexReports reports{};
    reports.version = sizeof(reports) | (1u << 16);
    if (latency && latency(reinterpret_cast<IUnknown *>(static_cast<uintptr_t>(device->get_native())), &reports) == 0) {
        for (const auto &f : reports.frames) {
            if (f.id <= s.reflex_frame || !f.input || f.gpu_end <= f.input) continue;
            s.reflex_frame = f.id;
            s.reflex_ms = (f.gpu_end - f.input) / 1000.0;
        }
    }
    auto *native = reinterpret_cast<IUnknown *>(static_cast<uintptr_t>(runtime->get_native()));
    IDXGISwapChain *chain = nullptr;
    if (!native || FAILED(native->QueryInterface(__uuidof(IDXGISwapChain), reinterpret_cast<void **>(&chain)))) return;
    DXGI_FRAME_STATISTICS stats{};
    UINT last = 0;
    if (SUCCEEDED(chain->GetFrameStatistics(&stats)) && stats.SyncQPCTime.QuadPart > 0) {
        if (s.present_time && stats.SyncQPCTime.QuadPart > s.present_time && stats.PresentCount > s.present_count) {
            s.presented_fps = double(stats.PresentCount - s.present_count) * s.frequency.QuadPart /
                (stats.SyncQPCTime.QuadPart - s.present_time);
            if (SUCCEEDED(chain->GetLastPresentCount(&last)) && last >= stats.PresentCount && last - stats.PresentCount < 16)
                s.queue_ms = 1000.0 * (last - stats.PresentCount) / s.presented_fps;
        }
        s.present_count = stats.PresentCount; s.present_time = stats.SyncQPCTime.QuadPart;
    } else s.present_time = 0;
    chain->Release();
}
void draw_performance(reshade::api::effect_runtime *runtime) {
    auto *s = performance_state(runtime);
    if (runtime->is_key_pressed(VK_F7)) {
        s->mode = (s->mode + 1) % 3;
        reshade::set_config_value(nullptr, "DLSS5Swapper.HUD", "Mode", s->mode);
    }
    if (!s->mode) {
        s->previous.QuadPart = s->last_refresh.QuadPart = s->present_time = 0;
        s->count = s->cursor = 0;
        s->fps = s->low = s->presented_fps = 0;
        s->queue_ms = s->reflex_ms = -1;
        return;
    }
    LARGE_INTEGER now;
    QueryPerformanceCounter(&now);
    if (s->previous.QuadPart && now.QuadPart > s->previous.QuadPart) {
        s->intervals[s->cursor] = 1000.0 * (now.QuadPart - s->previous.QuadPart) / s->frequency.QuadPart;
        s->cursor = (s->cursor + 1) % s->intervals.size();
        s->count = std::min(s->count + 1, s->intervals.size());
    }
    s->previous = now;
    if (now.QuadPart - s->last_refresh.QuadPart >= s->frequency.QuadPart / 2) refresh_performance(runtime, *s, now);
    const auto display = ImGui::GetIO().DisplaySize;
    const bool right = (s->corner & 1) != 0, bottom = (s->corner & 2) != 0;
    ImGui::SetNextWindowPos({right ? display.x - 10 : 10, bottom ? display.y - 10 : 10},
                            ImGuiCond_Always, {float(right), float(bottom)});
    ImGui::SetNextWindowBgAlpha(0.7f);
    if (ImGui::Begin("NeuralFrame F7", nullptr, ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoDecoration |
            ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing)) {
        if (s->presented_fps > 0) ImGui::Text("DXGI  %.1f FPS", s->presented_fps);
        else if (s->fps > 0) ImGui::Text("ReShade  %.1f FPS", s->fps);
        else ImGui::TextUnformatted("FPS --");
        if (s->mode == 1) ImGui::SameLine();
        if (s->physical_total) ImGui::Text("VRAM  %.2f / %.2f GiB (%.0f%%)", double(s->physical_used)/(1ull<<30),
            double(s->physical_total)/(1ull<<30), 100.0 * s->physical_used / s->physical_total);
        else if (s->budget) ImGui::Text("VRAM (process / budget)  %.2f / %.2f GiB", double(s->used)/(1ull<<30), double(s->budget)/(1ull<<30));
        else ImGui::TextUnformatted("VRAM --");
        if (s->mode == 1) ImGui::SameLine();
        if (s->reflex_ms >= 0) ImGui::Text("Reflex (input to GPU)  %.1f ms", s->reflex_ms);
        else if (s->queue_ms >= 0) ImGui::Text("DXGI queue (estimate)  %.1f ms", s->queue_ms);
        else ImGui::TextUnformatted("Latency --");
        if (s->mode == 2) {
            if (s->low > 0) ImGui::Text("ReShade 1%% Low  %.1f FPS", s->low);
            else ImGui::TextUnformatted("ReShade 1% Low  --");
            if (s->fps > 0) ImGui::Text("ReShade frame time  %.2f ms", 1000.0 / s->fps);
            if (s->physical_total && s->budget) ImGui::Text("Process VRAM  %.2f GiB", double(s->used)/(1ull<<30));
        }
    }
    ImGui::End();
}
bool track_home(reshade::api::effect_runtime *runtime, bool open, reshade::api::input_source) {
    performance_state(runtime)->home_open = open;
    return false;
}
void draw_performance_settings(reshade::api::effect_runtime *runtime) {
    auto *s = performance_state(runtime);
    s->settings_frame = ImGui::GetFrameCount();
    const char *modes[] = {"Off / 关闭", "Compact / 精简", "Detailed / 详细"};
    const char *corners[] = {"Top left / 左上", "Top right / 右上", "Bottom left / 左下", "Bottom right / 右下"};
    if (ImGui::Combo("F7 HUD", &s->mode, modes, 3)) reshade::set_config_value(nullptr, "DLSS5Swapper.HUD", "Mode", s->mode);
    if (ImGui::Combo("Position / 位置", &s->corner, corners, 4)) reshade::set_config_value(nullptr, "DLSS5Swapper.HUD", "Corner", s->corner);
    draw_tuner_settings();
}
