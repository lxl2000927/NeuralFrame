// SPDX-License-Identifier: MIT
// Adapted from DLSS5-Swapper-Enhanced v2.3.5, overlay/zh-cn-overlay.cpp.
struct SinglePassTunerState {
    bool initialized = false;
    bool has_feeder_cfg = false;
    bool is_host64 = false;
    int preset_idx = 0; // 0: 单层强效·省卡, 1: 极致省卡·高帧, 2: 单层满血, 3: 原厂标准, 4: 自定义
    float intensity = 1.35f;
    float structure = 1.30f;
    float local_tone = 1.22f;
    bool look_enabled = true;
    float detail_boost = 1.35f;
    float tone_boost = 1.15f;
    float color_boost = 1.08f;
    int nr_style = 1;
    int work_res = 75;
    int work_upscale = 1;
    float sharpness = 0.35f;
    float hold_strength = 0.30f;
};

SinglePassTunerState g_tuner = {};
std::wstring g_exe_dir_w;
std::wstring g_consumer_ini_w;
std::wstring g_feed_cfg_w;
FILETIME g_last_ini_mtime = {0, 0};
ULONGLONG g_last_poll_tick = 0;

bool file_exists_w(const std::wstring &p) {
    if (p.empty()) return false;
    DWORD attr = GetFileAttributesW(p.c_str());
    return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

bool get_file_mtime_w(const std::wstring &p, FILETIME *out) {
    if (p.empty() || !out) return false;
    WIN32_FILE_ATTRIBUTE_DATA fad = {};
    if (!GetFileAttributesExW(p.c_str(), GetFileExInfoStandard, &fad)) return false;
    *out = fad.ftLastWriteTime;
    return true;
}

std::string read_utf8_file_w(const std::wstring &path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};
    LARGE_INTEGER sz = {};
    if (!GetFileSizeEx(h, &sz) || sz.QuadPart <= 0 || sz.QuadPart > 4 * 1024 * 1024) {
        CloseHandle(h);
        return {};
    }
    std::string out(static_cast<size_t>(sz.QuadPart), '\0');
    DWORD rd = 0;
    const BOOL ok = ReadFile(h, out.data(), static_cast<DWORD>(out.size()), &rd, nullptr);
    CloseHandle(h);
    if (!ok || rd != out.size()) return {};
    return out;
}

bool write_utf8_atomic_w(const std::wstring &path, const std::string &content) {
    if (path.empty()) return false;
    DWORD attr = GetFileAttributesW(path.c_str());
    if (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_READONLY)) {
        SetFileAttributesW(path.c_str(), attr & ~FILE_ATTRIBUTE_READONLY);
    }
    wchar_t pid_buf[64] = {};
    swprintf(pid_buf, 64, L".enh-%lu-%llu.tmp", GetCurrentProcessId(), GetTickCount64());
    std::wstring tmp = path + pid_buf;
    HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD wr = 0;
    BOOL ok = WriteFile(h, content.data(), static_cast<DWORD>(content.size()), &wr, nullptr);
    FlushFileBuffers(h);
    CloseHandle(h);
    if (!ok || wr != content.size()) {
        DeleteFileW(tmp.c_str());
        return false;
    }
    if (!MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tmp.c_str());
        return false;
    }
    return true;
}

std::string trim_ascii(std::string_view sv) {
    size_t b = 0, e = sv.size();
    while (b < e && (sv[b] == ' ' || sv[b] == '\t' || sv[b] == '\r' || sv[b] == '\n')) ++b;
    while (e > b && (sv[e - 1] == ' ' || sv[e - 1] == '\t' || sv[e - 1] == '\r' || sv[e - 1] == '\n')) --e;
    return std::string(sv.substr(b, e - b));
}

bool iequals_ascii(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        char ca = (a[i] >= 'A' && a[i] <= 'Z') ? static_cast<char>(a[i] + 32) : a[i];
        char cb = (b[i] >= 'A' && b[i] <= 'Z') ? static_cast<char>(b[i] + 32) : b[i];
        if (ca != cb) return false;
    }
    return true;
}

