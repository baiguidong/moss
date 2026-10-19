// SQLite WAL may need a writable -shm even for mode=ro. Validate the committed
// database entirely in memory when WAL exists; never create/copy/modify HOME
// files. The usual checkpointed path uses SQLite's immutable read-only URI.
export const SQLITE_READONLY_CHECK = String.raw`
import os, sys, sqlite3, struct, json, hashlib
from urllib.parse import quote
file = sys.argv[1]
wal_file = file + '-wal'
wal_size = os.path.getsize(wal_file) if os.path.exists(wal_file) else 0
if wal_size <= 32:
    db = sqlite3.connect('file:' + quote(file, safe='/') + '?mode=ro&immutable=1', uri=True)
else:
    limit = 128 * 1024 * 1024
    if os.path.getsize(file) > limit or wal_size > limit:
        raise RuntimeError('数据库日志较大，请先完成数据库检查点，再创建快照')
    data = bytearray(open(file, 'rb').read())
    wal = open(wal_file, 'rb').read()
    magic, version, page_size = struct.unpack('>III', wal[:12])
    if magic not in (0x377f0682, 0x377f0683) or version != 3007000 or page_size < 512 or page_size > 65536 or page_size & (page_size - 1):
        raise RuntimeError('Invalid SQLite WAL header')
    endian = '<' if magic == 0x377f0682 else '>'
    def checksum(block, s0=0, s1=0):
        words = struct.unpack(endian + str(len(block) // 4) + 'I', block)
        for i in range(0, len(words), 2):
            s0 = (s0 + words[i] + s1) & 0xffffffff
            s1 = (s1 + words[i + 1] + s0) & 0xffffffff
        return s0, s1
    state = checksum(wal[:24])
    if state != struct.unpack('>II', wal[24:32]): raise RuntimeError('SQLite WAL header checksum mismatch')
    frames = []; committed = 0; pages = 0
    offset = 32
    while offset + 24 + page_size <= len(wal):
        header = wal[offset:offset + 24]
        if header[8:16] != wal[16:24]: break
        page, size = struct.unpack('>II', header[:8])
        if not page or page * page_size > limit or size * page_size > limit: raise RuntimeError('SQLite WAL page is out of bounds')
        payload = wal[offset + 24:offset + 24 + page_size]
        state = checksum(payload, *checksum(header[:8], *state))
        if state != struct.unpack('>II', header[16:24]): raise RuntimeError('SQLite WAL frame checksum mismatch')
        frames.append((page, offset + 24))
        if size: committed = len(frames); pages = size
        offset += 24 + page_size
    if committed:
        length = pages * page_size
        if len(data) < length: data.extend(bytes(length - len(data)))
        for page, offset in frames[:committed]:
            if page <= pages: data[(page - 1) * page_size:page * page_size] = wal[offset:offset + page_size]
        del data[length:]
    if data[:16] != b'SQLite format 3\x00': raise RuntimeError('Invalid SQLite database header')
    # All committed WAL pages are now applied; an in-memory database has no WAL.
    data[18] = data[19] = 1
    db = sqlite3.connect(':memory:')
    db.deserialize(bytes(data))
try:
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]: raise RuntimeError('SQLite integrity check failed')
    schema = [db.execute('PRAGMA user_version').fetchone(), db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()]
    print(json.dumps({'dataSchema': hashlib.sha256(json.dumps(schema, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()}))
finally:
    db.close()
`;
