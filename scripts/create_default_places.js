import { create_basic_place } from "../src/place_storage/store.js";
const DATA_SLOT = 1;
/**
 * Create Eden Crossroads places
 */
function create_eden_crossroads_places() {
    // Main Town Square
    const square_result = create_basic_place(DATA_SLOT, "eden_crossroads", "eden_crossroads_square", "Town Square", { is_default: true, width: 40, height: 40 });
    if (square_result.ok) {
        const square = square_result.place;
        square.description = {
            short: "A bustling town square",
            full: "The heart of Eden. A weathered stone waystone stands at the center, carved with ancient symbols. Paths lead north to the woods, east to the stone circle, west to Grenda's shop, and south to the commons.",
            sensory: {
                sight: ["Waystone", "Wildflowers", "Dusty roads", "Wooden buildings"],
                sound: ["Wind through grass", "Distant hammering", "Birdsong"],
                smell: ["Wildflowers", "Dust", "Wood smoke"],
                touch: ["Warm sun", "Soft breeze", "Rough stone"]
            }
        };
        square.environment = {
            lighting: "bright",
            terrain: "cobblestone",
            cover_available: ["waystone", "planter_boxes"],
            temperature_offset: 0
        };
        square.contents.features = [
            {
                id: "waystone",
                name: "The Waystone",
                description: "A waist-high stone carved with directional symbols",
                tile_positions: [{ x: 20, y: 20 }],
                is_obstacle: true,
                is_cover: true,
                is_interactable: true
            }
        ];
        console.log("Created: Town Square");
    }
    // Tavern - Common Room
    const tavern_common_result = create_basic_place(DATA_SLOT, "eden_crossroads", "eden_crossroads_tavern_common", "The Singing Sword - Common Room", { width: 30, height: 25 });
    if (tavern_common_result.ok) {
        const tavern = tavern_common_result.place;
        tavern.description = {
            short: "A cozy tavern common room",
            full: "The Singing Sword tavern welcomes travelers with the smell of roasting meat and the sound of laughter. Wooden tables are scattered about, and a crackling fireplace warms the room. The bar runs along the north wall.",
            sensory: {
                sight: ["Wooden tables", "Fireplace", "Bar", "Tankards"],
                sound: ["Crackling fire", "Murmured conversations", "Clinking glasses"],
                smell: ["Roasting meat", "Ale", "Wood smoke"],
                touch: ["Warm fire", "Polished wood", "Mug handle"]
            }
        };
        tavern.environment = {
            lighting: "dim",
            terrain: "wooden_floor",
            cover_available: ["tables", "bar", "fireplace"],
            temperature_offset: 2
        };
        tavern.connections = [
            {
                target_place_id: "eden_crossroads_square",
                direction: "south",
                travel_time_seconds: 5,
                description: "A wooden door leads back to the town square"
            }
        ];
        tavern.contents.features = [
            {
                id: "bar",
                name: "Wooden Bar",
                description: "A well-worn wooden bar",
                tile_positions: [{ x: 15, y: 2 }, { x: 16, y: 2 }, { x: 17, y: 2 }],
                is_obstacle: true,
                is_cover: true,
                is_interactable: true
            },
            {
                id: "fireplace",
                name: "Stone Fireplace",
                description: "A crackling fireplace",
                tile_positions: [{ x: 5, y: 5 }],
                is_obstacle: true,
                is_cover: false,
                is_interactable: true
            }
        ];
        console.log("Created: Tavern Common Room");
    }
    console.log("✅ Eden Crossroads places created");
}
/**
 * Create Eden Whispering Woods places
 */
function create_eden_whispering_woods_places() {
    const clearing_result = create_basic_place(DATA_SLOT, "eden_whispering_woods", "eden_whispering_woods_clearing", "Forest Clearing", { is_default: true, width: 35, height: 35 });
    if (clearing_result.ok) {
        const clearing = clearing_result.place;
        clearing.description = {
            short: "A peaceful forest clearing",
            full: "Sunlight filters through the canopy into this peaceful clearing. A small stream bubbles nearby, and wildflowers carpet the ground. The trees seem to whisper secrets if you listen closely.",
            sensory: {
                sight: ["Wildflowers", "Stream", "Towering trees", "Dappled sunlight"],
                sound: ["Bubbling stream", "Wind in leaves", "Birdsong", "Whispers..."],
                smell: ["Pine", "Wildflowers", "Damp earth"],
                touch: ["Soft moss", "Cool breeze", "Rough bark"]
            }
        };
        clearing.environment = {
            lighting: "dim",
            terrain: "dirt",
            cover_available: ["trees", "bushes", "rocks"],
            temperature_offset: -1
        };
        console.log("Created: Forest Clearing");
    }
    console.log("✅ Eden Whispering Woods places created");
}
/**
 * Create Eden Stone Circle places
 */