std::string ini_get_str(const std::string &text, std::string_view section, std::string_view key) {
    std::string cur_sec;
    size_t pos = 0;
    while (pos < text.size()) {
        size_t end = text.find('\n', pos);
        if (end == std::string::npos) end = text.size();
        std::string line = trim_ascii(std::string_view(text).substr(pos, end - pos));
        pos = end + 1;
        if (line.empty() || line[0] == ';' || line[0] == '#') continue;
        if (line.front() == '[' && line.back() == ']') {
            cur_sec = trim_ascii(std::string_view(line).substr(1, line.size() - 2));
            continue;
        }
        if ((section.empty() && cur_sec.empty()) || iequals_ascii(cur_sec, section)) {
            size_t eq = line.find('=');
            if (eq != std::string::npos) {
                std::string k = trim_ascii(std::string_view(line).substr(0, eq));
                if (iequals_ascii(k, key)) {
                    return trim_ascii(std::string_view(line).substr(eq + 1));
                }
            }
        }
    }
    return {};
}

void ini_set_kv(std::string &text, const char *section, const char *key, const char *val) {
    std::vector<std::string> lines;
    size_t pos = 0;
    while (pos < text.size()) {
        size_t end = text.find('\n', pos);
        if (end == std::string::npos) {
            std::string l = text.substr(pos);
            if (!l.empty() && l.back() == '\r') l.pop_back();
            lines.push_back(std::move(l));
            break;
        }
        std::string l = text.substr(pos, end - pos);
        if (!l.empty() && l.back() == '\r') l.pop_back();
        lines.push_back(std::move(l));
        pos = end + 1;
    }

    const bool root_sec = (!section || !section[0]);
    bool in_sec = root_sec;
    bool sec_found = root_sec;
    bool key_written = false;
    size_t insert_at = lines.size();

    for (size_t i = 0; i < lines.size(); ++i) {
        std::string trimmed = trim_ascii(lines[i]);
        if (!trimmed.empty() && trimmed.front() == '[' && trimmed.back() == ']') {
            if (in_sec && !root_sec && !key_written) {
                insert_at = i;
            }
            std::string sec_name = trim_ascii(std::string_view(trimmed).substr(1, trimmed.size() - 2));
            in_sec = !root_sec && iequals_ascii(sec_name, section);
            if (in_sec) sec_found = true;
            continue;
        }
        if (in_sec && !trimmed.empty() && trimmed[0] != ';' && trimmed[0] != '#') {
            size_t eq = trimmed.find('=');
            if (eq != std::string::npos) {
                std::string k = trim_ascii(std::string_view(trimmed).substr(0, eq));
                if (iequals_ascii(k, key)) {
                    lines[i] = std::string(key) + "=" + val;
                    key_written = true;
                    break;
                }
            }
        }
    }

    if (!key_written) {
        if (!sec_found && !root_sec) {
            if (!lines.empty() && !lines.back().empty()) lines.push_back({});
            lines.push_back(std::string("[") + section + "]");
            lines.push_back(std::string(key) + "=" + val);
        } else {
            lines.insert(lines.begin() + static_cast<ptrdiff_t>(insert_at), std::string(key) + "=" + val);
        }
    }

    std::string out;
    out.reserve(text.size() + 64);
    for (const auto &l : lines) {
        out += l;
        out += "\r\n";
    }
    text = std::move(out);
}

bool parse_float_safe(const std::string &s, float *out) {
    if (s.empty() || !out) return false;
    char *endp = nullptr;
    float v = strtof(s.c_str(), &endp);
    if (endp == s.c_str() || !std::isfinite(v)) return false;
    *out = v;
    return true;
}

#ifdef _WIN64
struct RenodxLiveAtomics {
    HMODULE bound_mod = nullptr;
    bool checked = false;
    bool valid = false;
    volatile long *nr_passes = nullptr;
    volatile long *nr_style = nullptr;
    volatile long *nr_look_upsample = nullptr;
    volatile long *nr_detail_stability = nullptr;
    volatile long *nr_intensity_bits = nullptr;
    volatile long *nr_local_tone_bits = nullptr;
    volatile long *nr_local_structure_bits = nullptr;
    volatile long *nr_res_scale_bits = nullptr;
    volatile long *nr_look_strength_bits = nullptr;
    volatile long *nr_look_colour_bits = nullptr;
    volatile long *nr_look_tone_bits = nullptr;
    volatile long *nr_look_detail_bits = nullptr;
    uint8_t *nr_skin_independent = nullptr;
    uint8_t *nr_follow_input_res = nullptr;
    uint8_t *nr_look_mode = nullptr;
};

RenodxLiveAtomics g_rx_atomics = {};

inline void store_atomic_float(volatile long *dst, float val) {
    if (!dst) return;
    long bits = 0;
    memcpy(&bits, &val, sizeof(long));
    _InterlockedExchange(dst, bits);
}

