/**
 * The position of a save at rest: its data gzipped (`CompressionStream`), about a fourteenth of
 * the text. The store packs it on a write and unpacks it on a read, so the apps and the engine
 * see the text only.
 */
import type { PackedPosition, SavedPosition } from "./types.ts";

/** Whether this runtime can gzip: without it a save is stored without its position. */
export const canPack = () =>
  typeof CompressionStream === "function" && typeof DecompressionStream === "function";

const through = (bytes: Blob, stream: CompressionStream | DecompressionStream) =>
  new Response(bytes.stream().pipeThrough(stream));

export async function pack(position: SavedPosition): Promise<PackedPosition> {
  const { data, ...head } = position;
  const gzipped = through(new Blob([data]), new CompressionStream("gzip"));
  return { ...head, gzip: new Uint8Array(await gzipped.arrayBuffer()) };
}

/** The position again; null when its bytes do not read (the save plays without it). */
export async function unpack(packed: PackedPosition): Promise<SavedPosition | null> {
  if (!canPack()) {
    return null;
  }
  try {
    const { gzip, ...head } = packed;
    const text = through(
      new Blob([gzip as Uint8Array<ArrayBuffer>]),
      new DecompressionStream("gzip"),
    );
    return { ...head, data: await text.text() };
  } catch {
    return null;
  }
}
