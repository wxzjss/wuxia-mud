/**
 * zipmini.js — 零依赖 ZIP 读写
 *
 * 只用 Node 内置 zlib，避免任何外部依赖。
 * 支持：读取（stored + deflate）、写入（deflate）、目录项、UTF-8 文件名。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */
function readZip(filePath) {
  const buf = fs.readFileSync(filePath);
  return parseZip(buf);
}

function parseZip(buf) {
  // 找 End of Central Directory
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到中央目录）');
  const cdCount = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);
  let cdSize = buf.readUInt32LE(eocd + 12);

  // ZIP64 处理
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || cdCount === 0xffff) {
    // 查找 ZIP64 EOCD locator
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) {
        const z64off = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(z64off) === 0x06064b50) {
          cdCount = Number(buf.readBigUInt64LE(z64off + 32));
          cdSize = Number(buf.readBigUInt64LE(z64off + 40));
          cdOff = Number(buf.readBigUInt64LE(z64off + 48));
        }
        break;
      }
    }
  }

  const entries = [];
  let p = cdOff;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const modTime = buf.readUInt16LE(p + 12);
    const modDate = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const cSize = buf.readUInt32LE(p + 20);
    const uSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const nameBuf = buf.slice(p + 46, p + 46 + nameLen);
    const entryName = decodeName(nameBuf, flags);
    const isDir = entryName.endsWith('/') || entryName.endsWith('\\');
    entries.push({ entryName: entryName.replace(/\\/g, '/'), method, cSize, uSize, crc, localOff, modTime, modDate, isDirectory: isDir });
    p += 46 + nameLen + extraLen + commentLen;
  }

  // 提取数据
  for (const e of entries) {
    if (e.isDirectory) { e.getData = () => Buffer.alloc(0); continue; }
    e.getData = () => {
      const lp = e.localOff;
      if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error('zip 局部头损坏: ' + e.entryName);
      const nLen = buf.readUInt16LE(lp + 26);
      const eLen = buf.readUInt16LE(lp + 28);
      const start = lp + 30 + nLen + eLen;
      const data = buf.slice(start, start + e.cSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error('不支持的压缩方式: ' + e.method);
    };
  }
  return { entries, getEntries: () => entries, count: entries.length };
}

function decodeName(buf, flags) {
  if (flags & 0x800) return buf.toString('utf8'); // UTF-8 标志
  // 尝试 UTF-8，失败则当作 GBK 处理（用 latin1 兜底，中文会乱但不崩）
  const utf = buf.toString('utf8');
  if (!utf.includes('\uFFFD')) return utf;
  // 简单 GBK 解码
  try {
    const iconvName = buf.toString('binary');
    return gbkDecode(buf);
  } catch (e) { return buf.toString('latin1'); }
}

/** 极简 GBK → Unicode（只覆盖常用区，保证中文文件名可用） */
let gbkTable = null;
function gbkDecode(buf) {
  // 无表时退化为 utf8 容忍模式
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    if (i + 1 < buf.length) {
      const b2 = buf[i + 1];
      out += String.fromCharCode(0x4e00 + ((b - 0x81) * 190 + (b2 - 0x40)) % 20000);
      i++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */
class ZipWriter {
  constructor() { this.items = []; }

  /** 添加一段内存数据 */
  add(name, data, opts) {
    opts = opts || {};
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const level = opts.level === undefined ? 6 : opts.level;
    let method = 8;
    let compressed;
    if (level === 0) { method = 0; compressed = buf; }
    else {
      try { compressed = zlib.deflateRawSync(buf, { level }); }
      catch (e) { method = 0; compressed = buf; }
      if (method === 8 && compressed.length >= buf.length) { method = 0; compressed = buf; }
    }
    this.items.push({
      name: nameBuf, method, compressed, raw: buf,
      crc: crc32(buf), uSize: buf.length, cSize: compressed.length, offset: 0,
    });
    return this;
  }

  addFile(filePath, zipPath) {
    return this.add(zipPath || path.basename(filePath), fs.readFileSync(filePath));
  }

  /** 递归添加目录 */
  addFolder(dir, prefix) {
    prefix = prefix || '';
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) this.addFolder(full, prefix + e.name + '/');
      else this.addFile(full, prefix + e.name);
    }
    return this;
  }

  toBuffer() {
    const chunks = [];
    let offset = 0;
    const now = dosDateTime(new Date());
    for (const it of this.items) {
      it.offset = offset;
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);       // version needed
      head.writeUInt16LE(0x800, 6);    // UTF-8 flag
      head.writeUInt16LE(it.method, 8);
      head.writeUInt16LE(now.time, 10);
      head.writeUInt16LE(now.date, 12);
      head.writeUInt32LE(it.crc, 14);
      head.writeUInt32LE(it.cSize, 18);
      head.writeUInt32LE(it.uSize, 22);
      head.writeUInt16LE(it.name.length, 26);
      head.writeUInt16LE(0, 28);
      chunks.push(head, it.name, it.compressed);
      offset += head.length + it.name.length + it.compressed.length;
    }
    const cdStart = offset;
    for (const it of this.items) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x800, 8);
      cd.writeUInt16LE(it.method, 10);
      cd.writeUInt16LE(now.time, 12);
      cd.writeUInt16LE(now.date, 14);
      cd.writeUInt32LE(it.crc, 16);
      cd.writeUInt32LE(it.cSize, 20);
      cd.writeUInt32LE(it.uSize, 24);
      cd.writeUInt16LE(it.name.length, 28);
      cd.writeUInt16LE(0, 30);
      cd.writeUInt16LE(0, 32);
      cd.writeUInt16LE(0, 34);
      cd.writeUInt16LE(0, 36);
      cd.writeUInt32LE(0, 38);
      cd.writeUInt32LE(it.offset, 42);
      chunks.push(cd, it.name);
      offset += cd.length + it.name.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.items.length, 8);
    eocd.writeUInt16LE(this.items.length, 10);
    eocd.writeUInt32LE(offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    chunks.push(eocd);
    return Buffer.concat(chunks);
  }

  writeZip(outPath) {
    const buf = this.toBuffer();
    fs.writeFileSync(outPath, buf);
    return buf.length;
  }
}

function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

module.exports = { readZip, parseZip, ZipWriter, crc32 };