inline float load_atomic_float(volatile long *src, float fallback) {
    if (!src) return fallback;
    long bits = _InterlockedCompareExchange(src, 0, 0);
    float val = fallback;
    memcpy(&val, &bits, sizeof(float));
    return std::isfinite(val) ? val : fallback;
}

inline void store_atomic_bool(uint8_t *dst, bool val) {
    if (!dst) return;
    __atomic_store_n(dst, static_cast<uint8_t>(val ? 1 : 0), __ATOMIC_SEQ_CST);
}

inline bool load_atomic_bool(const uint8_t *src, bool fallback) {
    if (!src) return fallback;
    return __atomic_load_n(src, __ATOMIC_SEQ_CST) != 0;
}

bool ensure_renodx_atomics_bound() {
    HMODULE mod = GetModuleHandleW(L"renodx-dlss5.addon64");
    if (!mod) {
        g_rx_atomics = {};
        return false; // 尚未加载完成，稍后重试
    }
    if (g_rx_atomics.bound_mod == mod && g_rx_atomics.checked) {
        return g_rx_atomics.valid;
    }

    g_rx_atomics = {};
    g_rx_atomics.bound_mod = mod;
    g_rx_atomics.checked = true;
    // The live adapter is scoped to the verified RenoDX build in runtime-catalog.json.
    wchar_t name[32768];
    const DWORD length = GetModuleFileNameW(mod, name, 32768);
    if (!length || length >= 32768) return false;
    std::string image = read_utf8_file_w(name);
    if (image.size() != 3141632) return false;
    static constexpr unsigned char expected[] = {0xdc,0xd9,0x38,0x81,0xe9,0x76,0xad,0x03,0x3d,0x83,0xc2,0xbb,0x01,0xf4,0xbc,0x3e,0x4d,0xdc,0x59,0xc1,0x5f,0xe0,0xdd,0x4c,0xa1,0x65,0xbc,0x5f,0xc7,0xd1,0xac,0x68};
    unsigned char sha[32] = {};
    if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, reinterpret_cast<unsigned char *>(image.data()),
                   static_cast<ULONG>(image.size()), sha, sizeof(sha)) != 0 || memcmp(sha, expected, sizeof(sha))) return false;
    auto *base = reinterpret_cast<uint8_t *>(mod);
    auto *dos = reinterpret_cast<IMAGE_DOS_HEADER *>(base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    auto *nt = reinterpret_cast<IMAGE_NT_HEADERS64 *>(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE || nt->OptionalHeader.SizeOfImage != 0x30C000) return false;

    struct DescCheck {
        uint32_t entry_rva;
        const char *key;
        int slot; // 1: float*, 2: int*, 3: bool*
        uint32_t ptr_rva;
    };
    static const DescCheck kChecks[] = {
        {0x2a8da0, "NRIntensity",       1, 0x2e55d0},
        {0x2a8e10, "NRStyle",           2, 0x2ea0f4},
        {0x2a8e40, "NRLocalTone",       1, 0x2e55d4},
        {0x2a8e78, "NRLocalStructure",  1, 0x2e55d8},
        {0x2a8ef0, "NRSkinIndependent", 3, 0x2e55e0},
        {0x2a9130, "NRFollowInputRes",  3, 0x2ea208},
        {0x2a9170, "NRResolutionScale", 1, 0x2e5678},
        {0x2a91b0, "NRPasses",          2, 0x2e55f0},
        {0x2a9c38, "NRLookMode",        3, 0x2ea11a},
        {0x2a9c70, "NRLookStrength",    1, 0x2e5640},
        {0x2a9d90, "NRLookColour",      1, 0x2e564c},
        {0x2a9ee8, "NRLookTone",        1, 0x2e5660},
        {0x2a9f20, "NRLookDetail",      1, 0x2e5664},
        {0x2aa0c8, "NRLookUpsample",    2, 0x2ea138},
        {0x2aa100, "NRDetailStability", 2, 0x2ea13c},
    };

    const uintptr_t rdata_min = reinterpret_cast<uintptr_t>(base + 0x15F000);
    const uintptr_t rdata_max = reinterpret_cast<uintptr_t>(base + 0x2E2000);
    for (const auto &c : kChecks) {
        const auto *qwords = reinterpret_cast<const uintptr_t *>(base + c.entry_rva);
        if (qwords[0] < rdata_min || qwords[0] >= rdata_max) return false;
        if (strcmp(reinterpret_cast<const char *>(qwords[0]), c.key) != 0) return false;
        if (qwords[c.slot] != reinterpret_cast<uintptr_t>(base + c.ptr_rva)) return false;
    }

    g_rx_atomics.nr_intensity_bits       = reinterpret_cast<volatile long *>(base + 0x2e55d0);
    g_rx_atomics.nr_local_tone_bits      = reinterpret_cast<volatile long *>(base + 0x2e55d4);
    g_rx_atomics.nr_local_structure_bits = reinterpret_cast<volatile long *>(base + 0x2e55d8);
    g_rx_atomics.nr_res_scale_bits       = reinterpret_cast<volatile long *>(base + 0x2e5678);
    g_rx_atomics.nr_look_strength_bits   = reinterpret_cast<volatile long *>(base + 0x2e5640);
    g_rx_atomics.nr_look_colour_bits     = reinterpret_cast<volatile long *>(base + 0x2e564c);
    g_rx_atomics.nr_look_tone_bits       = reinterpret_cast<volatile long *>(base + 0x2e5660);
    g_rx_atomics.nr_look_detail_bits     = reinterpret_cast<volatile long *>(base + 0x2e5664);

    g_rx_atomics.nr_style                = reinterpret_cast<volatile long *>(base + 0x2ea0f4);
    g_rx_atomics.nr_passes               = reinterpret_cast<volatile long *>(base + 0x2e55f0);
    g_rx_atomics.nr_look_upsample        = reinterpret_cast<volatile long *>(base + 0x2ea138);
    g_rx_atomics.nr_detail_stability     = reinterpret_cast<volatile long *>(base + 0x2ea13c);

    g_rx_atomics.nr_skin_independent     = base + 0x2e55e0;
    g_rx_atomics.nr_follow_input_res     = base + 0x2ea208;
    g_rx_atomics.nr_look_mode            = base + 0x2ea11a;
    g_rx_atomics.valid = true;
    return true;
}

