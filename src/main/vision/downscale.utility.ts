/**
 * The pure image-downscale math for the vision capture path (AI-03/D-05).
 *
 * Mirrors the `.utility.ts` discipline (`rms.utility.ts`): {@link fitLongEdge} is a pure,
 * side-effect-free, idempotent function — no class, no state. {@link toBase64Png} is the thin
 * `nativeImage` I/O edge that applies that math and encodes the result as RAW base64 with NO
 * `data:` URL prefix (Pitfall 2), which is what the Anthropic vision image block requires.
 */

/**
 * The app downscale target: the long edge of the captured screenshot is shrunk to at most this many
 * pixels before the image is sent (D-05, success criterion 2). This is a deliberate cost/latency
 * floor we CHOOSE — `claude-opus-4-8` itself allows up to 2576px (Pitfall 5). Do NOT raise this to
 * 2576: 1568 stays well under the model limit while minimizing visual tokens, latency, and cost.
 */
export const VISION_MAX_LONG_EDGE = 1568;

/**
 * Computes the resized dimensions for an image so its longest edge fits within `maxEdge`, preserving
 * aspect ratio. Shrinks ONLY if the longest edge exceeds `maxEdge` (never upscales); an image already
 * at or below the limit is returned unchanged. Pure and side-effect free.
 *
 * @param width - The source image width in pixels.
 * @param height - The source image height in pixels.
 * @param maxEdge - The maximum allowed length of the longest edge.
 * @returns The fitted `{ width, height }` (unchanged when already within `maxEdge`).
 */
export function fitLongEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (longest <= maxEdge) {
        return { width, height };
    }

    const scale = maxEdge / longest;

    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Downscales a captured `nativeImage` to {@link VISION_MAX_LONG_EDGE} on its long edge (only-if-larger)
 * and encodes it as RAW base64 PNG plus its media type.
 *
 * The base64 is produced via `.toPNG().toString('base64')` — NEVER `.toDataURL()`, which would prefix
 * the payload with `data:image/png;base64,` and be rejected by the Anthropic vision API (Pitfall 2).
 * Resize is only invoked when the image actually exceeds the target, so a sub-target capture is encoded
 * as-is.
 *
 * @param image - The captured display image (a full-resolution `Electron.NativeImage`).
 * @returns The prefix-free base64 PNG payload and its `image/png` media type.
 */
export function toBase64Png(image: Electron.NativeImage): { base64: string; mediaType: string } {
    const { width, height } = image.getSize();
    const target = fitLongEdge(width, height, VISION_MAX_LONG_EDGE);
    const resized = target.width === width && target.height === height ? image : image.resize({ width: target.width, height: target.height });

    return { base64: resized.toPNG().toString('base64'), mediaType: 'image/png' };
}
