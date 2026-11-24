// Public NVIDIA DRS ABI from NVIDIA/nvapi (nvapi.h, nvapi_interface.h and
// NvApiDriverSettings.h). Title/profile checks follow RTX-FG-Manager 4.3.42.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class MilesDriverProfile
{
    const uint CountId = 0x104d6667; // NGX_DLSSG_MULTI_FRAME_COUNT_ID
    const int AppSize = 20492, ProfileSize = 4116, SettingSize = 12320;
    const int SettingId = 4100, SettingType = 4104, Location = 4108, Predefined = 4112, Current = 8220;
    const string Renderer = "MilesMorales.exe";

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("nvapi64.dll", EntryPoint="nvapi_QueryInterface", CallingConvention=CallingConvention.Cdecl)]
    static extern IntPtr Query(uint id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Simple();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Create(out IntPtr session);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Session(IntPtr session);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Profile(IntPtr session, out IntPtr profile);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Find(IntPtr session, IntPtr name, out IntPtr profile, IntPtr app);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int BufferCall(IntPtr session, IntPtr profile, IntPtr data);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int ListApps(IntPtr session, IntPtr profile, uint start, ref uint count, IntPtr data);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Get(IntPtr session, IntPtr profile, uint id, IntPtr setting);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Delete(IntPtr session, IntPtr profile, uint id);

    static T Fn<T>(uint id) where T : class {
        IntPtr p = Query(id);
        if (p == IntPtr.Zero) throw new InvalidOperationException("NVIDIA DRS interface unavailable.");
        return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T));
    }
    static void Check(int result) {
        if (result != 0) throw new InvalidOperationException("NVIDIA DRS " + result);
    }
    sealed class Buffer : IDisposable {
        readonly byte[] bytes;
        GCHandle pin;
        public IntPtr Ptr { get { return pin.AddrOfPinnedObject(); } }
        public Buffer(int size, int revision, int count = 1) {
            bytes = new byte[checked(size * count)];
            pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            for (int i=0; i<count; i++) Put(i*size, size | (revision << 16));
        }
        public int At(int offset) { return BitConverter.ToInt32(bytes, offset); }
        public void Put(int offset, int value) { Marshal.WriteInt32(Ptr, offset, value); }
        public string Name(int offset) {
            string text = Encoding.Unicode.GetString(bytes, offset, 4096);
            int end = text.IndexOf('\0');
            if (end < 0) throw new InvalidOperationException("Invalid DRS profile name.");
            return text.Substring(0, end);
        }
        public void Dispose() { pin.Free(); }
    }
    static IntPtr VerifyGame(IntPtr session) {
        IntPtr game, baseProfile, globalProfile;
        using (var app = new Buffer(AppSize,4))
        using (var name = new Buffer(4096,0))
        using (var info = new Buffer(ProfileSize,1)) {
            byte[] utf16 = Encoding.Unicode.GetBytes(Renderer + "\0");
            Marshal.Copy(utf16,0,name.Ptr,utf16.Length);
            Check(Fn<Find>(0xeee566b2)(session,name.Ptr,out game,app.Ptr));
            Check(Fn<Profile>(0xda8466a0)(session,out baseProfile));
            Check(Fn<Profile>(0x617bff9f)(session,out globalProfile));
            Check(Fn<BufferCall>(0x61cd6fd6)(session,game,info.Ptr));
            int count = info.At(4108);
            if (game == IntPtr.Zero || game == baseProfile || game == globalProfile || info.At(4104) == 0 ||
                count < 1 || count > 16 || info.Name(4) != "Marvel's Spider-Man: Miles Morales")
                throw new InvalidOperationException("Dedicated Miles Morales driver profile unavailable.");
            using (var list = new Buffer(AppSize,4,count)) {
                uint actual = (uint)count;
                Check(Fn<ListApps>(0x7fa2173a)(session,game,0,ref actual,list.Ptr));
                if (actual != count) throw new InvalidOperationException("Application list changed.");
                bool renderer = false;
                for (int i=0; i<count; i++) {
                    string exe = Path.GetFileName(list.Name(AppSize*i+8)).ToLowerInvariant();
                    if (exe == "milesmorales.exe") renderer = true;
                    else if (exe != "i31_steam_release.exe" && exe != "i31_steam_finaldm.exe")
                        throw new InvalidOperationException("Driver profile also controls another game.");
                }
                if (!renderer) throw new InvalidOperationException("Renderer missing from driver profile.");
            }
        }
        return game;
    }
    // -1 means inherited, including the game's predefined driver value.
    static int Read(IntPtr session, IntPtr game) {
        using (var s = new Buffer(SettingSize,1)) {
            int result = Fn<Get>(0x73bf8338)(session,game,CountId,s.Ptr);
            if (result == -160) return -1;
            Check(result);
            if (s.At(SettingType) != 0) throw new InvalidOperationException("Unexpected DRS setting type.");
            if (s.At(Location) != 0 || s.At(Predefined) != 0) return -1;
            int current = s.At(Current);
            if (current < 0 || current > 15) throw new InvalidOperationException("Unsupported driver count.");
            return current;
        }
    }
    public static int Run(bool write, int expected, int next) {
        if (IntPtr.Size != 8 || expected < -1 || expected > 15 || next < -1 || next > 15)
            throw new InvalidOperationException("Invalid DRS request.");
        var unload = Fn<Simple>(0xd22bdd7e);
        var destroy = Fn<Session>(0xdad9cff8);
        IntPtr session = IntPtr.Zero;
        Check(Fn<Simple>(0x0150e828)());
        try {
            Check(Fn<Create>(0x0694d52e)(out session));
            Check(Fn<Session>(0x375dbd6b)(session));
            IntPtr game = VerifyGame(session);
            int now = Read(session,game);
            if (!write) return now;
            if (now != expected) throw new InvalidOperationException("Driver count changed since preview.");
            if (now == next) return now;
            if (next == -1) Check(Fn<Delete>(0xe4a26362)(session,game,CountId));
            else using (var s = new Buffer(SettingSize,1)) {
                s.Put(SettingId,(int)CountId);
                s.Put(Current,next);
                Check(Fn<BufferCall>(0x577dd202)(session,game,s.Ptr));
            }
            Check(Fn<Session>(0xfcbc7e14)(session));
        } finally {
            if (session != IntPtr.Zero) destroy(session);
            unload();
        }
        if (Run(false,-1,-1) != next) throw new InvalidOperationException("Driver did not retain the requested count.");
        return next;
    }
}