void apply_tuner_to_renodx_memory() {
    if (!ensure_renodx_atomics_bound()) return;
    _InterlockedExchange(g_rx_atomics.nr_passes, 1);
    _InterlockedExchange(g_rx_atomics.nr_style, g_tuner.nr_style);
    _InterlockedExchange(g_rx_atomics.nr_look_upsample, 1);
    _InterlockedExchange(g_rx_atomics.nr_detail_stability, 0);

    store_atomic_float(g_rx_atomics.nr_intensity_bits, g_tuner.intensity);
    store_atomic_float(g_rx_atomics.nr_local_structure_bits, g_tuner.structure);
    store_atomic_float(g_rx_atomics.nr_local_tone_bits, g_tuner.local_tone);
    store_atomic_float(g_rx_atomics.nr_res_scale_bits, static_cast<float>(g_tuner.work_res) / 100.0f);
    store_atomic_float(g_rx_atomics.nr_look_strength_bits, 1.0f);
    store_atomic_float(g_rx_atomics.nr_look_detail_bits, g_tuner.detail_boost);
    store_atomic_float(g_rx_atomics.nr_look_tone_bits, g_tuner.tone_boost);
    store_atomic_float(g_rx_atomics.nr_look_colour_bits, g_tuner.color_boost);

    store_atomic_bool(g_rx_atomics.nr_skin_independent, g_tuner.structure <= 1.001f);
    store_atomic_bool(g_rx_atomics.nr_follow_input_res, false);
    store_atomic_bool(g_rx_atomics.nr_look_mode, g_tuner.look_enabled);
}

int detect_tuner_preset();

