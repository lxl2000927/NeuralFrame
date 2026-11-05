// Isolated 32-bit process: checks the proxy without loading a game or renderer.
#include <windows.h>
#include <mmsystem.h>
#include <stdio.h>

typedef DWORD (WINAPI *TickFn)(void);
typedef MMRESULT (WINAPI *CapsFn)(LPTIMECAPS, UINT);
static TickFn timer;
static DWORD WINAPI timer_thread(void *unused) {
    (void)unused;
    DWORD before = timer();
    Sleep(25);
    DWORD after = timer();
    return (after - before) < 1000 ? 0 : 1;
}

int main(int argc, char **argv) {
    if (argc != 2) return 1;
    HMODULE proxy = LoadLibraryA(argv[1]);
    if (!proxy) { fprintf(stderr, "LoadLibrary failed: %lu\n", GetLastError()); return 2; }
    timer = (TickFn)GetProcAddress(proxy, "timeGetTime");
    CapsFn caps_fn = (CapsFn)GetProcAddress(proxy, "timeGetDevCaps");
    if (!timer || !caps_fn) return 3;
    TIMECAPS caps = {0};
    if (caps_fn(&caps, sizeof(caps)) != TIMERR_NOERROR || caps.wPeriodMin == 0) return 4;
    if ((DWORD)(timer() - GetTickCount()) > 1000 && (DWORD)(GetTickCount() - timer()) > 1000) return 5;
    HMODULE dependency = LoadLibraryW(L"version.dll");
    if (!dependency) return 6;
    FreeLibrary(dependency);
    HANDLE threads[4];
    for (int i = 0; i < 4; ++i) {
        threads[i] = CreateThread(NULL, 0, timer_thread, NULL, 0, NULL);
        if (!threads[i]) return 7;
    }
    if (WaitForMultipleObjects(4, threads, TRUE, 5000) != WAIT_OBJECT_0) return 8;
    for (int i = 0; i < 4; ++i) {
        DWORD result = 1;
        GetExitCodeThread(threads[i], &result);
        CloseHandle(threads[i]);
        if (result != 0) return 9;
    }
    // Keep the preloader resident until process exit, as in a game session.
    printf("PASS x86 proxy load, timeGetTime, forwarded timeGetDevCaps, LoadLibrary and concurrent timer calls\n");
    return 0;
}
