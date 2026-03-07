import type { ItemPayload, RenderContext } from "../types.js";

export type ContainerGlyphPair = { closed: string; open: string };

export const DEFAULT_CONTAINER_GLYPHS: ContainerGlyphPair = { closed: 'ŏ', open: 'ᴜ' };

// Registry for specific container glyph replacements.
// Keep this data-driven to avoid long if/else chains.
const CONTAINER_GLYPH_OVERRIDES_BY_DEF_ID: Record<string, Partial<ContainerGlyphPair>> = {
    // Example:
    // small_sack: { closed: 'ŏ', open: 'ᴜ' },
};

export function is_container_tagged(tags: any[] | undefined | null): boolean {
    if (!Array.isArray(tags)) return false;
    return tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
}

export function resolve_container_glyph_pair(payload: ItemPayload): ContainerGlyphPair {
    const def_id = String((payload as any)?.def_id ?? '');
    const ovr = CONTAINER_GLYPH_OVERRIDES_BY_DEF_ID[def_id];

    // Container open/closed glyphs are registry-driven (not item-def-driven).
    const closed = (ovr?.closed ? String(ovr.closed).charAt(0) : undefined)
        ?? DEFAULT_CONTAINER_GLYPHS.closed;
    const open = (ovr?.open ? String(ovr.open).charAt(0) : undefined)
        ?? DEFAULT_CONTAINER_GLYPHS.open;

    return { closed, open };
}

export function resolve_container_glyph(payload: ItemPayload, ctx: RenderContext): string {
    const { closed, open } = resolve_container_glyph_pair(payload);
    return ctx.ui?.selected ? open : closed;
}
