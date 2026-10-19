// Betting math shared by the app and the tests (node --test tests/calc.test.js).
// Conventions:
//   - American odds: -110, +150. "profit" is net profit per 1 unit risked.
//   - Margins are from the HOME team's view: +3 means home wins by 3.
//   - A spread "line" is from the bet side's view: -3.5 means that side gives 3.5.
//   - A push returns the stake: it is neither a win nor a loss.
(function (root) {
  function profitPerUnit(odds) {
    if (!(odds >= 100 || odds <= -100)) throw new Error(`invalid American odds: ${odds}`);
    return odds < 0 ? 100 / -odds : odds / 100;
  }

  const toDecimal = (odds) => 1 + profitPerUnit(odds);

  // Break-even win probability (no pushes), i.e. the price's implied probability
  const impliedProb = (odds) => 1 / toDecimal(odds);

  // Remove the bookmaker's margin from a two-way market
  function noVig(oddsA, oddsB) {
    const a = impliedProb(oddsA), b = impliedProb(oddsB);
    return { a: a / (a + b), b: b / (a + b), hold: a + b - 1 };
  }

  // Expected net profit per 1 unit risked
  function expectedValue(pWin, pPush, odds) {
    const pLose = 1 - pWin - pPush;
    return pWin * profitPerUnit(odds) - pLose;
  }

  // Price at which the bet breaks even given these probabilities (pushes excluded)
  function fairOdds(pWin, pLose) {
    if (!(pWin > 0) || !(pLose > 0)) return null;
    const b = pLose / pWin; // fair profit per unit
    return b >= 1 ? Math.round(b * 100) : -Math.round(100 / b);
  }

  // Linear interpolation into an exported PMF grid: {mus, p}
  function pmfAt(table, mu) {
    const mus = table.mus, step = mus[1] - mus[0];
    mu = Math.max(mus[0], Math.min(mus[mus.length - 1], mu));
    const i = Math.min(Math.floor((mu - mus[0]) / step), mus.length - 2);
    const f = (mu - mus[i]) / step;
    return table.p[i].map((x, k) => (1 - f) * x + f * table.p[i + 1][k]);
  }

  // Spread bet on one side. homeSide: true if betting the home team.
  function spreadProbs(pmf, minMargin, homeSide, line) {
    let win = 0, push = 0;
    pmf.forEach((x, k) => {
      const sideMargin = (minMargin + k) * (homeSide ? 1 : -1);
      const r = sideMargin + line;
      if (Math.abs(r) < 1e-9) push += x; else if (r > 0) win += x;
    });
    return { win, push, lose: Math.max(0, 1 - win - push) };
  }

  // Moneyline = spread of 0: a tie pushes (rare in the NFL, but real)
  const moneylineProbs = (pmf, minMargin, homeSide) => spreadProbs(pmf, minMargin, homeSide, 0);

  function totalProbs(pmf, minTotal, line) {
    let over = 0, push = 0;
    pmf.forEach((x, k) => {
      const t = minTotal + k;
      if (Math.abs(t - line) < 1e-9) push += x; else if (t > line) over += x;
    });
    return { over, push, under: Math.max(0, 1 - over - push) };
  }

  // Calibrated expected value: market number moved k of the way toward the model
  const blend = (market, model, k) => market == null ? model : market + k * (model - market);

  // CDF of an outcome-to-projection ratio given its 101 quantiles (0%, 1%, ... 100%)
  function quantileCdf(qs, x) {
    if (x <= qs[0]) return 0;
    if (x >= qs[qs.length - 1]) return 1;
    let i = 0;
    while (qs[i + 1] < x) i++;
    const span = qs[i + 1] - qs[i];
    return (i + (span > 0 ? (x - qs[i]) / span : 0)) / (qs.length - 1);
  }

  // Over/under a prop line for a stat with this projection. Whole-number lines
  // can push: over needs line + 1 (stats are whole numbers), under needs line - 1.
  function propProbs(qs, proj, line) {
    const whole = Math.abs(line - Math.round(line)) < 1e-9;
    const overAt = whole ? line + 0.5 : line, underAt = whole ? line - 0.5 : line;
    const over = 1 - quantileCdf(qs, overAt / proj), under = quantileCdf(qs, underAt / proj);
    return { over, under, push: Math.max(0, 1 - over - under) };
  }

  // P(X > line) for a Poisson count (touchdowns)
  function poissonOver(lambda, line) {
    let cdf = 0, term = Math.exp(-lambda);
    for (let k = 0; k <= Math.floor(line); k++) { cdf += term; term *= lambda / (k + 1); }
    const whole = Math.abs(line - Math.round(line)) < 1e-9;
    const pAt = whole ? Math.exp(-lambda) * lambda ** line / factorial(line) : 0;
    return { over: 1 - cdf, under: cdf - pAt, push: pAt };
  }
  function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }

  const api = { profitPerUnit, quantileCdf, propProbs, poissonOver, toDecimal, impliedProb, noVig, expectedValue, fairOdds,
                pmfAt, spreadProbs, moneylineProbs, totalProbs, blend };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