void sync_tuner_from_renodx_memory() {
    if (!ensure_renodx_atomics_bound()) return;
    float fv = load_atomic_float(g_rx_atomics.nr_intensity_bits, g_tuner.intensity);
    if (fv >= 0.4f && fv <= 2.0f) g_tuner.intensity = fv;
    fv = load_atomic_float(g_rx_atomics.nr_local_structure_bits, g_tuner.structure);
    if (fv >= 0.4f && fv <= 2.0f) g_tuner.structure = fv;
    fv = load_atomic_float(g_rx_atomics.nr_local_tone_bits, g_tuner.local_tone);
    if (fv >= 0.4f && fv <= 2.0f) g_tuner.local_tone = fv;
    fv = load_atomic_float(g_rx_atomics.nr_look_detail_bits, g_tuner.detail_boost);
    if (fv >= 0.4f && fv <= 2.0f) g_tuner.detail_boost = fv;
    fv = load_atomic_float(g_rx_atomics.nr_look_tone_bits, g_tuner.tone_boost);
    if (fv >= 0.4f && fv <= 2.0f) g_tuner.tone_boost = fv;
    fv = load_atomic_float(g_rx_atomics.nr_look_colour_bits, g_tuner.color_boost);
    if (fv >= 0.4f && fv <= 2.0f) g_tuner.color_boost = fv;
    fv = load_atomic_float(g_rx_atomics.nr_res_scale_bits, static_cast<float>(g_tuner.work_res) / 100.0f);
    if (fv >= 0.45f && fv <= 1.05f) {
        g_tuner.work_res = static_cast<int>(std::lround(fv * 100.0f));
    }
    const long st = _InterlockedCompareExchange(g_rx_atomics.nr_style, 0, 0);
    if (st >= 0 && st <= 2) g_tuner.nr_style = static_cast<int>(st);
    g_tuner.look_enabled = load_atomic_bool(g_rx_atomics.nr_look_mode, g_tuner.look_enabled);
    g_tuner.preset_idx = detect_tuner_preset();
}
#endif

int detect_tuner_preset() {
    auto nearf = [](float a, float b) { return std::fabs(a - b) <= 0.035f; };
    if (nearf(g_tuner.intensity, 1.35f) && nearf(g_tuner.structure, 1.30f) && g_tuner.look_enabled && nearf(g_tuner.detail_boost, 1.35f) && std::abs(g_tuner.work_res - 75) <= 2) return 0;
    if (nearf(g_tuner.intensity, 1.30f) && nearf(g_tuner.structure, 1.25f) && g_tuner.look_enabled && nearf(g_tuner.detail_boost, 1.40f) && std::abs(g_tuner.work_res - 67) <= 2) return 1;
    if (nearf(g_tuner.intensity, 1.55f) && nearf(g_tuner.structure, 1.45f) && g_tuner.look_enabled && nearf(g_tuner.detail_boost, 1.45f) && std::abs(g_tuner.work_res - 100) <= 2) return 2;
    if (nearf(g_tuner.intensity, 1.00f) && nearf(g_tuner.structure, 1.00f) && !g_tuner.look_enabled) return 3;
    return 4;
}

void reload_tuner_from_disk(bool sync_memory = false) {
    float fv = 0.0f;
    std::string ini = read_utf8_file_w(g_consumer_ini_w);
    if (!ini.empty()) {
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRIntensity"), &fv) && fv >= 0.4f && fv <= 2.0f) g_tuner.intensity = fv;
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRLocalStructure"), &fv) && fv >= 0.4f && fv <= 2.0f) g_tuner.structure = fv;
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRLocalTone"), &fv) && fv >= 0.4f && fv <= 2.0f) g_tuner.local_tone = fv;
        std::string lm = ini_get_str(ini, "RenoDX.DLSS5", "NRLookMode");
        if (!lm.empty()) g_tuner.look_enabled = (lm == "1" || iequals_ascii(lm, "true"));
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRLookDetail"), &fv) && fv >= 0.4f && fv <= 2.0f) g_tuner.detail_boost = fv;
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRLookTone"), &fv) && fv >= 0.4f && fv <= 2.0f) g_tuner.tone_boost = fv;
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRLookColour"), &fv) && fv >= 0.4f && fv <= 2.0f) g_tuner.color_boost = fv;
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRStyle"), &fv) && fv >= 0.0f && fv <= 2.0f) g_tuner.nr_style = static_cast<int>(fv);
        if (parse_float_safe(ini_get_str(ini, "RenoDX.DLSS5", "NRResolutionScale"), &fv) && fv >= 0.45f && fv <= 1.05f) {
            g_tuner.work_res = static_cast<int>(std::lround(fv * 100.0f));
        }
    }

    g_tuner.has_feeder_cfg = file_exists_w(g_feed_cfg_w);
    if (g_tuner.has_feeder_cfg) {
        std::string cfg = read_utf8_file_w(g_feed_cfg_w);
        if (!cfg.empty()) {
            if (ini.empty() && parse_float_safe(ini_get_str(cfg, "", "work_resolution"), &fv) && fv >= 50.0f && fv <= 100.0f) {
                g_tuner.work_res = static_cast<int>(std::lround(fv));
            }
            if (parse_float_safe(ini_get_str(cfg, "", "work_upscale"), &fv) && fv >= 0.0f && fv <= 2.0f) {
                g_tuner.work_upscale = static_cast<int>(std::lround(fv));
            }
            if (parse_float_safe(ini_get_str(cfg, "", "work_sharpness"), &fv) && fv >= 0.0f && fv <= 1.0f) {
                g_tuner.sharpness = fv;
            }
            if (parse_float_safe(ini_get_str(cfg, "", "hold_strength"), &fv) && fv >= 0.0f && fv <= 1.0f) {
                g_tuner.hold_strength = fv;
            }
        }
    }

    g_tuner.preset_idx = detect_tuner_preset();
    get_file_mtime_w(g_consumer_ini_w, &g_last_ini_mtime);
#ifdef _WIN64
    if (sync_memory && !ini.empty()) {
        apply_tuner_to_renodx_memory();
    }
#else
    (void)sync_memory;
#endif
}

