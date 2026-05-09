import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

interface Card {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  hp: string;
  types: string[];
  evolvesTo: string[];
  attacks: Array<{
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
    text: string;
  }>;
  weaknesses: Array<{ type: string; value: string }>;
  resistances: Array<{ type: string; value: string }>;
  retreatCost: string[];
  convertedRetreatCost: number;
  set: {
    id: string;
    name: string;
    series: string;
    printedTotal: number;
    total: number;
    legalities: Record<string, string>;
    releaseDate: string;
    updatedAt: string;
    images: { symbol: string; logo: string };
  };
  number: string;
  artist: string;
  rarity: string;
  flavorText: string;
  nationalPokedexNumbers: number[];
  legalities: Record<string, string>;
  images: { small: string; large: string };
  tcgplayer?: {
    url: string;
    updatedAt: string;
    prices?: Record<string, {
      low?: number;
      mid?: number;
      high?: number;
      market?: number;
      directLow?: number;
    }>;
  };
  cardmarket?: {
    url: string;
    updatedAt: string;
    prices?: {
      averageSellPrice?: number;
      lowPrice?: number;
      trendPrice?: number;
      germanProLow?: number;
      suggestedPrice?: number;
      reverseHoloSell?: number;
      reverseHoloLow?: number;
      reverseHoloTrend?: number;
      lowPriceExPlus?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
      reverseHoloAvg1?: number;
      reverseHoloAvg7?: number;
      reverseHoloAvg30?: number;
    };
  };
}

interface SearchCardsParams {
  name?: string;
  types?: string;
  subtypes?: string;
  legalities?: string;
  hp?: string;
  retreatCost?: string;
  pageSize?: number;
}

// In-memory collection store (persists for the lifetime of the server process)
const userCollection: Map<string, { card: Card; quantity: number; notes?: string }> = new Map();

