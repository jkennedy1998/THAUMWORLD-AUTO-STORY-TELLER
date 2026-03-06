/**
 * Equipment System Module
 * 
 * Provides tag-based equipment validation and management.
 * Equipment system based on ARMOR/GARB/TOOL tags.
 */

export {
    check_tag_compatibility,
    get_primary_slot_type,
    get_compatible_slot_types,
    check_legacy_compatibility,
    has_equipment_tags,
    get_equipment_tags,
    type TagCompatibilityResult
} from "./tag_validation.js";