void init_singlepass_tuner() {
    if (g_tuner.initialized) return;
    g_tuner.initialized = true;

    std::wstring full(32768, L'\0');
    const DWORD length = GetModuleFileNameW(nullptr, full.data(), static_cast<DWORD>(full.size()));
    if (!length || length >= full.size()) return;
    full.resize(length);
    size_t slash = full.find_last_of(L"\\/");
    const size_t filename = slash == std::wstring::npos ? 0 : slash + 1;
    g_tuner.is_host64 = _wcsicmp(full.c_str() + filename, L"dlss5-feed-host64.exe") == 0;
    g_exe_dir_w = (slash != std::wstring::npos) ? full.substr(0, slash) : L".";

#ifdef _WIN64
    g_consumer_ini_w = g_exe_dir_w + L"\\ReShade.ini";
    if (g_tuner.is_host64) {
        size_t parent_slash = g_exe_dir_w.find_last_of(L"\\/");
        std::wstring parent_dir = (parent_slash != std::wstring::npos) ? g_exe_dir_w.substr(0, parent_slash) : g_exe_dir_w;
        g_feed_cfg_w = parent_dir + L"\\dlss5-feed.cfg";
    } else {
        g_feed_cfg_w = g_exe_dir_w + L"\\dlss5-feed.cfg";
    }
#else
    g_consumer_ini_w = g_exe_dir_w + L"\\host64\\ReShade.ini";
    g_feed_cfg_w = g_exe_dir_w + L"\\dlss5-feed.cfg";
#endif
    reload_tuner_from_disk(false);
}

void persist_tuner_to_disk() {
    char num[32] = {};
#ifdef _WIN64
    if (!g_tuner.is_host64) {
        // 64 位原生进程直接通过 ReShade 官方配置接口写入内存缓存并落盘，避免关闭 Home 菜单时被 ReShade 旧缓存回写覆盖
        reshade::set_config_value(nullptr, "RenoDX DLSS", "NRPasses", "1");
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "ConfigVersion", "7");
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NeuralUplift", "1");
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRPasses", "1");
        snprintf(num, sizeof(num), "%.2f", g_tuner.intensity);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRIntensity", static_cast<const char *>(num));
        snprintf(num, sizeof(num), "%.2f", g_tuner.structure);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLocalStructure", static_cast<const char *>(num));
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRSkinIndependent", g_tuner.structure > 1.001f ? "0" : "1");
        snprintf(num, sizeof(num), "%.2f", g_tuner.local_tone);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLocalTone", static_cast<const char *>(num));
        snprintf(num, sizeof(num), "%d", g_tuner.nr_style);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRStyle", static_cast<const char *>(num));
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLookMode", g_tuner.look_enabled ? "1" : "0");
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLookStrength", "1");
        snprintf(num, sizeof(num), "%.2f", g_tuner.detail_boost);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLookDetail", static_cast<const char *>(num));
        snprintf(num, sizeof(num), "%.2f", g_tuner.tone_boost);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLookTone", static_cast<const char *>(num));
        snprintf(num, sizeof(num), "%.2f", g_tuner.color_boost);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLookColour", static_cast<const char *>(num));
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRDetailStability", "0");
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRLookUpsample", "1");
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRFollowInputRes", "0");
        snprintf(num, sizeof(num), "%.2f", static_cast<float>(g_tuner.work_res) / 100.0f);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRResolutionScale", static_cast<const char *>(num));
        const int worksets = g_tuner.work_res <= 68 ? 2 : (g_tuner.work_res <= 80 ? 3 : 6);
        snprintf(num, sizeof(num), "%d", worksets);
        reshade::set_config_value(nullptr, "RenoDX.DLSS5", "NRMaxWorksets", static_cast<const char *>(num));
    } else
