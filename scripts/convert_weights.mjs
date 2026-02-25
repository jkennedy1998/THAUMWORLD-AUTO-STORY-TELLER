// Script to convert item weights from grams to pounds
import fs from 'fs';
import path from 'path';

const itemsDir = 'local_data/data_slot_1/items';
const files = fs.readdirSync(itemsDir).filter(f => f.endsWith('.jsonc'));

console.log('Converting weights from grams to pounds...');
console.log('==========================================');

files.forEach(f => {
    const filePath = path.join(itemsDir, f);
    const content = fs.readFileSync(filePath, 'utf8');
    
    try {
        // Parse JSON (handling comments)
        const cleanContent = content.replace(/\/\/.*$/gm, '');
        const data = JSON.parse(cleanContent);
        
        if (data.weight !== undefined) {
            const oldWeight = data.weight;
            // Convert grams to pounds (1 lb ≈ 454g)
            // Round to 1 decimal place, minimum 0.1 lbs
            let newWeight = Math.max(0.1, Math.round(oldWeight / 454 * 10) / 10);
            
            // Special cases for better gameplay balance
            if (f === 'iron_dagger.jsonc') newWeight = 1.0; // Dagger should be heavier
            if (f === 'sword.jsonc') newWeight = 2.5; // Sword
            if (f === 'torch.jsonc') newWeight = 0.5; // Torch
            if (f === 'small_sack.jsonc') newWeight = 0.5; // Sack when empty
            
            data.weight = newWeight;
            
            // Write back (preserve any comments at the top)
            const output = JSON.stringify(data, null, 2);
            fs.writeFileSync(filePath, output);
            
            console.log(`${f}: ${oldWeight}g → ${newWeight} lbs - ${data.name}`);
        }
    } catch (e) {
        console.log(`${f}: ERROR - ${e.message}`);
    }
});

console.log('\nConversion complete!');
