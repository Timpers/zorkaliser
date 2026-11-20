export interface StylePreset {
  id: string;
  name: string;
  tagline: string;
  accentColor: string;
  gradient: [string, string];
  styleDirective: string;
  negativePrompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'fantasy-oil',
    name: '80s Fantasy Oil',
    tagline: 'Vintage Infocom box-art oil painting with rich chiaroscuro',
    accentColor: '#d97706',
    gradient: ['#451a03', '#b45309'],
    styleDirective:
      'Classic 1980s fantasy paperback oil painting, rich chiaroscuro lighting, textured painterly brushwork, warm torchlight and deep emerald shadows, atmospheric matte painting aesthetic',
    negativePrompt:
      'text, watermark, signature, frame, UI overlay, speech bubbles, modern HUD, foreground hands, arms, first-person hands, blurry, low quality',
  },
  {
    id: 'photoreal',
    name: 'Photoreal Cinema',
    tagline: '35mm anamorphic film still with natural volumetric lighting',
    accentColor: '#38bdf8',
    gradient: ['#0c4a6e', '#1e293b'],
    styleDirective:
      'Cinematic 35mm anamorphic film still, photorealistic textures, natural volumetric lighting, shallow depth of field, atmospheric haze, grounded realistic materials and color grading',
    negativePrompt:
      'text, watermark, cartoon, anime, CGI plastic look, UI overlay, lens captions, borders, foreground hands, arms, first-person hands',
  },
  {
    id: 'cartoon',
    name: 'Graphic Novel',
    tagline: 'Clean ink linework and vibrant cel-shaded animation art',
    accentColor: '#f43f5e',
    gradient: ['#4c0519', '#be123c'],
    styleDirective:
      'High-craft animated graphic novel illustration, crisp expressive ink linework, vibrant cel-shaded lighting, stylized architectural proportions, Studio Ghibli meets European bande dessinee color palette',
    negativePrompt:
      'text, speech bubbles, comic panels, watermark, photorealistic, muddy colors, UI overlay, foreground hands, arms, first-person hands',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Noir',
    tagline: 'Rain-slicked neon reflections and high-contrast synth-noir',
    accentColor: '#e879f9',
    gradient: ['#2e1065', '#86198f'],
    styleDirective:
      'Cyberpunk noir re-imagining of the environment, rain-slicked surfaces, moody cyan and magenta neon reflections, brutalist sci-fi retrofitting, misty atmospheric shadows, high-contrast synth-noir lighting',
    negativePrompt:
      'text, readable neon letters, watermark, UI overlay, daytime flat lighting, cartoon, foreground hands, arms, first-person hands',
  },
  {
    id: 'pixel-art',
    name: '16-Bit Pixel Art',
    tagline: 'Classic LucasArts & Sierra adventure game pixel art',
    accentColor: '#34d399',
    gradient: ['#064e3b', '#047857'],
    styleDirective:
      'Authentic 1990s 16-bit VGA adventure game pixel art background, crisp pixel clusters, masterfully dithered gradients, rich EGA/VGA palette, evocative LucasArts and Sierra scenic composition',
    negativePrompt:
      'text, UI menu bar, inventory icons, cursor, blur, anti-aliased photo, watermark, foreground hands, arms, first-person hands',
  },
  {
    id: 'watercolor',
    name: 'Storybook Watercolor',
    tagline: 'Hand-painted ink-and-wash on cold-pressed paper',
    accentColor: '#fbbf24',
    gradient: ['#422006', '#a16207'],
    styleDirective:
      'Delicate storybook watercolor and fine sepia ink wash on textured cold-pressed paper, soft luminous atmospheric washes, painterly pigment blooms, cozy yet mysterious illustrated book aesthetic',
    negativePrompt:
      'text, book page borders, watermark, harsh neon, 3D render, photographic, UI overlay, foreground hands, arms, first-person hands',
  },
  {
    id: 'gothic-ink',
    name: 'Gothic Engraving',
    tagline: 'Moody woodcut and pen-and-ink shadows in sepia & charcoal',
    accentColor: '#a8a29e',
    gradient: ['#1c1917', '#44403c'],
    styleDirective:
      'Intricate 19th-century gothic woodcut engraving and crosshatched pen-and-ink illustration, dramatic stark chiaroscuro lighting, weathered parchment sepia and deep charcoal tones, Gustave Dore inspired atmosphere',
    negativePrompt:
      'text, watermark, bright rainbow colors, modern objects, UI overlay, flat digital vector, foreground hands, arms, first-person hands',
  },
];

export const CUSTOM_STYLE_ID = 'custom';

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.id === id);
}