#endif
    if (!g_consumer_ini_w.empty()) {
        std::string ini = read_utf8_file_w(g_consumer_ini_w);
        if (ini.empty() && file_exists_w(g_consumer_ini_w)) return;
        ini_set_kv(ini, "RenoDX DLSS", "NRPasses", "1");
        ini_set_kv(ini, "RenoDX.DLSS5", "ConfigVersion", "7");
        ini_set_kv(ini, "RenoDX.DLSS5", "NeuralUplift", "1");
        ini_set_kv(ini, "RenoDX.DLSS5", "NRPasses", "1");
        snprintf(num, sizeof(num), "%.2f", g_tuner.intensity);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRIntensity", num);
        snprintf(num, sizeof(num), "%.2f", g_tuner.structure);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLocalStructure", num);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRSkinIndependent", g_tuner.structure > 1.001f ? "0" : "1");
        snprintf(num, sizeof(num), "%.2f", g_tuner.local_tone);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLocalTone", num);
        snprintf(num, sizeof(num), "%d", g_tuner.nr_style);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRStyle", num);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLookMode", g_tuner.look_enabled ? "1" : "0");
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLookStrength", "1");
        snprintf(num, sizeof(num), "%.2f", g_tuner.detail_boost);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLookDetail", num);
        snprintf(num, sizeof(num), "%.2f", g_tuner.tone_boost);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLookTone", num);
        snprintf(num, sizeof(num), "%.2f", g_tuner.color_boost);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLookColour", num);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRDetailStability", "0");
        ini_set_kv(ini, "RenoDX.DLSS5", "NRLookUpsample", "1");
        ini_set_kv(ini, "RenoDX.DLSS5", "NRFollowInputRes", "0");
        snprintf(num, sizeof(num), "%.2f", static_cast<float>(g_tuner.work_res) / 100.0f);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRResolutionScale", num);
        const int worksets = g_tuner.work_res <= 68 ? 2 : (g_tuner.work_res <= 80 ? 3 : 6);
        snprintf(num, sizeof(num), "%d", worksets);
        ini_set_kv(ini, "RenoDX.DLSS5", "NRMaxWorksets", num);
        write_utf8_atomic_w(g_consumer_ini_w, ini);
        get_file_mtime_w(g_consumer_ini_w, &g_last_ini_mtime);
    }

    if (g_tuner.has_feeder_cfg || file_exists_w(g_feed_cfg_w)) {
        g_tuner.has_feeder_cfg = true;
        std::string cfg = read_utf8_file_w(g_feed_cfg_w);
        if (cfg.empty()) return;
        snprintf(num, sizeof(num), "%d", g_tuner.work_res);
        ini_set_kv(cfg, "", "work_resolution", num);
        snprintf(num, sizeof(num), "%d", g_tuner.work_upscale);
        ini_set_kv(cfg, "", "work_upscale", num);
        snprintf(num, sizeof(num), "%.2f", g_tuner.sharpness);
        ini_set_kv(cfg, "", "work_sharpness", num);
        snprintf(num, sizeof(num), "%.2f", g_tuner.hold_strength);
        ini_set_kv(cfg, "", "hold_strength", num);
        ini_set_kv(cfg, "", "hold_tolerance", "0.05");
        write_utf8_atomic_w(g_feed_cfg_w, cfg);
    }
}

