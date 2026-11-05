// SPDX-License-Identifier: MIT
// ReShade is built with MSVC. Compile this small ImVec2-returning thunk with
// the MSVC ABI, not the MinGW ABI used for the rest of the localization add-on.
extern "C" int _fltused = 0;
struct ImVec2 {
    float x, y;
    constexpr ImVec2() : x(0), y(0) {}
    constexpr ImVec2(float a, float b) : x(a), y(b) {}
};
using measure_fn = ImVec2 (*)(const char *, const char *, bool, float);
static measure_fn original_measure = nullptr;
extern "C" const char *zh_translate_measure(const char *, const char *, bool);
static ImVec2 measure_chinese(const char *text, const char *end, bool hide, float wrap) {
    const char *translated = zh_translate_measure(text, end, hide);
    return original_measure(translated ? translated : text, translated ? nullptr : end, hide, wrap);
}
extern "C" void *zh_measure_hook(void *original) {
    original_measure = reinterpret_cast<measure_fn>(original);
    return reinterpret_cast<void *>(&measure_chinese);
}
