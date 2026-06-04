import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

// Import our custom data store (static local database dataset)
import { HUB_LOCATIONS, HOTELS_DATA, DINING_DATA, TRANSIT_DATA } from './src/data.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- Local Core Query Builder: In-Memory ODM Helper ---
class LocalCollection {
  constructor(data) {
    this.data = data;
  }

  // Local data find query
  find(query = {}) {
    let results = [...this.data];
    Object.keys(query).forEach(key => {
      const queryVal = query[key];
      if (queryVal !== undefined && queryVal !== '') {
        results = results.filter(item => {
          if (typeof item[key] === 'string') {
            return item[key].toLowerCase() === queryVal.toLowerCase();
          }
          return item[key] === queryVal;
        });
      }
    });

    const chain = {
      results,
      sort(criteria) {
        // criteria like { rating: -1, reviews: -1 } or similar
        Object.keys(criteria).forEach(sortKey => {
          const dir = criteria[sortKey];
          this.results.sort((a, b) => {
            if (a[sortKey] > b[sortKey]) return dir === -1 ? -1 : 1;
            if (a[sortKey] < b[sortKey]) return dir === -1 ? 1 : -1;
            return 0;
          });
        });
        return this;
      },
      limit(n) {
        this.results = this.results.slice(0, n);
        return this;
      },
      exec() {
        return this.results;
      }
    };

    return chain;
  }
}

// Instantiate Collections
const HotelsCollection = new LocalCollection(HOTELS_DATA);
const DiningCollection = new LocalCollection(DINING_DATA);
const TransitCollection = new LocalCollection(TRANSIT_DATA);

// --- REST API Endpoints ---

// Get active locations
app.get('/api/locations', (req, res) => {
  res.json({
    status: 'success',
    data: HUB_LOCATIONS
  });
});

// Comprehensive Mongo-style Smart Query Planner route
app.post('/api/generate-plan', (req, res) => {
  try {
    const {
      hub,
      budget = 5000,
      duration = 2,
      transportType,
      foodPreference,
      hotelTier
    } = req.body;

    const parsedBudget = Number(budget) || 5000;
    const parsedDuration = Number(duration) || 2;

    // 1. Query stays near the hub sorted by rating & reviews
    const stays = HotelsCollection.find({ hub })
      .sort({ rating: -1, reviews: -1 })
      .exec();

    // 2. Query dining spots near the hub sorted by high ratings
    const dining = DiningCollection.find({ hub })
      .sort({ rating: -1, reviews: -1 })
      .exec();

    // 3. Query transit options near the hub sorted by ratings
    const transit = TransitCollection.find({ hub })
      .sort({ rating: -1, reviews: -1 })
      .exec();

    // Calculate dynamic cost estimates for the options
    const processedStays = stays.map(item => {
      const totalCost = item.price * parsedDuration;
      return {
        ...item,
        totalCost,
        days: parsedDuration,
        fitsInBudget: totalCost < parsedBudget
      };
    });

    const processedDining = dining.map(item => {
      const totalCost = item.price * parsedDuration;
      return {
        ...item,
        totalCost,
        days: parsedDuration,
        fitsInBudget: totalCost < parsedBudget
      };
    });

    const processedTransit = transit.map(item => {
      const totalCost = item.price * parsedDuration;
      return {
        ...item,
        totalCost,
        days: parsedDuration,
        fitsInBudget: totalCost < parsedBudget
      };
    });

    // Generate a smart Cozy Budget Itinerary automatically
    // This finds the highest-rated combination that fits the budget.
    // If none fits, it defaults to the cheapest setup.
    let recommendedStay = processedStays.find(s => s.tier === hotelTier && s.fitsInBudget);
    if (!recommendedStay) {
      recommendedStay = processedStays.find(s => s.fitsInBudget) || processedStays[processedStays.length - 1];
    }

    let recommendedDining = processedDining.find(d => d.preference === foodPreference && d.fitsInBudget);
    if (!recommendedDining) {
      recommendedDining = processedDining.find(d => d.fitsInBudget) || processedDining[processedDining.length - 1];
    }

    let recommendedTransit = processedTransit.find(t => t.type === transportType && t.fitsInBudget);
    if (!recommendedTransit) {
      recommendedTransit = processedTransit.find(t => t.fitsInBudget) || processedTransit[processedTransit.length - 1];
    }

    // Double check we are within budget
    const hasRecommendation = recommendedStay && recommendedDining && recommendedTransit;
    const recommendedTotal = hasRecommendation
      ? (recommendedStay.totalCost + recommendedDining.totalCost + recommendedTransit.totalCost)
      : 0;

    res.json({
      status: 'success',
      query: { hub, budget: parsedBudget, duration: parsedDuration, transportType, foodPreference, hotelTier },
      data: {
        stays: processedStays,
        dining: processedDining,
        transit: processedTransit,
        recommended: hasRecommendation ? {
          stay: recommendedStay,
          dining: recommendedDining,
          transit: recommendedTransit,
          totalCost: recommendedTotal,
          remaining: parsedBudget - recommendedTotal,
          isUnderBudget: recommendedTotal <= parsedBudget
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// --- Vite Middleware integration ---
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(vite.middlewares);
} else {
  // Production serving
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[GeoBuddy backend ready] running on http://localhost:${PORT}`);
});