async function searchCards(params: SearchCardsParams): Promise<Card[]> {
  const queryParts: string[] = [];
  if (params.name) queryParts.push(`name:${params.name}`);
  if (params.types) queryParts.push(`types:${params.types}`);
  if (params.subtypes) queryParts.push(`subtypes:${params.subtypes}`);
  if (params.legalities) queryParts.push(`legalities.${params.legalities}`);
  if (params.hp) queryParts.push(`hp:${params.hp}`);
  if (params.retreatCost) queryParts.push(`convertedRetreatCost:${params.retreatCost}`);

  const query = queryParts.join(' ');
  const pageSize = params.pageSize || 10;

  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=${pageSize}`;
  const response = await fetch(url);
  const data = await response.json() as { data: Card[] };
  return data.data || [];
}

function formatCard(card: Card): string {
  const lines: string[] = [
    `**${card.name}** (${card.id})`,
    `Type: ${card.supertype} | Subtypes: ${(card.subtypes || []).join(', ')}`,
    `HP: ${card.hp || 'N/A'} | Types: ${(card.types || []).join(', ')}`,
    `Set: ${card.set?.name} (${card.set?.series}) | Rarity: ${card.rarity || 'N/A'}`,
  ];
  if (card.attacks && card.attacks.length > 0) {
    lines.push('Attacks:');
    card.attacks.forEach(a => {
      lines.push(`  - ${a.name} [${(a.cost || []).join(',')}] ${a.damage || ''}: ${a.text || ''}`);
    });
  }
  if (card.legalities) {
    const legs = Object.entries(card.legalities).map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`Legalities: ${legs}`);
  }
  lines.push(`Image: ${card.images?.small || 'N/A'}`);
  return lines.join('\n');
}

function formatPrice(card: Card): string {
  const lines: string[] = [`**${card.name}** (${card.id}) — ${card.set?.name}`];

  if (card.tcgplayer?.prices) {
    lines.push('TCGPlayer Prices:');
    for (const [variant, p] of Object.entries(card.tcgplayer.prices)) {
      const parts: string[] = [];
      if (p.low != null) parts.push(`Low: $${p.low.toFixed(2)}`);
      if (p.mid != null) parts.push(`Mid: $${p.mid.toFixed(2)}`);
      if (p.market != null) parts.push(`Market: $${p.market.toFixed(2)}`);
      if (p.high != null) parts.push(`High: $${p.high.toFixed(2)}`);
      if (parts.length) lines.push(`  ${variant}: ${parts.join(' | ')}`);
    }
    lines.push(`  Updated: ${card.tcgplayer.updatedAt}`);
    lines.push(`  Buy: ${card.tcgplayer.url}`);
  } else {
    lines.push('TCGPlayer: No price data available');
  }

  if (card.cardmarket?.prices) {
    const cm = card.cardmarket.prices;
    lines.push('Cardmarket Prices (EUR):');
    if (cm.averageSellPrice != null) lines.push(`  Avg Sell: €${cm.averageSellPrice.toFixed(2)}`);
    if (cm.trendPrice != null) lines.push(`  Trend: €${cm.trendPrice.toFixed(2)}`);
    if (cm.lowPrice != null) lines.push(`  Low: €${cm.lowPrice.toFixed(2)}`);
    if (cm.avg30 != null) lines.push(`  30-day Avg: €${cm.avg30.toFixed(2)}`);
    lines.push(`  Updated: ${card.cardmarket.updatedAt}`);
  }

  return lines.join('\n');
}

const server = new McpServer({
  name: 'ptcg-mcp',
  version: '2.0.0',
});

// ─── ORIGINAL TOOLS ──────────────────────────────────────────────────────────

server.tool(
  'search_cards',
  'Search for Pokemon TCG cards by name, type, subtype, legality, HP, and retreat cost.',
  {
    name: z.string().optional().describe('Card name (supports wildcards like char*)'),
    types: z.string().optional().describe('Energy type (e.g. Water, Fire, Grass)'),
    subtypes: z.string().optional().describe('Card subtype (e.g. Basic, EX, GX, V, VMAX)'),
    legalities: z.string().optional().describe('Format legality e.g. standard:legal, expanded:banned'),
    hp: z.string().optional().describe('HP filter e.g. [100 TO 200] or [* TO 100]'),
    retreatCost: z.string().optional().describe('Converted retreat cost e.g. 0 for free retreat'),
    pageSize: z.number().optional().describe('Number of results to return (default 10, max 250)'),
  },
  async (params) => {
    try {
      const cards = await searchCards(params);
      if (!cards.length) return { content: [{ type: 'text', text: 'No cards found matching your criteria.' }] };
      const formatted = cards.map(formatCard).join('\n\n---\n\n');
      return { content: [{ type: 'text', text: `Found ${cards.length} card(s):\n\n${formatted}` }] };
    } catch (e: unknown) {
      return { content: [{ type: 'text', text: `Error searching cards: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

server.tool(
  'get_card_details',
  'Get full details for a specific card by its ID.',
  { cardId: z.string().describe('The card ID e.g. xy1-1 or base1-4') },
  async ({ cardId }) => {
    try {
      const url = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(cardId)}`;
      const response = await fetch(url);
      const data = await response.json() as { data: Card };
      if (!data.data) return { content: [{ type: 'text', text: `Card ${cardId} not found.` }] };
      return { content: [{ type: 'text', text: formatCard(data.data) }] };
    } catch (e: unknown) {
      return { content: [{ type: 'text', text: `Error fetching card: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// ─── NEW TOOL 1: PRICE TRACKING ──────────────────────────────────────────────

server.tool(
  'get_card_prices',
  'Get current market prices for a Pokemon TCG card from TCGPlayer and Cardmarket. Search by name to find pricing for all matching cards.',
  {
    name: z.string().describe('Card name to search for prices (e.g. Charizard, Pikachu VMAX)'),
    setName: z.string().optional().describe('Narrow results to a specific set name'),
    maxResults: z.number().optional().describe('Max cards to return prices for (default 5)'),
  },
  async ({ name, setName, maxResults = 5 }) => {
    try {
      const queryParts = [`name:${name}`];
      if (setName) queryParts.push(`set.name:"${setName}"`);
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queryParts.join(' '))}&pageSize=${maxResults}&orderBy=-set.releaseDate`;
      const response = await fetch(url);
      const data = await response.json() as { data: Card[] };
      const cards = data.data || [];
      if (!cards.length) return { content: [{ type: 'text', text: `No cards found for "${name}".` }] };
      const formatted = cards.map(formatPrice).join('\n\n---\n\n');
      return { content: [{ type: 'text', text: `Price data for "${name}" (${cards.length} result(s)):\n\n${formatted}` }] };
    } catch (e: unknown) {
      return { content: [{ type: 'text', text: `Error fetching prices: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// ─── NEW TOOL 2: DECK BUILDER ─────────────────────────────────────────────────

server.tool(
  'suggest_deck',
  'Suggest a 60-card Pokemon TCG deck based on a strategy, type, or featured Pokemon. Returns a categorized list of recommended cards with rationale.',
  {
    strategy: z.string().describe('Deck strategy or theme e.g. "aggressive Charizard ex", "stall water", "turbo VMAX"'),
    format: z.enum(['standard', 'expanded', 'unlimited']).optional().describe('Format legality (default: standard)'),
    budget: z.enum(['budget', 'mid', 'competitive']).optional().describe('Budget tier: budget (<$50), mid ($50-150), competitive (any price)'),
  },
  async ({ strategy, format = 'standard', budget = 'competitive' }) => {
    try {
      // Extract type/pokemon hints from strategy
      const typeKeywords: Record<string, string> = {
        fire: 'Fire', water: 'Water', grass: 'Grass', lightning: 'Lightning',
        psychic: 'Psychic', fighting: 'Fighting', darkness: 'Darkness', metal: 'Metal',
        dragon: 'Dragon', colorless: 'Colorless', fairy: 'Fairy',
      };
      const stratLower = strategy.toLowerCase();
      let detectedType = '';
      for (const [kw, type] of Object.entries(typeKeywords)) {
        if (stratLower.includes(kw)) { detectedType = type; break; }
      }

      // Search for Pokemon matching the strategy
      const pokemonQuery = detectedType
        ? `supertype:Pokemon types:${detectedType} legalities.${format}:legal`
        : `supertype:Pokemon legalities.${format}:legal`;

      // Extract a possible featured pokemon name
      const words = strategy.split(' ').filter(w => w.length > 3 && !['with','that','deck','turbo','stall','aggro'].includes(w.toLowerCase()));
      const featuredName = words[0];

      const [featuredRes, typeRes] = await Promise.all([
        featuredName ? fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:${featuredName} supertype:Pokemon legalities.${format}:legal`)}&pageSize=6&orderBy=-set.releaseDate`).then(r => r.json() as Promise<{data:Card[]}>) : Promise.resolve({ data: [] as Card[] }),
        fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(pokemonQuery)}&pageSize=12&orderBy=-set.releaseDate`).then(r => r.json() as Promise<{data:Card[]}>),
      ]);

      const featured = featuredRes.data || [];
      const typeCards = typeRes.data || [];

      // Filter by budget if needed (use market price from tcgplayer)
      const budgetFilter = (card: Card) => {
        if (budget === 'competitive') return true;
        const market = card.tcgplayer?.prices?.holofoil?.market ?? card.tcgplayer?.prices?.normal?.market ?? 0;
        if (budget === 'budget') return market < 5;
        if (budget === 'mid') return market < 20;
        return true;
      };

      const filteredFeatured = featured.filter(budgetFilter).slice(0, 4);
      const filteredType = typeCards.filter(budgetFilter).filter(c => !filteredFeatured.find(f => f.id === c.id)).slice(0, 8);

      const lines: string[] = [
        `## Deck Suggestion: ${strategy}`,
        `Format: ${format} | Budget: ${budget}\n`,
        '### Featured Pokémon (4 copies recommended)',
      ];

      if (filteredFeatured.length) {
        filteredFeatured.forEach(c => {
          const price = c.tcgplayer?.prices?.holofoil?.market ?? c.tcgplayer?.prices?.normal?.market;
          lines.push(`- ${c.name} (${c.set?.name}, ${c.id})${price ? ` — ~$${price.toFixed(2)}` : ''}`);
        });
      } else {
        lines.push('- No featured Pokemon found for this strategy');
      }

      lines.push('\n### Supporting Pokémon (mix of 2-4 copies each)');
      if (filteredType.length) {
        filteredType.forEach(c => {
          const price = c.tcgplayer?.prices?.holofoil?.market ?? c.tcgplayer?.prices?.normal?.market;
          lines.push(`- ${c.name} (${c.set?.name})${price ? ` — ~$${price.toFixed(2)}` : ''}`);
        });
      } else {
        lines.push('- No supporting Pokemon found');
      }

      lines.push('\n### Suggested Trainer/Energy Count (adjust to taste)');
      lines.push('- Trainers: ~24 cards (draw support, search, switching)');
      lines.push('- Energy: ~10-12 cards (matching type above)');
      lines.push('\n### Tips');
      lines.push(`- Run 4x Nest Ball or Ultra Ball to find your featured Pokemon quickly`);
      lines.push(`- Add Professor's Research and Boss's Orders for draw and gust effects`);
      lines.push(`- Use "search_cards" to find specific trainers and energy cards`);
      lines.push(`- Use "get_card_prices" to check costs before buying`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e: unknown) {
      return { content: [{ type: 'text', text: `Error building deck: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// ─── NEW TOOL 3: COLLECTION MANAGER ──────────────────────────────────────────

server.tool(
  'manage_collection',
  'Track your personal Pokemon TCG card collection. Add, remove, view, and value your cards. Collection persists for the duration of the server session.',
  {
    action: z.enum(['add', 'remove', 'view', 'value', 'search']).describe('Action: add a card, remove a card, view all cards, get total collection value, or search collection'),
    cardId: z.string().optional().describe('Card ID required for add/remove actions (e.g. swsh4-25)'),
    quantity: z.number().optional().describe('Number of copies (default 1) for add/remove'),
    notes: z.string().optional().describe('Personal notes about the card (e.g. graded, foil, trade)'),
    query: z.string().optional().describe('Search term for searching within your collection'),
  },
  async ({ action, cardId, quantity = 1, notes, query }) => {
    try {
      if (action === 'add') {
        if (!cardId) return { content: [{ type: 'text', text: 'cardId is required for add action.' }] };
        // Fetch card details
        const res = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(cardId)}`);
        const data = await res.json() as { data: Card };
        if (!data.data) return { content: [{ type: 'text', text: `Card ${cardId} not found.` }] };
        const existing = userCollection.get(cardId);
        if (existing) {
          existing.quantity += quantity;
          if (notes) existing.notes = notes;
        } else {
          userCollection.set(cardId, { card: data.data, quantity, notes });
        }
        const entry = userCollection.get(cardId)!;
        return { content: [{ type: 'text', text: `Added ${quantity}x ${data.data.name} to collection. You now have ${entry.quantity} copy/copies.` }] };
      }

      if (action === 'remove') {
        if (!cardId) return { content: [{ type: 'text', text: 'cardId is required for remove action.' }] };
        const existing = userCollection.get(cardId);
        if (!existing) return { content: [{ type: 'text', text: `Card ${cardId} is not in your collection.` }] };
        existing.quantity -= quantity;
        if (existing.quantity <= 0) {
          userCollection.delete(cardId);
          return { content: [{ type: 'text', text: `Removed ${existing.card.name} from collection entirely.` }] };
        }
        return { content: [{ type: 'text', text: `Removed ${quantity} copy/copies. You now have ${existing.quantity} remaining.` }] };
      }

      if (action === 'view') {
        if (!userCollection.size) return { content: [{ type: 'text', text: 'Your collection is empty. Use "add" to start tracking cards.' }] };
        const lines = [`## Your Collection (${userCollection.size} unique cards)\n`];
        for (const [id, entry] of userCollection) {
          const price = entry.card.tcgplayer?.prices?.holofoil?.market ?? entry.card.tcgplayer?.prices?.normal?.market;
          lines.push(`- ${entry.quantity}x **${entry.card.name}** (${id}) — ${entry.card.set?.name}${price ? ` | ~$${price.toFixed(2)} ea` : ''}${entry.notes ? ` | Note: ${entry.notes}` : ''}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      if (action === 'value') {
        if (!userCollection.size) return { content: [{ type: 'text', text: 'Your collection is empty.' }] };
        let totalValue = 0;
        let priced = 0;
        const lines = [`## Collection Value\n`];
        for (const [id, entry] of userCollection) {
          const price = entry.card.tcgplayer?.prices?.holofoil?.market ?? entry.card.tcgplayer?.prices?.normal?.market;
          const cardTotal = price ? price * entry.quantity : 0;
          if (price) { totalValue += cardTotal; priced++; }
          lines.push(`- ${entry.quantity}x ${entry.card.name} (${id}): ${price ? `$${price.toFixed(2)} x${entry.quantity} = $${cardTotal.toFixed(2)}` : 'No price data'}`);
        }
        lines.push(`\n**Total estimated value: $${totalValue.toFixed(2)}** (based on ${priced}/${userCollection.size} cards with price data)`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      if (action === 'search') {
        if (!query) return { content: [{ type: 'text', text: 'query is required for search action.' }] };
        const q = query.toLowerCase();
        const results = [...userCollection.entries()].filter(([id, entry]) =>
          entry.card.name.toLowerCase().includes(q) ||
          id.toLowerCase().includes(q) ||
          entry.card.set?.name.toLowerCase().includes(q) ||
          (entry.notes?.toLowerCase().includes(q))
        );
        if (!results.length) return { content: [{ type: 'text', text: `No cards in your collection matching "${query}".` }] };
        const lines = [`Found ${results.length} match(es) for "${query}":\n`];
        results.forEach(([id, entry]) => {
          lines.push(`- ${entry.quantity}x ${entry.card.name} (${id}) — ${entry.card.set?.name}${entry.notes ? ` | ${entry.notes}` : ''}`);
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      return { content: [{ type: 'text', text: 'Unknown action.' }] };
    } catch (e: unknown) {
      return { content: [{ type: 'text', text: `Error managing collection: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

// ─── START SERVER ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
