import { resolve_cell } from "../../src/render_shaders/resolver.js";
import type { DiscriminatedRenderPayload, RenderContext } from "../../src/render_shaders/types.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assert_eq(actual: any, expected: any, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function make_ctx(where: RenderContext["where"], ui?: RenderContext["ui"]): RenderContext {
  return {
    where,
    space: "ui",
    x: 10,
    y: 10,
    time_ms: 1_000_000,
    ui,
  };
}

function item_payload(opts: {
  id: string;
  def_id: string;
  name: string;
  display_char?: string;
  qty?: number;
  tags?: any[];
}): DiscriminatedRenderPayload {
  return {
    kind: "item",
    id: opts.id,
    def_id: opts.def_id,
    name: opts.name,
    display_char: opts.display_char,
    qty: opts.qty,
    tags: opts.tags ?? [],
  } as any;
}

function pile_payload(opts: {
  id: string;
  pile_count: number;
  rep: { def_id: string; name: string; display_char?: string; tags?: any[] };
}): DiscriminatedRenderPayload {
  return {
    kind: "pile",
    id: opts.id,
    pile_count: opts.pile_count,
    def_id: opts.rep.def_id,
    name: opts.rep.name,
    display_char: opts.rep.display_char,
    tags: opts.rep.tags ?? [],
  } as any;
}

function tag(name: string, mag: number = 1): any {
  return { name, mag, meta: [], info: [] };
}

async function main(): Promise<void> {
  // 1) Container open/closed glyphs (registry-driven) only when tagged CONTAINER.
  {
    const p = item_payload({
      id: "i1",
      def_id: "small_sack",
      name: "Small Sack",
      display_char: "s",
      tags: [tag("CONTAINER")],
    });

    const closed = resolve_cell(p, make_ctx("container_ui", { selected: false }));
    const open = resolve_cell(p, make_ctx("container_ui", { selected: true }));
    assert_eq(closed.char, "ŏ", "container closed glyph");
    assert_eq(open.char, "ᴜ", "container open glyph");
  }

  // 2) Hover/open colors come from UI modifiers (not module base_fg).
  {
    const p = item_payload({ id: "i2", def_id: "rock", name: "Rock", display_char: "r", tags: [] });
    const hovered = resolve_cell(p, make_ctx("container_ui", { hovered: true }));
    assert_eq(hovered.rgb.r, 255, "hover rgb.r");
    assert_eq(hovered.rgb.g, 255, "hover rgb.g");
    assert_eq(hovered.rgb.b, 100, "hover rgb.b");
  }

  // 3) FIRE! overrides fg and resists hover/open recolor.
  {
    const p = item_payload({
      id: "i3",
      def_id: "torch",
      name: "Torch",
      display_char: "t",
      tags: [tag("FIRE!", 1)],
    });
    const hovered = resolve_cell(p, make_ctx("container_ui", { hovered: true }));
    // mag=1 => pumpkin (255, 147, 41) in palette; we just assert it's not the hover yellow.
    assert(!(hovered.rgb.r === 255 && hovered.rgb.g === 255 && hovered.rgb.b === 100), "FIRE! should not be recolored by hover");
  }

  // 4) Pile glyph: multi-item piles render '*'/'#' but keep representative styling.
  {
    const p = pile_payload({
      id: "pile:1",
      pile_count: 3,
      rep: { def_id: "torch", name: "Torch", display_char: "t", tags: [tag("FIRE!", 1)] },
    });
    const cell = resolve_cell(p, make_ctx("place_tile", { hovered: false }));
    assert_eq(cell.char, "*", "pile glyph for count=3");
  }

  // 5) Default container highlight uses ui.default_container (no pulsing required).
  {
    const p = item_payload({
      id: "i4",
      def_id: "small_sack",
      name: "Small Sack",
      display_char: "s",
      tags: [tag("CONTAINER")],
    });
    const cell = resolve_cell(p, make_ctx("container_ui", { default_container: true }));
    assert_eq(cell.rgb.r, 255, "default container rgb.r");
    assert_eq(cell.rgb.g, 255, "default container rgb.g");
    assert_eq(cell.rgb.b, 100, "default container rgb.b");
  }

  // 6) Tool mismatch (non-tool in tool slot) forces medium_gray and caps weight.
  {
    const p = item_payload({ id: "i5", def_id: "rock", name: "Rock", display_char: "r", tags: [] });
    const cell = resolve_cell(p, make_ctx("character_slot", { tool_mismatch: true, hovered: false, selected: false }));
    // medium_gray in palette is expected to be neutral-ish and not hover yellow.
    assert(!(cell.rgb.r === 255 && cell.rgb.g === 255 && cell.rgb.b === 100), "tool_mismatch should not become hover yellow");
    assert(typeof cell.weight_index === "number" && cell.weight_index <= 3, "tool_mismatch caps weight");
  }

  // If we got here, we're good.
  console.log("shader_golden eval passed");
}

main().catch((err) => {
  console.error("shader_golden eval failed:", err);
  process.exit(1);
});
