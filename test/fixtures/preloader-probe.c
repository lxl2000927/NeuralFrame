#include <windows.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char** argv) {
    DWORD_PTR beforeMask = 0, sysMask = 0, afterMask = 0;
    GetProcessAffinityMask(GetCurrentProcess(), &beforeMask, &sysMask);
    if (argc > 1 && !strcmp(argv[1], "host")) {
        printf("{\"hostMask\":%llu}\n", (unsigned long long)beforeMask);
        return 0;
    }
    SYSTEM_INFO before, after;
    MEMORYSTATUS memoryBefore = {sizeof(MEMORYSTATUS)}, memoryAfter = {sizeof(MEMORYSTATUS)};
    GetSystemInfo(&before); GlobalMemoryStatus(&memoryBefore);
    HMODULE module = LoadLibraryW(L".\\winmm.dll");
    if (!module) { printf("load error %lu\n", GetLastError()); return 2; }
    DWORD (WINAPI *timeGetTimeFn)(void) = (void*)GetProcAddress(module,"timeGetTime");
    if (!timeGetTimeFn) return 3;
    timeGetTimeFn();
    GetSystemInfo(&after); GlobalMemoryStatus(&memoryAfter);
    GetProcessAffinityMask(GetCurrentProcess(), &afterMask, &sysMask);
    HKEY key = NULL; DWORD value = 0, size = sizeof(value), type = 0;
    LONG rc = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"Software\\NeuralFrameNativeProbe", 0, KEY_READ, &key);
    if (rc == ERROR_SUCCESS) { rc = RegQueryValueExW(key,L"Value",NULL,&type,(BYTE*)&value,&size); RegCloseKey(key); }
    printf("{\"beforeCpu\":%lu,\"afterCpu\":%lu,\"beforeMask\":%llu,\"afterMask\":%llu,\"beforeMemory\":%lu,\"afterMemory\":%lu,\"registryCode\":%ld,\"registryValue\":%lu}\n", before.dwNumberOfProcessors,after.dwNumberOfProcessors,(unsigned long long)beforeMask,(unsigned long long)afterMask,memoryBefore.dwTotalPhys,memoryAfter.dwTotalPhys,rc,value);
    fflush(stdout);
    STARTUPINFOW startup = {sizeof(STARTUPINFOW)}; PROCESS_INFORMATION process = {0};
    WCHAR command[] = L"host64\\dlss5-feed-host64.exe host";
    if (!CreateProcessW(NULL,command,NULL,NULL,TRUE,0,NULL,NULL,&startup,&process)) return 4;
    if (WaitForSingleObject(process.hProcess,10000) != WAIT_OBJECT_0) { TerminateProcess(process.hProcess,9); return 5; }
    DWORD exitCode; GetExitCodeProcess(process.hProcess,&exitCode); CloseHandle(process.hThread); CloseHandle(process.hProcess);
    return exitCode;
}
