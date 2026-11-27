#!/usr/bin/env python3
"""PE resource injector: Bloomee.exe mein RT_GROUP_ICON (101),
RT_ICON entries aur RT_MANIFEST (1) dalta hai — taaki bina MSVC/rc ke
exe ka icon, taskbar identity aur manifest active ho jayein.
Istemal: python3 tools/pack-resources.py build/Bloomee.exe [icon.ico] [app.manifest]
Out file waheen overwrite hota hai (backup .bak)."""
import os
import struct
import sys

PAGE = 0x1000
FILE_ALIGN = 0x200


def align(v, a):
    return (v + a - 1) // a * a


def build_rsrc(va, icons, group_blob, manifest):
    """icons: list of (icon_id, bytes). Returns section bytes."""
    # Data entries ordering: types sorted: RT_ICON=3, RT_GROUP_ICON=14, RT_MANIFEST=24
    # Directory layout computed forward; blobs at end.
    dirs = []          # each: (entries list); entries (name, is_dir, target_index)
    data_entries = []  # (blob_bytes)
    # root
    root_children = []
    # RT_ICON name dir
    icon_name_dir_entries = []
    for icon_id, blob in icons:
        data_entries.append(blob)
        icon_name_dir_entries.append((icon_id, False, len(data_entries) - 1))
    # lang dirs are per data item: name dir -> lang dir -> data entry
    # We'll emit dirs breadth: root, icon-names, group-name, manifest-name,
    # then per-icon lang dirs, group lang, manifest lang.
    structure = []
    # placeholder assembled below manually
    total_dirs = 1 + 3 + len(icons) + 2
    # entries size 16 header + 8 per entry
    # compute offsets sequentially
    offsets = []
    pos = 0
    dir_sizes = []
    dir_defs = []  # (namedcount, idcount, entries=[(name, offsetToData/Dir)])

    # define dirs in emission order
    # 0: root (3 entries: 3,14,24)
    # 1: RT_ICON names (n icons)
    # 2: RT_GROUP name (101)
    # 3: RT_MANIFEST name (1)
    # 4..4+n-1: icon lang dirs
    # next: group lang, manifest lang
    n = len(icons)
    idx_icon_lang = 4
    idx_group_lang = 4 + n
    idx_manifest_lang = 5 + n

    def dir_size(count):
        return 16 + 8 * count

    order_counts = [3, n, 1, 1] + [1] * n + [1, 1]
    offs = []
    p = 0
    for c in order_counts:
        offs.append(p)
        p += dir_size(c)
    data_entries_off = p
    p += 16 * (n + 2)
    blob_off = p
    blob_offsets = []
    for i, (_, blob) in enumerate(icons):
        blob_offsets.append(blob_off)
        blob_off += len(blob)
    group_rva_off = blob_off
    blob_off += len(group_blob)
    manifest_off = blob_off
    blob_off += len(manifest)
    total = blob_off

    out = bytearray(total)

    def write_dir(idx, entries):
        """entries: list of (name_or_id, is_dir, child_idx_or_dataindex, data_rva_offset)"""
        o = offs[idx]
        named = 0
        struct.pack_into("<IIHHHH", out, o, 0, 0, 0, 0, named, len(entries))
        eo = o + 16
        for item in entries:
            name = item[0]
            if item[1]:  # dir
                target = offs[item[2]] | 0x80000000
            else:        # data entry index
                target = data_entries_off + 16 * item[2]
            struct.pack_into("<II", out, eo, name, target)
            eo += 8

    # root
    write_dir(0, [(3, True, 1, 0), (14, True, 2, 0), (24, True, 3, 0)])
    # icon names
    write_dir(1, [(icons[i][0], True, idx_icon_lang + i, 0) for i in range(n)])
    # group names
    write_dir(2, [(101, True, idx_group_lang, 0)])
    # manifest name
    write_dir(3, [(1, True, idx_manifest_lang, 0)])
    # lang dirs -> data entries (data entry indices: 0..n-1 icons, n group, n+1 manifest)
    for i in range(n):
        write_dir(idx_icon_lang + i, [(0x0409, False, i, 0)])
    write_dir(idx_group_lang, [(0x0409, False, n, 0)])
    write_dir(idx_manifest_lang, [(0, False, n + 1, 0)])

    def write_data_entry(di, rva_off, size):
        struct.pack_into("<IIII", out, data_entries_off + 16 * di, va + rva_off, size, 0, 0)

    for i, (_, blob) in enumerate(icons):
        write_data_entry(i, blob_offsets[i], len(blob))
        out[blob_offsets[i]:blob_offsets[i] + len(blob)] = blob
    write_data_entry(n, group_rva_off, len(group_blob))
    out[group_rva_off:group_rva_off + len(group_blob)] = group_blob
    write_data_entry(n + 1, manifest_off, len(manifest))
    out[manifest_off:manifest_off + len(manifest)] = manifest
    return bytes(out)


