// Script to convert item weights from grams to pounds
import fs from 'fs';
import path from 'path';

const itemsDir = 'local_data/data_slot_1/items';
const files = fs.readdirSync(itemsDir).filter(f => f.endsWith('.jsonc'));

console.log('Current item weights (in grams):');
console.log('================================');

files.forEach(f => {
    const filePath = path.join(itemsDir, f);
    const content = fs.readFileSync(filePath, 'utf8');
    // Remove comments
    const cleanContent = content.replace(/\/\/.*$/gm, '');
    
    try {
        const data = JSON.parse(cleanContent);
        if (data.weight !== undefined) {
            const grams = data.weight;
            // Convert grams to pounds (1 lb = 453.592g, round to reasonable values)
            const pounds = Math.max(0.1, Math.round(grams / 454 * 10) / 10);
            console.log(`${f}: ${grams}g → ${pounds} lbs - ${data.name}`);
        }
    } catch (e) {
        console.log(`${f}: ERROR parsing - ${e.message}`);
    }
});

console.log('\nTo convert, run with --convert flag');