void apply_tuner_preset(int idx) {
    g_tuner.preset_idx = idx;
    if (idx == 0) { // 单层强效·省卡推荐
        g_tuner.intensity = 1.35f;
        g_tuner.structure = 1.30f;
        g_tuner.local_tone = 1.22f;
        g_tuner.look_enabled = true;
        g_tuner.detail_boost = 1.35f;
        g_tuner.tone_boost = 1.15f;
        g_tuner.color_boost = 1.08f;
        g_tuner.nr_style = 1;
        g_tuner.work_res = 75;
        g_tuner.work_upscale = 1;
        g_tuner.sharpness = 0.35f;
        g_tuner.hold_strength = 0.30f;
    } else if (idx == 1) { // 极致省卡·高帧优先
        g_tuner.intensity = 1.30f;
        g_tuner.structure = 1.25f;
        g_tuner.local_tone = 1.18f;
        g_tuner.look_enabled = true;
        g_tuner.detail_boost = 1.40f;
        g_tuner.tone_boost = 1.12f;
        g_tuner.color_boost = 1.06f;
        g_tuner.nr_style = 1;
        g_tuner.work_res = 67;
        g_tuner.work_upscale = 1;
        g_tuner.sharpness = 0.45f;
        g_tuner.hold_strength = 0.40f;
    } else if (idx == 2) { // 单层满血·极限质感
        g_tuner.intensity = 1.55f;
        g_tuner.structure = 1.45f;
        g_tuner.local_tone = 1.35f;
        g_tuner.look_enabled = true;
        g_tuner.detail_boost = 1.45f;
        g_tuner.tone_boost = 1.22f;
        g_tuner.color_boost = 1.12f;
        g_tuner.nr_style = 1;
        g_tuner.work_res = 100;
        g_tuner.work_upscale = 2;
        g_tuner.sharpness = 0.28f;
        g_tuner.hold_strength = 0.25f;
    } else if (idx == 3) { // 原厂标准 1.0x
        g_tuner.intensity = 1.00f;
        g_tuner.structure = 1.00f;
        g_tuner.local_tone = 1.00f;
        g_tuner.look_enabled = false;
        g_tuner.detail_boost = 1.00f;
        g_tuner.tone_boost = 1.00f;
        g_tuner.color_boost = 1.00f;
        g_tuner.nr_style = 0;
        g_tuner.work_res = 75;
        g_tuner.work_upscale = 1;
        g_tuner.sharpness = 0.15f;
        g_tuner.hold_strength = 0.00f;
    }
#ifdef _WIN64
    apply_tuner_to_renodx_memory();
#endif
    persist_tuner_to_disk();
}

void refresh_bridge_tuner() {
#ifdef _WIN64
    if (!g_tuner.is_host64 || GetTickCount64() - g_last_poll_tick < 500) return;
    g_last_poll_tick = GetTickCount64();
    FILETIME current{};
    if (get_file_mtime_w(g_consumer_ini_w, &current) && CompareFileTime(&current, &g_last_ini_mtime))
        reload_tuner_from_disk(true);
#endif
}
void draw_tuner_settings() {
    init_singlepass_tuner();
#ifdef _WIN64
    if (!GetModuleHandleW(L"renodx-dlss5.addon64")) return;
    const bool live = ensure_renodx_atomics_bound();
    if (live && !ImGui::IsAnyItemActive()) sync_tuner_from_renodx_memory();
    ImGui::TextUnformatted(live ? "单遍神经渲染 / Single-pass NR" : "单遍神经渲染 / Single-pass NR (restart to apply)");
#else
    if (!g_tuner.has_feeder_cfg || !file_exists_w(g_consumer_ini_w)) return;
    ImGui::TextUnformatted("单遍神经渲染 / Feeder host64");
#endif
    const char *presets[] = {"省卡强化 / Balanced","高帧优先 / Performance","质感优先 / Quality","原厂标准 / Standard"};
    for (int i = 0; i < 4; ++i) if (ImGui::Button(presets[i])) apply_tuner_preset(i);
    bool changed = ImGui::SliderFloat("强度 / Intensity",&g_tuner.intensity,0.4f,2.f);
    changed |= ImGui::SliderFloat("结构 / Structure",&g_tuner.structure,0.4f,2.f);
    changed |= ImGui::SliderFloat("局部色调 / Local tone",&g_tuner.local_tone,0.4f,2.f);
    changed |= ImGui::SliderInt("工作分辨率 / Resolution (%)",&g_tuner.work_res,50,100);
    changed |= ImGui::Checkbox("外观调整 / Look",&g_tuner.look_enabled);
    if (g_tuner.look_enabled) {
        changed |= ImGui::SliderFloat("细节 / Detail",&g_tuner.detail_boost,0.4f,2.f);
        changed |= ImGui::SliderFloat("色调 / Tone",&g_tuner.tone_boost,0.4f,2.f);
        changed |= ImGui::SliderFloat("颜色 / Colour",&g_tuner.color_boost,0.4f,2.f);
    }
    if (g_tuner.has_feeder_cfg) {
        changed |= ImGui::SliderFloat("锐化 / Sharpness",&g_tuner.sharpness,0.f,1.f);
        changed |= ImGui::SliderFloat("稳定 / Hold",&g_tuner.hold_strength,0.f,1.f);
        changed |= ImGui::SliderInt("回拉 / Upscale",&g_tuner.work_upscale,0,2);
    }
    if (changed) {
#ifdef _WIN64
        apply_tuner_to_renodx_memory();
#endif
        persist_tuner_to_disk();
    }
}
