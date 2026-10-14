using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace AurumInstallerTests {
    // Use the Unicode shell interface directly. WScript.Shell's automation
    // setters reject non-ANSI fixture paths on some Windows Server images.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkUnicode {
        [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, IntPtr findData, uint flags);
        [PreserveSig] int GetIDList(out IntPtr list);
        [PreserveSig] int SetIDList(IntPtr list);
        [PreserveSig] int GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int length);
        [PreserveSig] int SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        [PreserveSig] int GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length);
        [PreserveSig] int SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        [PreserveSig] int GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int length);
        [PreserveSig] int SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        [PreserveSig] int GetHotkey(out ushort key);
        [PreserveSig] int SetHotkey(ushort key);
        [PreserveSig] int GetShowCmd(out int command);
        [PreserveSig] int SetShowCmd(int command);
        [PreserveSig] int GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, out int index);
        [PreserveSig] int SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        [PreserveSig] int SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        [PreserveSig] int Resolve(IntPtr window, uint flags);
        [PreserveSig] int SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    public sealed class ShortcutInfo {
        public string TargetPath, WorkingDirectory, IconLocation, Arguments, Description;
        public ushort Hotkey;
        public int WindowStyle;
    }

    public static class ShortcutFixture {
        static object NewLink() {
            return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
        }
        static void Check(int result) { Marshal.ThrowExceptionForHR(result); }

        public static void Create(string file, string target, string working, string icon) {
            object instance = NewLink();
            try {
                var link = (IShellLinkUnicode)instance;
                Check(link.SetPath(target));
                Check(link.SetWorkingDirectory(working));
                Check(link.SetIconLocation(icon, 0));
                Check(link.SetArguments("--test \"argument with spaces\""));
                Check(link.SetDescription("Keep this description"));
                Check(link.SetHotkey(0x0678)); // Ctrl+Alt+F9, saved in the file only.
                Check(link.SetShowCmd(7));
                ((IPersistFile)instance).Save(file, true);
            } finally { Marshal.FinalReleaseComObject(instance); }
        }

        public static ShortcutInfo Read(string file) {
            object instance = NewLink();
            try {
                ((IPersistFile)instance).Load(file, 0);
                var link = (IShellLinkUnicode)instance;
                var text = new StringBuilder(1024);
                var result = new ShortcutInfo();
                Check(link.GetPath(text, text.Capacity, IntPtr.Zero, 4)); result.TargetPath = text.ToString();
                text.Clear(); Check(link.GetWorkingDirectory(text, text.Capacity)); result.WorkingDirectory = text.ToString();
                int index;
                text.Clear(); Check(link.GetIconLocation(text, text.Capacity, out index)); result.IconLocation = text.ToString() + "," + index;
                text.Clear(); Check(link.GetArguments(text, text.Capacity)); result.Arguments = text.ToString();
                text.Clear(); Check(link.GetDescription(text, text.Capacity)); result.Description = text.ToString();
                ushort key; Check(link.GetHotkey(out key)); result.Hotkey = key;
                int command; Check(link.GetShowCmd(out command)); result.WindowStyle = command;
                return result;
            } finally { Marshal.FinalReleaseComObject(instance); }
        }
    }
}
