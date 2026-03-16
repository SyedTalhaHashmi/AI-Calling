/**
 * API-Sports — live scores across all subscribed sports.
 * One API key works for: Football, NBA, Basketball, NFL, Baseball, Hockey, Rugby, Volleyball, AFL, etc.
 * Free: 100 requests/day per API.
 */
const axios = require("axios");

const SPORTS = {
  football: {
    base: "https://v3.football.api-sports.io",
    path: "/fixtures",
    label: "Football",
    format(f) {
      const home = f.teams?.home?.name || "Home";
      const away = f.teams?.away?.name || "Away";
      const g = f.goals;
      const score = g ? `${g.home ?? 0} - ${g.away ?? 0}` : "0 - 0";
      return `${home} ${score} ${away}`;
    },
  },
  nba: {
    base: "https://v2.nba.api-sports.io",
    path: "/games",
    label: "NBA",
    format(f) {
      const home = f.teams?.home?.name || "Home";
      const away = f.teams?.visitors?.name || "Away";
      const s = f.scores;
      const score = s ? `${s.visitors?.points ?? 0} - ${s.home?.points ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
  basketball: {
    base: "https://v1.basketball.api-sports.io",
    path: "/games",
    label: "Basketball",
    format(f) {
      const home = f.teams?.home?.name || f.teams?.home || "Home";
      const away = f.teams?.away?.name || f.teams?.visitors?.name || "Away";
      const score = f.scores ? `${f.scores.away ?? 0} - ${f.scores.home ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
  nfl: {
    base: "https://v1.american-football.api-sports.io",
    path: "/games",
    label: "NFL",
    format(f) {
      const home = f.home?.name || f.teams?.home?.name || "Home";
      const away = f.away?.name || f.teams?.away?.name || "Away";
      const score = f.scores ? `${f.scores.away ?? 0} - ${f.scores.home ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
  baseball: {
    base: "https://v1.baseball.api-sports.io",
    path: "/games",
    label: "Baseball",
    format(f) {
      const home = f.teams?.home?.name || "Home";
      const away = f.teams?.away?.name || "Away";
      const score = f.scores ? `${f.scores.away ?? 0} - ${f.scores.home ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
  hockey: {
    base: "https://v1.hockey.api-sports.io",
    path: "/games",
    label: "Hockey",
    format(f) {
      const home = f.teams?.home?.name || "Home";
      const away = f.teams?.away?.name || "Away";
      const score = f.scores ? `${f.scores.away ?? 0} - ${f.scores.home ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
  rugby: {
    base: "https://v1.rugby.api-sports.io",
    path: "/games",
    label: "Rugby",
    format(f) {
      const home = f.teams?.home?.name || "Home";
      const away = f.teams?.away?.name || "Away";
      const score = f.scores ? `${f.scores.away ?? 0} - ${f.scores.home ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
  volleyball: {
    base: "https://v1.volleyball.api-sports.io",
    path: "/games",
    label: "Volleyball",
    format(f) {
      const home = f.teams?.home?.name || "Home";
      const away = f.teams?.away?.name || "Away";
      const score = f.scores ? `${f.scores.away ?? 0} - ${f.scores.home ?? 0}` : "0 - 0";
      return `${away} ${score} ${home}`;
    },
  },
};

/** Map keywords to sport key; order matters (more specific first). */
function detectSport(text) {
  const t = (text || "").toLowerCase();
  if (/\bnba\b/.test(t)) return "nba";
  if (/\bnfl\b|american football|football game\b/.test(t)) return "nfl";
  if (/\bbasketball\b/.test(t)) return "basketball";
  if (/\bsoccer\b|football\b/.test(t)) return "football";
  if (/\bbaseball\b|mlb\b/.test(t)) return "baseball";
  if (/\bhockey\b|nhl\b/.test(t)) return "hockey";
  if (/\brugby\b/.test(t)) return "rugby";
  if (/\bvolleyball\b/.test(t)) return "volleyball";
  return "football";
}

function createSportsService(apiKey, logger) {
  if (!apiKey) {
    return {
      getLiveScores: async () => ({ error: "Sports not configured. Set API_FOOTBALL_KEY." }),
      detectSport: () => "football",
      enabled: false,
    };
  }

  async function getLiveScores(sportKey) {
    const sport = SPORTS[sportKey] || SPORTS.football;
    const url = `${sport.base}${sport.path}`;
    try {
      const res = await axios.get(url, {
        params: { live: "all" },
        headers: { "x-apisports-key": apiKey },
        timeout: 8000,
      });
      const data = res.data;
      if (data.errors && Object.keys(data.errors).length > 0) {
        const msg = data.errors[Object.keys(data.errors)[0]];
        logger.warn({ sport: sportKey, errors: data.errors }, "API-Sports error");
        return { error: msg || "Could not fetch scores." };
      }
      const list = data.response || [];
      if (list.length === 0) {
        return { message: `No live ${sport.label} games right now.` };
      }
      const matches = list.slice(0, 5).map((f) => sport.format(f));
      return { matches, count: list.length, sport: sport.label };
    } catch (err) {
      logger.warn({ err: err.message, sport: sportKey, url }, "API-Sports request failed");
      return { error: "Could not fetch live scores." };
    }
  }

  return {
    getLiveScores,
    detectSport,
    enabled: true,
  };
}

module.exports = createSportsService;