function create_eden_stone_circle_places() {
    const circle_result = create_basic_place(DATA_SLOT, "eden_stone_circle", "eden_stone_circle_center", "The Stone Circle", { is_default: true, width: 30, height: 30 });
    if (circle_result.ok) {
        const circle = circle_result.place;
        circle.description = {
            short: "An ancient stone circle",
            full: "Seven massive standing stones form a perfect circle atop this windswept hill. The stones are carved with symbols that seem to shift when you're not looking directly at them. The air hums with ancient power.",
            sensory: {
                sight: ["Standing stones", "Strange symbols", "Wide horizon", "Hilltop view"],
                sound: ["Wind", "Low hum", "Creaking grass"],
                smell: ["Ozone", "Old stone", "Wind"],
                touch: ["Rough stone", "Wind", "Tingling sensation"]
            }
        };
        circle.environment = {
            lighting: "bright",
            terrain: "grass",
            cover_available: ["standing_stones"],
            temperature_offset: -2
        };
        circle.contents.features = [
            {
                id: "standing_stones",
                name: "Standing Stones",
                description: "Massive stones carved with shifting symbols",
                tile_positions: [
                    { x: 15, y: 5 }, { x: 22, y: 8 }, { x: 25, y: 15 },
                    { x: 22, y: 22 }, { x: 15, y: 25 }, { x: 8, y: 22 }, { x: 5, y: 15 }
                ],
                is_obstacle: true,
                is_cover: true,
                is_interactable: true
            }
        ];
        console.log("Created: Stone Circle");
    }
    console.log("✅ Eden Stone Circle places created");
}
/**
 * Create Eden Commons places
 */
function create_eden_commons_places() {
    const green_result = create_basic_place(DATA_SLOT, "eden_commons", "eden_commons_green", "The Village Green", { is_default: true, width: 35, height: 35 });
    if (green_result.ok) {
        const green = green_result.place;
        green.description = {
            short: "A peaceful village green",
            full: "This open grassy area serves as Eden's gathering place. A community well stands at the center, and simple homes ring the perimeter. Children play while elders chat on wooden benches.",
            sensory: {
                sight: ["Green grass", "Community well", "Homes", "Children playing"],
                sound: ["Children laughing", "Well rope creaking", "Chickens"],
                smell: ["Grass", "Smoke from chimneys", "Bread baking"],
                touch: ["Soft grass", "Warm sun", "Breeze"]
            }
        };
        green.environment = {
            lighting: "bright",
            terrain: "grass",
            cover_available: ["trees", "well_house"],
            temperature_offset: 0
        };
        console.log("Created: Village Green");
    }
    console.log("✅ Eden Commons places created");
}
/**
 * Create Grenda's Shop place (in Eden Crossroads region)
 */
function create_grendas_shop() {
    const shop_result = create_basic_place(DATA_SLOT, "eden_crossroads", "eden_crossroads_grendas_shop", "Grenda's General Goods", { width: 20, height: 20 });
    if (shop_result.ok) {
        const shop = shop_result.place;
        shop.description = {
            short: "A well-stocked general store",
            full: "Grenda's shop is a treasure trove of supplies. Shelves line the walls, stocked with potions, tools, and provisions. The smell of herbs and leather fills the air. Grenda stands ready behind the counter, her sharp eyes assessing customers.",
            sensory: {
                sight: ["Shelves of goods", "Counter", "Abacus", "Brass scales"],
                sound: ["Bell on door", "Clinking coins", "Grenda's humming"],
                smell: ["Herbs", "Leather", "Parchment"],
                touch: ["Smooth counter", "Textured fabrics", "Cool potion bottles"]
            }
        };
        shop.environment = {
            lighting: "dim",
            terrain: "wooden_floor",
            cover_available: ["shelves", "counter"],
            temperature_offset: 1
        };
        shop.connections = [
            {
                target_place_id: "eden_crossroads_square",
                direction: "east",
                travel_time_seconds: 3,
                description: "A wooden door leads to the town square"
            }
        ];
        shop.contents.features = [
            {
                id: "counter",
                name: "Shop Counter",
                description: "A polished wooden counter",
                tile_positions: [{ x: 10, y: 5 }, { x: 11, y: 5 }],
                is_obstacle: true,
                is_cover: true,
                is_interactable: true
            }
        ];
        console.log("Created: Grenda's Shop");
    }
}
// Run the creation
console.log("🏗️ Creating default places for existing regions...\n");
create_eden_crossroads_places();
create_grendas_shop();
create_eden_whispering_woods_places();
create_eden_stone_circle_places();
create_eden_commons_places();
console.log("\n✅ All default places created successfully!");
console.log("\nNext steps:");
console.log("1. Update region files to reference these places");
console.log("2. Move NPCs to appropriate places");
console.log("3. Test the place system");
//# sourceMappingURL=create_default_places.js.map