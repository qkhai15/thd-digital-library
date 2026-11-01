export function detectedFileMime(bytes: Buffer) {
  const text = (start: number, end: number) => bytes.toString("ascii", start, end);
  if (bytes.length < 12) return null;
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (text(0,4) === "RIFF" && text(8,12) === "WEBP") return "image/webp";
  if (text(0,4) === "RIFF" && text(8,12) === "WAVE") return "audio/wav";
  if (text(0,5) === "%PDF-") return "application/pdf";
  if (text(0,4) === "OggS") return "audio/ogg";
  if (text(0,3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)) return "audio/mpeg";
  if (text(4,8) === "ftyp") return /^M4[AB ]/.test(text(8,12)) ? "audio/mp4" : "video/mp4";
  if (bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return "video/webm";
  return null;
}