def main():
    exe_path = sys.argv[1]
    icon_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(exe_path), "..", "icon.ico")
    manifest_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(exe_path), "..", "app.manifest")

    ico = open(icon_path, "rb").read()
    reserved, typ, count = struct.unpack_from("<HHH", ico, 0)
    assert reserved == 0 and typ == 1 and count >= 1, "bad icon"
    icons = []        # (id, blob)
    group_entries = []
    for i in range(count):
        w, h, colors, res, planes, bits, size, offset = struct.unpack_from("<BBBBHHII", ico, 6 + i * 16)
        blob = ico[offset:offset + size]
        icon_id = 201 + i
        icons.append((icon_id, blob))
        group_entries.append(struct.pack("<BBBBHHIH", w, h, colors, res, planes, bits, size, icon_id))
    group_blob = struct.pack("<HHH", 0, 1, count) + b"".join(group_entries)
    manifest = open(manifest_path, "rb").read()

    data = bytearray(open(exe_path, "rb").read())
    assert data[:2] == b"MZ"
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[pe:pe + 4] == b"PE\0\0"
    machine, nsec, _, _, _, optsz, chars = struct.unpack_from("<HHIIIHH", data, pe + 4)
    opt = pe + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    is64 = magic == 0x20B
    dd_off = opt + (112 if is64 else 96)
    rsrc_rva, rsrc_sz = struct.unpack_from("<II", data, dd_off + 2 * 8)
    if rsrc_rva != 0:
        print("already has resources (0x%x) — abort" % rsrc_rva)
        return 1

    last_off = opt + optsz + (nsec - 1) * 40
    l_vsz, l_va, l_rawsz, l_rawptr = struct.unpack_from("<IIII", data, last_off + 8)
    new_va = align(l_va + max(l_vsz, 1), PAGE)

    # header space check: new section header right after last
    new_hdr_off = opt + optsz + nsec * 40
    hdr_end = new_hdr_off + 40
    first_raw = min(struct.unpack_from("<I", data, opt + optsz + i * 40 + 20)[0] for i in range(nsec))
    assert hdr_end <= first_raw, "section header space nahi hai"

    raw_ptr = align(len(data), FILE_ALIGN)
    # build rsrc with provisional va to get size
    rsrc = build_rsrc(new_va, icons, group_blob, manifest)
    vsize = len(rsrc)
    raw_size = align(vsize, FILE_ALIGN)
    rsrc_padded = rsrc + b"\0" * (raw_size - vsize)

    # write new section header
    name = b".rsrc\0\0\0"
    struct.pack_into("<8sIIIIIIHHI", data, new_hdr_off, name, vsize, new_va, raw_size,
                     raw_ptr, 0, 0, 0, 0, 0x40000040)
    # update headers
    struct.pack_into("<H", data, pe + 6, nsec + 1)                     # NumberOfSections
    struct.pack_into("<I", data, opt + 56, align(new_va + vsize, PAGE))  # SizeOfImage
    struct.pack_into("<II", data, dd_off + 2 * 8, new_va, vsize)       # Resource dir entry

    # pad file to raw_ptr and append section
    if len(data) < raw_ptr:
        data += b"\0" * (raw_ptr - len(data))
    data += rsrc_padded

    bak = exe_path + ".bak"
    if not os.path.exists(bak):
        open(bak, "wb").write(open(exe_path, "rb").read())
    open(exe_path, "wb").write(bytes(data))
    print(f"packed: icons={count} manifest={len(manifest)}B section=0x{vsize:x} at VA 0x{new_va:x} -> {exe_path} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
