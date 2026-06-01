import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, '../public/assets/dragon-mastery');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const thumbnails = [
  {
    name: 'dragon-new.png',
    input: path.join(process.env.HOME, 'Downloads/dragon_lv1.png'),
    width: 120,
    height: 120,
  },
  {
    name: 'dragon-learning.png',
    input: path.join(process.env.HOME, 'Downloads/dragon_lv1.png'),
    width: 130,
    height: 130,
  },
  {
    name: 'dragon-practicing.png',
    input: path.join(process.env.HOME, 'Downloads/dragon_lv2.jpeg'),
    width: 140,
    height: 140,
  },
  {
    name: 'dragon-strong.png',
    input: path.join(process.env.HOME, 'Downloads/dragon_lv3.png'),
    width: 160,
    height: 160,
  },
  {
    name: 'dragon-mastered.png',
    input: path.join(process.env.HOME, 'Downloads/dragon_lv5.png'),
    width: 180,
    height: 180,
  },
];

(async () => {
  for (const thumb of thumbnails) {
    try {
      console.log(`Processing ${thumb.name}...`);
      await sharp(thumb.input)
        .resize(thumb.width, thumb.height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toFile(path.join(outputDir, thumb.name));
      console.log(`✓ Created ${thumb.name}`);
    } catch (err) {
      console.error(`✗ Failed to create ${thumb.name}:`, err.message);
    }
  }
  console.log('\nDone! Thumbnails created in', outputDir);
})();
